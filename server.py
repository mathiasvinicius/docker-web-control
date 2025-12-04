#!/usr/bin/env python3
"""
Simple web server that exposes a UI + API for managing Docker containers.
The API uses the Docker CLI, so it runs with the same permissions as the process owner.
"""

from __future__ import annotations

import json
import ast
import mimetypes
import os
import shlex
import subprocess
import threading
import uuid
import hashlib
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
from typing import Dict, List
from urllib.parse import urlparse, parse_qs

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = BASE_DIR / "index.html"
ICONS_DIR = BASE_DIR / "icons"
GROUPS_FILE = BASE_DIR / "data" / "groups.json"
GROUP_ALIASES_FILE = BASE_DIR / "data" / "group_aliases.json"
CONTAINER_ALIASES_FILE = BASE_DIR / "data" / "container_aliases.json"
AUTOSTART_FILE = BASE_DIR / "data" / "autostart.json"
DOCKER_TIMEOUT = int(os.environ.get("DOCKER_TIMEOUT", "30"))
MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5MB max file size


def _read_file_bytes(path: Path) -> bytes:
    with path.open("rb") as file_handle:
        return file_handle.read()


class GroupStore:
    """Thread-safe file backed storage for container groups."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._write({})

    def read(self) -> Dict[str, List[str]]:
        with self._lock:
            try:
                return json.loads(self._path.read_text())
            except FileNotFoundError:
                return {}
            except json.JSONDecodeError:
                # Corrupted file, reset to avoid crashing the UI.
                return {}

    def _write(self, groups: Dict[str, List[str]]) -> None:
        with self._lock:
            self._path.write_text(json.dumps(groups, indent=2))

    def write(self, groups: Dict[str, List[str]]) -> Dict[str, List[str]]:
        sanitized = {
            name.strip(): sorted(set(container_ids))
            for name, container_ids in groups.items()
            if name.strip()
        }
        self._write(sanitized)
        return sanitized


class AutostartStore:
    """Thread-safe file backed storage for autostart configuration."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._write({"groups": [], "containers": []})

    def read(self) -> Dict[str, List[str]]:
        with self._lock:
            try:
                return json.loads(self._path.read_text())
            except FileNotFoundError:
                return {"groups": [], "containers": []}
            except json.JSONDecodeError:
                return {"groups": [], "containers": []}

    def _write(self, config: Dict[str, List[str]]) -> None:
        with self._lock:
            self._path.write_text(json.dumps(config, indent=2))

    def write(self, config: Dict[str, List[str]]) -> Dict[str, List[str]]:
        sanitized = {
            "groups": list(set(config.get("groups", []))),
            "containers": list(set(config.get("containers", [])))
        }
        self._write(sanitized)
        return sanitized


