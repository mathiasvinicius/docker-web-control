#!/usr/bin/env python3
"""
Script de autostart para containers e grupos Docker.
Executa automaticamente no boot do sistema para iniciar containers configurados.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

# Configurações
BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"
AUTOSTART_FILE = BASE_DIR / "data" / "autostart.json"
GROUPS_FILE = BASE_DIR / "data" / "groups.json"
LOG_FILE = BASE_DIR / "autostart.log"


def load_env_file(path: Path) -> None:
    """Load simple KEY=VALUE pairs from a .env file (without overriding existing env vars)."""
    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return
    except OSError:
        return

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if (value.startswith("'") and value.endswith("'")) or (value.startswith('"') and value.endswith('"')):
            value = value[1:-1]
        os.environ.setdefault(key, value)


load_env_file(ENV_FILE)
DOCKER_TIMEOUT = int(os.environ.get("DOCKER_TIMEOUT", "30"))


def log(message: str) -> None:
    """Escreve mensagem no log."""
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    log_msg = f"[{timestamp}] {message}\n"
    print(log_msg.strip())

    try:
        with LOG_FILE.open("a") as f:
            f.write(log_msg)
    except Exception as e:
        print(f"Erro ao escrever log: {e}")


def run_docker_command(args: list) -> tuple[bool, str]:
    """Executa comando Docker e retorna (sucesso, output/erro)."""
    import shlex

    escaped_args = [shlex.quote(arg) for arg in args]
    command = "docker " + " ".join(escaped_args)

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            check=False,
            timeout=DOCKER_TIMEOUT,
            executable="/bin/bash",
        )

        if result.returncode == 0:
            return True, result.stdout.strip()
        else:
            return False, result.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, f"Comando excedeu timeout de {DOCKER_TIMEOUT}s"
    except Exception as e:
        return False, str(e)


def load_json(file_path: Path) -> dict:
    """Carrega arquivo JSON."""
    try:
        if not file_path.exists():
            return {}
        return json.loads(file_path.read_text())
    except Exception as e:
        log(f"Erro ao carregar {file_path}: {e}")
        return {}


def get_container_state(container_id: str) -> str:
    """Retorna o estado atual do container."""
    success, output = run_docker_command(["inspect", container_id, "--format", "{{.State.Status}}"])
    if success:
        return output.strip()
    return "unknown"


def start_container(container_id: str) -> bool:
    """Inicia um container se ele não estiver rodando."""
    state = get_container_state(container_id)

    if state == "running":
        log(f"  ↳ Container {container_id[:12]} já está rodando")
        return True

    log(f"  ↳ Iniciando container {container_id[:12]}...")
    success, output = run_docker_command(["start", container_id])

    if success:
        log(f"  ✓ Container {container_id[:12]} iniciado")
        return True
    else:
        log(f"  ✗ Falha ao iniciar {container_id[:12]}: {output}")
        return False


def start_group(group_name: str, groups_data: dict) -> None:
    """Inicia todos os containers de um grupo."""
    log(f"Iniciando grupo: {group_name}")

    container_ids = groups_data.get(group_name, [])

    if not container_ids:
        log(f"  ⚠ Grupo '{group_name}' está vazio ou não existe")
        return

    success_count = 0
    for container_id in container_ids:
        if start_container(container_id):
            success_count += 1

    log(f"  ✓ Grupo '{group_name}': {success_count}/{len(container_ids)} containers iniciados")


def main() -> int:
    """Função principal do autostart."""
    log("="*60)
    log("Iniciando autostart de containers Docker")
    log("="*60)

    # Carrega configurações
    autostart_config = load_json(AUTOSTART_FILE)
    groups_data = load_json(GROUPS_FILE)

    if not autostart_config:
        log("⚠ Nenhuma configuração de autostart encontrada")
        return 0

    groups_to_start = autostart_config.get("groups", [])
    containers_to_start = autostart_config.get("containers", [])

    if not groups_to_start and not containers_to_start:
        log("⚠ Nenhum grupo ou container configurado para autostart")
        return 0

    # Aguarda o Docker estar pronto
    log("Aguardando Docker estar pronto...")
    max_retries = 10
    for i in range(max_retries):
        success, _ = run_docker_command(["ps"])
        if success:
            log("✓ Docker está pronto")
            break
        if i < max_retries - 1:
            log(f"  Tentativa {i+1}/{max_retries}... aguardando 2s")
            time.sleep(2)
    else:
        log("✗ Docker não está respondendo, abortando")
        return 1

    # Inicia grupos
    if groups_to_start:
        log(f"\nIniciando {len(groups_to_start)} grupo(s):")
        for group_name in groups_to_start:
            start_group(group_name, groups_data)

    # Inicia containers individuais
    if containers_to_start:
        log(f"\nIniciando {len(containers_to_start)} container(s) individual(is):")
        success_count = 0
        for container_id in containers_to_start:
            if start_container(container_id):
                success_count += 1
        log(f"✓ {success_count}/{len(containers_to_start)} containers individuais iniciados")

    log("="*60)
    log("Autostart concluído")
    log("="*60)

    return 0


if __name__ == "__main__":
    sys.exit(main())