class GroupAliasStore:
    """Thread-safe storage for group aliases (apelidos)."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._write({})

    def read(self) -> Dict[str, Dict[str, str]]:
        with self._lock:
            try:
                return json.loads(self._path.read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                return {}

    def _write(self, aliases: Dict[str, Dict[str, str]]) -> None:
        with self._lock:
            self._path.write_text(json.dumps(aliases, indent=2))

    def write(self, aliases: Dict[str, Dict[str, str] | str]) -> Dict[str, Dict[str, str]]:
        def normalize(value):
            if isinstance(value, dict):
                return {
                    "alias": str(value.get("alias", "")).strip(),
                    "icon": str(value.get("icon", "")).strip(),
                }
            if isinstance(value, str) and value.strip().startswith("{"):
                try:
                    parsed = ast.literal_eval(value)
                    if isinstance(parsed, dict):
                        return {
                            "alias": str(parsed.get("alias", "")).strip(),
                            "icon": str(parsed.get("icon", "")).strip(),
                        }
                except Exception:
                    pass
            return {"alias": str(value or "").strip(), "icon": ""}

        sanitized: Dict[str, Dict[str, str]] = {}
        for name, value in aliases.items():
            key = name.strip()
            if not key:
                continue
            norm = normalize(value)
            if not norm["alias"] and not norm["icon"]:
                continue
            entry: Dict[str, str] = {}
            if norm["alias"]:
                entry["alias"] = norm["alias"]
            if norm["icon"]:
                entry["icon"] = norm["icon"]
            sanitized[key] = entry
        self._write(sanitized)
        return sanitized


class ContainerAliasStore:
    """Thread-safe storage for container aliases."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._write({})

    def read(self) -> Dict[str, Dict[str, str]]:
        with self._lock:
            try:
                return json.loads(self._path.read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                return {}

    def _write(self, aliases: Dict[str, Dict[str, str]]) -> None:
        with self._lock:
            self._path.write_text(json.dumps(aliases, indent=2))

    def write(self, aliases: Dict[str, Dict[str, str] | str]) -> Dict[str, Dict[str, str]]:
        def normalize(value):
            if isinstance(value, dict):
                return {
                    "alias": str(value.get("alias", "")).strip(),
                    "icon": str(value.get("icon", "")).strip(),
                }
            if isinstance(value, str) and value.strip().startswith("{"):
                try:
                    parsed = ast.literal_eval(value)
                    if isinstance(parsed, dict):
                        return {
                            "alias": str(parsed.get("alias", "")).strip(),
                            "icon": str(parsed.get("icon", "")).strip(),
                        }
                except Exception:
                    pass
            return {"alias": str(value or "").strip(), "icon": ""}

        sanitized: Dict[str, Dict[str, str]] = {}
        for cid, value in aliases.items():
            key = cid.strip()
            if not key:
                continue
            norm = normalize(value)
            if not norm["alias"] and not norm["icon"]:
                continue
            entry: Dict[str, str] = {}
            if norm["alias"]:
                entry["alias"] = norm["alias"]
            if norm["icon"]:
                entry["icon"] = norm["icon"]
            sanitized[key] = entry
        self._write(sanitized)
        return sanitized


class DockerCommandError(RuntimeError):
    def __init__(self, command: List[str], stderr: str) -> None:
        joined = " ".join(command)
        super().__init__(f"Docker command failed: {joined}")
        self.stderr = stderr


def run_docker_command(args: List[str]) -> str:
    """Executa comandos Docker diretamente no shell, como comandos locais."""
    # Escapa os argumentos para evitar injeção de comandos
    escaped_args = [shlex.quote(arg) for arg in args]
    command = "docker " + " ".join(escaped_args)

    try:
        completed = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            check=False,
            timeout=DOCKER_TIMEOUT,
            executable="/bin/bash",
        )
    except subprocess.TimeoutExpired:
        raise DockerCommandError(
            [command],
            f"Comando excedeu o tempo limite de {DOCKER_TIMEOUT}s; "
            "verifique se o container requer interação manual.",
        )
    if completed.returncode != 0:
        raise DockerCommandError([command], completed.stderr.strip())
    return completed.stdout


def set_restart_policy(container_id: str, policy: str) -> None:
    """Atualiza a restart policy de um container."""
    run_docker_command(["update", f"--restart={policy}", container_id])


def sync_restart_policies(autostart_cfg: Dict[str, List[str]], groups: Dict[str, List[str]]) -> List[str]:
    """
    Ajusta as restart policies dos containers que fazem parte de grupos/auto-start
    para refletir o estado atual da configuracao salva.
    Retorna lista de avisos (se houver falhas em algum container).
    """
    desired: Dict[str, str] = {}
    enabled_groups = set(autostart_cfg.get("groups", []))
    enabled_containers = set(autostart_cfg.get("containers", []))

    # Containers em grupos: se o grupo estiver habilitado, usar unless-stopped, caso contrario no.
    for group_name, ids in groups.items():
        policy = "unless-stopped" if group_name in enabled_groups else "no"
        for cid in ids:
            desired[cid] = policy

    # Containers individuais marcados para autostart: forca unless-stopped
    for cid in enabled_containers:
        desired[cid] = "unless-stopped"

    warnings: List[str] = []
    for cid, policy in desired.items():
        try:
            set_restart_policy(cid, policy)
        except DockerCommandError as error:
            warnings.append(f"{cid[:12]}: {error.stderr or error}")

    return warnings


def ensure_autostart_running(autostart_cfg: Dict[str, List[str]], groups: Dict[str, List[str]]) -> List[str]:
    """
    Garante que containers marcados para autostart estejam rodando.
    Tenta iniciar containers listados nos grupos habilitados ou na lista individual.
    Retorna avisos em caso de falha.
    """
    desired_ids: set[str] = set()
    enabled_groups = set(autostart_cfg.get("groups", []))
    for group_name in enabled_groups:
        desired_ids.update(groups.get(group_name, []))
    desired_ids.update(autostart_cfg.get("containers", []))

    warnings: List[str] = []
    for cid in desired_ids:
        try:
            # docker start em container já iniciado retorna erro; tratamos silenciosamente
            run_docker_command(["start", cid])
        except DockerCommandError as error:
            # Ignorar erro "is already running"
            if "is already running" in (error.stderr or "").lower():
                continue
            warnings.append(f"{cid[:12]}: {error.stderr or error}")
    return warnings


def fetch_containers() -> List[Dict[str, str]]:
    stdout = run_docker_command(["ps", "-a", "--no-trunc", "--format", "{{json .}}"])
    containers: List[Dict[str, str]] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError:
            continue
        labels = _parse_labels(raw.get("Labels") or "")
        container_id = raw.get("ID")
        icon = (
            labels.get("org.opencontainers.image.icon")
            or labels.get("io.casaos.app.icon")
            or labels.get("icon")
            or labels.get("org.opencontainers.image.logo")
        )

        # Buscar restart policy do container
        restart_policy = "no"
        try:
            inspect_output = run_docker_command([
                "inspect", container_id,
                "--format", "{{.HostConfig.RestartPolicy.Name}}"
            ])
            restart_policy = inspect_output.strip()
        except DockerCommandError:
            pass  # Se falhar, usar "no" como padrão

        containers.append(
            {
                "id": container_id,
                "name": raw.get("Names"),
                "image": raw.get("Image"),
                "command": raw.get("Command"),
                "state": raw.get("State"),
                "status": raw.get("Status"),
                "ports": raw.get("Ports"),
                "project": labels.get("com.docker.compose.project"),
                "mounts": raw.get("Mounts"),
                "icon": icon,
                "restart_policy": restart_policy,
            }
        )
    return containers


def _parse_labels(labels_str: str) -> Dict[str, str]:
    labels: Dict[str, str] = {}
    if not labels_str:
        return labels
    for label in labels_str.split(","):
        if "=" not in label:
            continue
        key, value = label.split("=", 1)
        labels[key] = value
    return labels


class DockerControlServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True  # Permite reutilizar o endereço imediatamente

    def __init__(
        self,
        server_address,
        RequestHandlerClass,
        group_store: GroupStore,
        autostart_store: AutostartStore,
        alias_store: GroupAliasStore,
        container_alias_store: ContainerAliasStore,
    ):
        super().__init__(server_address, RequestHandlerClass)
        self.group_store = group_store
        self.autostart_store = autostart_store
        self.alias_store = alias_store
        self.container_alias_store = container_alias_store


class DockerControlHandler(BaseHTTPRequestHandler):
    server_version = "DockerControl/0.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        route = parsed.path
        if route == "/":
            self._serve_file(INDEX_FILE)
            return
        if route.startswith("/static/"):
            static_path = (STATIC_DIR / route[len("/static/") :]).resolve()
            if not static_path.is_file() or not str(static_path).startswith(str(STATIC_DIR)):
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self._serve_file(static_path)
            return
        if route.startswith("/icons/"):
            icon_path = (ICONS_DIR / route[len("/icons/") :]).resolve()
            if not icon_path.is_file() or not str(icon_path).startswith(str(ICONS_DIR)):
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self._serve_file(icon_path)
            return
        if route == "/api/containers":
            self._handle_list_containers()
            return
        if route == "/api/container-aliases":
            self._handle_list_container_aliases()
            return
        if route == "/api/groups":
            self._handle_list_groups()
            return
        if route == "/api/autostart":
            self._handle_get_autostart()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Unknown path")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        route = parsed.path
        if route.startswith("/api/containers/") and route.endswith("/restart-policy"):
            self._handle_set_restart_policy(route)
            return
        if route.startswith("/api/containers/"):
            self._handle_container_action(route)
            return
        if route == "/api/container-aliases":
            self._handle_save_container_aliases()
            return
        if route == "/api/groups":
            self._handle_save_groups()
            return
        if route == "/api/autostart":
            self._handle_save_autostart()
            return
        if route == "/api/upload-icon":
            self._handle_upload_icon()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Unknown path")

    def log_message(self, fmt: str, *args) -> None:
        # Reduce noise – log to stderr only when DEBUG env set.
        if os.environ.get("DEBUG"):
            super().log_message(fmt, *args)

    # region API handlers
    def _handle_list_containers(self) -> None:
        try:
            containers = fetch_containers()
            aliases = self.server.container_alias_store.read()
            self._send_json({"containers": containers, "aliases": aliases})
        except DockerCommandError as error:
            self._send_json({"error": str(error), "details": error.stderr}, code=500)

    def _handle_list_groups(self) -> None:
        groups = self.server.group_store.read()
        aliases = self.server.alias_store.read()
        self._send_json({"groups": groups, "aliases": aliases})

    def _handle_save_groups(self) -> None:
        payload = self._read_json_body()
        if not isinstance(payload, dict) or "groups" not in payload:
            self._send_json({"error": "Missing groups payload"}, code=400)
            return
        groups = payload["groups"]
        if not isinstance(groups, dict):
            self._send_json({"error": "Groups must be an object"}, code=400)
            return
        aliases = payload.get("aliases", {})
        if aliases and not isinstance(aliases, dict):
            self._send_json({"error": "Aliases must be an object"}, code=400)
            return
        saved = self.server.group_store.write(groups)
        saved_aliases = self.server.alias_store.write(aliases or {})
        self._send_json({"groups": saved, "aliases": saved_aliases})

    def _handle_list_container_aliases(self) -> None:
        aliases = self.server.container_alias_store.read()
        self._send_json({"aliases": aliases})

    def _handle_save_container_aliases(self) -> None:
        payload = self._read_json_body()
        if not isinstance(payload, dict) or "aliases" not in payload:
            self._send_json({"error": "Missing aliases payload"}, code=400)
            return
        aliases = payload["aliases"]
        if not isinstance(aliases, dict):
            self._send_json({"error": "Aliases must be an object"}, code=400)
            return
        existing = self.server.container_alias_store.read()
        merged = {**existing, **{k: str(v) for k, v in aliases.items()}}
        saved = self.server.container_alias_store.write(merged)
        self._send_json({"aliases": saved})

    def _handle_container_action(self, route: str) -> None:
        remainder = route[len("/api/containers/") :]
        parts = [part for part in remainder.split("/") if part]
        if len(parts) != 2:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid container action path")
            return
        container_id, action = parts
        command_map = {
            "start": ["start", container_id],
            "stop": ["stop", container_id],
            "restart": ["restart", container_id],
        }

        docker_args = command_map.get(action)
        if not docker_args:
            self.send_error(HTTPStatus.BAD_REQUEST, "Unsupported action")
            return
        try:
            run_docker_command(docker_args)
            self._send_json({"status": "ok"})
        except DockerCommandError as error:
            self._send_json({"error": str(error), "details": error.stderr}, code=500)

    def _handle_set_restart_policy(self, route: str) -> None:
        remainder = route[len("/api/containers/") :]
        parts = [part for part in remainder.split("/") if part]
        if len(parts) != 2 or parts[1] != "restart-policy":
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid restart policy path")
            return
        container_id = parts[0]
        payload = self._read_json_body()
        if not isinstance(payload, dict) or "policy" not in payload:
            self._send_json({"error": "Missing restart policy payload"}, code=400)
            return
        policy = str(payload["policy"]).strip().lower()
        allowed = {"no", "always", "unless-stopped", "on-failure"}
        if policy not in allowed:
            self._send_json({"error": "Invalid restart policy"}, code=400)
            return
        try:
            run_docker_command(["update", f"--restart={policy}", container_id])
            self._send_json({"restart_policy": policy})
        except DockerCommandError as error:
            self._send_json({"error": str(error), "details": error.stderr}, code=500)

    def _handle_get_autostart(self) -> None:
        config = self.server.autostart_store.read()
        self._send_json({"autostart": config})

    def _handle_save_autostart(self) -> None:
        payload = self._read_json_body()
        if not isinstance(payload, dict) or "autostart" not in payload:
            self._send_json({"error": "Missing autostart payload"}, code=400)
            return
        config = payload["autostart"]
        if not isinstance(config, dict):
            self._send_json({"error": "Autostart must be an object"}, code=400)
            return
        saved = self.server.autostart_store.write(config)
        groups = self.server.group_store.read()
        warnings = sync_restart_policies(saved, groups)
        run_warnings = ensure_autostart_running(saved, groups)
        response = {"autostart": saved}
        if warnings:
            response["warnings"] = warnings
        if run_warnings:
            response["warnings"] = response.get("warnings", []) + run_warnings
        self._send_json(response)

    def _handle_upload_icon(self) -> None:
        """Handle icon file upload with multipart/form-data."""
        import sys
        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("multipart/form-data"):
            self._send_json({"error": "Content-Type must be multipart/form-data"}, code=400)
            return

        # Parse boundary
        boundary = None
        for part in content_type.split(";"):
            part = part.strip()
            if part.startswith("boundary="):
                boundary = part[9:].strip()
                break

        if not boundary:
            self._send_json({"error": "No boundary found in Content-Type"}, code=400)
            return

        # Read body
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > MAX_UPLOAD_SIZE:
            self._send_json({"error": f"File too large (max {MAX_UPLOAD_SIZE // 1024 // 1024}MB)"}, code=413)
            return

        if content_length == 0:
            self._send_json({"error": "No file uploaded"}, code=400)
            return

        body = self.rfile.read(content_length)

        # Debug logging
        print(f"DEBUG: Content-Type: {content_type}", file=sys.stderr)
        print(f"DEBUG: Boundary: {boundary}", file=sys.stderr)
        print(f"DEBUG: Content-Length: {content_length}", file=sys.stderr)
        print(f"DEBUG: Body length: {len(body)}", file=sys.stderr)

        # Parse multipart data
        boundary_bytes = f"--{boundary}".encode()
        parts = body.split(boundary_bytes)

        # Debug: log parts information
        print(f"DEBUG: Number of parts: {len(parts)}", file=sys.stderr)
        for i, part in enumerate(parts):
            print(f"DEBUG: Part {i} length: {len(part)}, has Content-Disposition: {b'Content-Disposition' in part}, has filename: {b'filename=' in part}", file=sys.stderr)
            if b'Content-Disposition' in part:
                print(f"DEBUG: Part {i} first 300 bytes: {part[:300]}", file=sys.stderr)

        file_data = None
        filename = None

        for part in parts:
            if b"Content-Disposition" in part and b'filename=' in part:
                # Split by lines to find Content-Disposition header
                lines = part.split(b"\r\n")

                # Find the Content-Disposition line
                disposition_line = None
                for line in lines:
                    if b"Content-Disposition" in line:
                        disposition_line = line.decode("utf-8", errors="ignore")
                        break

                if disposition_line and 'filename=' in disposition_line:
                    print(f"DEBUG: Found disposition line: {disposition_line}", file=sys.stderr)

                    # Extract filename (handle both filename="x" and filename=x)
                    if 'filename="' in disposition_line:
                        start = disposition_line.index('filename="') + 10
                        end = disposition_line.index('"', start)
                        filename = disposition_line[start:end]
                        print(f"DEBUG: Extracted quoted filename: {filename}", file=sys.stderr)
                    elif 'filename=' in disposition_line:
                        # Handle unquoted filename
                        start = disposition_line.index('filename=') + 9
                        # Find end (semicolon or end of line)
                        rest = disposition_line[start:]
                        if ';' in rest:
                            filename = rest[:rest.index(';')].strip()
                        else:
                            filename = rest.strip()
                        print(f"DEBUG: Extracted unquoted filename: {filename}", file=sys.stderr)

                    # Extract file content (after double CRLF)
                    content_start = part.find(b"\r\n\r\n")
                    print(f"DEBUG: Content start position: {content_start}", file=sys.stderr)
                    if content_start != -1:
                        file_data = part[content_start + 4:]
                        # Remove trailing CRLF
                        if file_data.endswith(b"\r\n"):
                            file_data = file_data[:-2]
                        print(f"DEBUG: Extracted file data length: {len(file_data)}", file=sys.stderr)
                    break

        print(f"DEBUG: Final state - filename: {filename}, file_data length: {len(file_data) if file_data else 0}", file=sys.stderr)

        if not file_data or not filename:
            self._send_json({"error": "No file found in request"}, code=400)
            return

        # Validate file type
        allowed_extensions = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"}
        file_ext = Path(filename).suffix.lower()
        if file_ext not in allowed_extensions:
            self._send_json({"error": f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"}, code=400)
            return

        # Generate unique filename
        file_hash = hashlib.md5(file_data).hexdigest()[:12]
        unique_filename = f"{file_hash}{file_ext}"

        # Ensure icons directory exists
        ICONS_DIR.mkdir(parents=True, exist_ok=True)

        # Save file
        icon_path = ICONS_DIR / unique_filename
        try:
            with icon_path.open("wb") as f:
                f.write(file_data)
        except Exception as e:
            self._send_json({"error": f"Failed to save file: {str(e)}"}, code=500)
            return

        # Return URL
        icon_url = f"/icons/{unique_filename}"
        self._send_json({"url": icon_url, "filename": unique_filename})

    # endregion

    def _serve_file(self, path: Path) -> None:
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        data = _read_file_bytes(path)
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path == INDEX_FILE:
            content_type = "text/html; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, payload, code=200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length") or 0)
        if not content_length:
            return {}
        body = self.rfile.read(content_length).decode("utf-8")
        if not body:
            return {}
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {}


def main() -> None:
    address = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8088"))
    group_store = GroupStore(GROUPS_FILE)
    autostart_store = AutostartStore(AUTOSTART_FILE)
    alias_store = GroupAliasStore(GROUP_ALIASES_FILE)
    container_alias_store = ContainerAliasStore(CONTAINER_ALIASES_FILE)
    # Ajusta restart policies conforme configuracao salva (inclusive grupos desabilitados -> restart=no)
    try:
        cfg = autostart_store.read()
        groups = group_store.read()
        warnings = sync_restart_policies(cfg, groups)
        run_warnings = ensure_autostart_running(cfg, groups)
        all_warnings = warnings + run_warnings
        if all_warnings:
            print("Avisos ao sincronizar auto-start:", "; ".join(all_warnings))
    except Exception as exc:  # nao impedir o servidor de subir
        print(f"Falha ao sincronizar restart policies: {exc}")
    httpd = DockerControlServer(
        (address, port),
        DockerControlHandler,
        group_store,
        autostart_store,
        alias_store,
        container_alias_store,
    )
    print(f"Docker control UI running on http://{address}:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
