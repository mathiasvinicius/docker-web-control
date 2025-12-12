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
import time
import urllib.error
import urllib.request
import uuid
import hashlib
import io
import zipfile
import tempfile
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
from typing import Dict, List
from urllib.parse import urlparse, parse_qs

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"


def _load_env_file(path: Path) -> None:
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


_load_env_file(ENV_FILE)
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = BASE_DIR / "index.html"
ICONS_DIR = BASE_DIR / "icons"
GROUPS_FILE = BASE_DIR / "data" / "groups.json"
GROUP_ALIASES_FILE = BASE_DIR / "data" / "group_aliases.json"
CONTAINER_ALIASES_FILE = BASE_DIR / "data" / "container_aliases.json"
AUTOSTART_FILE = BASE_DIR / "data" / "autostart.json"
DOCKERFILES_DIR = BASE_DIR / "dockerfiles"
DOCKER_TIMEOUT = int(os.environ.get("DOCKER_TIMEOUT", "30"))
MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5MB max file size
BING_WALLPAPER_TTL_SECONDS = 6 * 60 * 60
BING_WALLPAPER_CACHE_LOCK = threading.Lock()
BING_WALLPAPER_CACHE: Dict[str, Dict[str, object]] = {}
SYSTEM_STATS_LOCK = threading.Lock()
SYSTEM_STATS_CPU_SAMPLE: Dict[str, float | int] = {}


def _sanitize_bing_market(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return "en-US"
    if re.fullmatch(r"[a-z]{2}-[A-Z]{2}", raw):
        return raw
    return "en-US"


def _fetch_bing_wallpaper(market: str) -> Dict[str, str]:
    market = _sanitize_bing_market(market)
    api_url = f"https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt={market}"
    request = urllib.request.Request(
        api_url,
        headers={
            "User-Agent": "DockerWebControl/2.0 (+https://github.com/mathiasvinicius/docker-web-control)",
            "Accept": "application/json",
        },
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read().decode("utf-8", errors="replace")
    data = json.loads(body)
    images = data.get("images") or []
    if not images:
        raise ValueError("Bing did not return images.")
    image = images[0] if isinstance(images[0], dict) else {}
    relative = str(image.get("url") or "").strip()
    if not relative:
        raise ValueError("Bing image URL is missing.")
    full_url = relative if relative.startswith("http") else f"https://www.bing.com{relative}"
    return {
        "provider": "bing",
        "mkt": market,
        "url": full_url,
        "title": str(image.get("title") or "").strip(),
        "copyright": str(image.get("copyright") or "").strip(),
    }


def get_bing_wallpaper(market: str) -> Dict[str, str]:
    market = _sanitize_bing_market(market)
    now = time.time()

    with BING_WALLPAPER_CACHE_LOCK:
        cached = BING_WALLPAPER_CACHE.get(market)
        if cached:
            fetched_at = float(cached.get("fetched_at") or 0)
            payload = cached.get("payload")
            if isinstance(payload, dict) and now - fetched_at < BING_WALLPAPER_TTL_SECONDS:
                return payload  # type: ignore[return-value]

    try:
        payload = _fetch_bing_wallpaper(market)
    except Exception:
        with BING_WALLPAPER_CACHE_LOCK:
            cached = BING_WALLPAPER_CACHE.get(market)
            payload = cached.get("payload") if cached else None
            if isinstance(payload, dict):
                return payload  # type: ignore[return-value]
        raise

    with BING_WALLPAPER_CACHE_LOCK:
        BING_WALLPAPER_CACHE[market] = {"fetched_at": now, "payload": payload}
    return payload


def _read_proc_cpu_times() -> tuple[int, int] | None:
    try:
        line = Path("/proc/stat").read_text(encoding="utf-8").splitlines()[0]
    except (FileNotFoundError, OSError, IndexError):
        return None
    parts = line.split()
    if not parts or parts[0] != "cpu":
        return None
    try:
        values = [int(v) for v in parts[1:]]
    except ValueError:
        return None
    if len(values) < 4:
        return None
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    total = sum(values)
    return total, idle


def _read_proc_meminfo() -> dict[str, int] | None:
    try:
        lines = Path("/proc/meminfo").read_text(encoding="utf-8").splitlines()
    except (FileNotFoundError, OSError):
        return None

    info: dict[str, int] = {}
    for line in lines:
        if ":" not in line:
            continue
        key, raw_value = line.split(":", 1)
        key = key.strip()
        raw_value = raw_value.strip()
        if not key or not raw_value:
            continue
        parts = raw_value.split()
        if not parts:
            continue
        try:
            num = int(parts[0])
        except ValueError:
            continue
        unit = parts[1].lower() if len(parts) > 1 else ""
        if unit == "kb":
            num *= 1024
        info[key] = num

    return info


def get_system_stats() -> Dict[str, object]:
    cpu_percent: float | None = None
    load_avg: tuple[float, float, float] | None = None
    uptime_seconds: float | None = None

    try:
        load_avg = os.getloadavg()
    except (AttributeError, OSError):
        load_avg = None

    try:
        uptime_raw = Path("/proc/uptime").read_text(encoding="utf-8").split()
        if uptime_raw:
            uptime_seconds = float(uptime_raw[0])
    except (FileNotFoundError, OSError, ValueError):
        uptime_seconds = None

    with SYSTEM_STATS_LOCK:
        first = _read_proc_cpu_times()
        if first:
            total1, idle1 = first
            if SYSTEM_STATS_CPU_SAMPLE:
                total0 = int(SYSTEM_STATS_CPU_SAMPLE.get("total", total1))
                idle0 = int(SYSTEM_STATS_CPU_SAMPLE.get("idle", idle1))
                delta_total = total1 - total0
                delta_idle = idle1 - idle0
                if delta_total > 0:
                    cpu_percent = max(0.0, min(100.0, (1.0 - (delta_idle / delta_total)) * 100.0))
            else:
                # First call: sample quickly to provide an initial value.
                time.sleep(0.12)
                second = _read_proc_cpu_times()
                if second:
                    total2, idle2 = second
                    delta_total = total2 - total1
                    delta_idle = idle2 - idle1
                    if delta_total > 0:
                        cpu_percent = max(0.0, min(100.0, (1.0 - (delta_idle / delta_total)) * 100.0))
                    total1, idle1 = total2, idle2

            SYSTEM_STATS_CPU_SAMPLE["total"] = int(total1)
            SYSTEM_STATS_CPU_SAMPLE["idle"] = int(idle1)
            SYSTEM_STATS_CPU_SAMPLE["at"] = time.time()

    mem = _read_proc_meminfo() or {}
    mem_total = int(mem.get("MemTotal") or 0)
    mem_available = int(mem.get("MemAvailable") or 0)
    if mem_total and not mem_available:
        mem_available = int(
            (mem.get("MemFree") or 0) + (mem.get("Buffers") or 0) + (mem.get("Cached") or 0)
        )
    mem_used = max(0, mem_total - mem_available) if mem_total else 0
    mem_percent = (mem_used / mem_total * 100.0) if mem_total else None

    return {
        "timestamp": time.time(),
        "cpu": {
            "percent": cpu_percent,
            "cores": os.cpu_count() or 1,
            "load_avg": list(load_avg) if load_avg else None,
        },
        "memory": {
            "total_bytes": mem_total or None,
            "available_bytes": mem_available or None,
            "used_bytes": mem_used if mem_total else None,
            "percent": mem_percent,
        },
        "uptime_seconds": uptime_seconds,
    }


def _parse_percent(value: str) -> float | None:
    raw = (value or "").strip()
    if not raw:
        return None
    if raw.endswith("%"):
        raw = raw[:-1].strip()
    try:
        return float(raw)
    except ValueError:
        return None


def _parse_docker_size(value: str) -> int | None:
    raw = (value or "").strip()
    if not raw:
        return None

    match = re.fullmatch(r"([0-9]*\.?[0-9]+)\s*([a-zA-Z]+)?", raw)
    if not match:
        return None
    num_raw = match.group(1)
    unit = (match.group(2) or "B").strip()
    try:
        num = float(num_raw)
    except ValueError:
        return None

    unit_norm = unit.lower()
    factors = {
        "b": 1,
        "kb": 1000,
        "mb": 1000**2,
        "gb": 1000**3,
        "tb": 1000**4,
        "kib": 1024,
        "mib": 1024**2,
        "gib": 1024**3,
        "tib": 1024**4,
    }
    factor = factors.get(unit_norm)
    if factor is None:
        return None
    return int(num * factor)


def _parse_docker_mem_usage(value: str) -> tuple[int | None, int | None]:
    raw = (value or "").strip()
    if not raw or "/" not in raw:
        return None, None
    left, right = raw.split("/", 1)
    used = _parse_docker_size(left.strip())
    limit = _parse_docker_size(right.strip())
    return used, limit


def _fetch_top_containers(sort_key: str, limit: int) -> list[dict[str, object]]:
    output = run_docker_command(
        [
            "stats",
            "--no-stream",
            "--format",
            "{{.ID}}\t{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}",
        ]
    )
    items: list[dict[str, object]] = []
    for line in output.splitlines():
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 5:
            continue
        container_id = parts[0].strip()
        name = parts[1].strip()
        cpu_percent = _parse_percent(parts[2])
        mem_used, mem_limit = _parse_docker_mem_usage(parts[3])
        mem_percent = _parse_percent(parts[4])
        if mem_percent is None and mem_used is not None and mem_limit:
            mem_percent = (mem_used / mem_limit) * 100.0

        items.append(
            {
                "type": "container",
                "id": container_id,
                "name": name or container_id,
                "cpu_percent": cpu_percent,
                "mem_used_bytes": mem_used,
                "mem_limit_bytes": mem_limit,
                "mem_percent": mem_percent,
            }
        )

    if sort_key == "mem":
        items.sort(key=lambda x: float(x.get("mem_used_bytes") or 0), reverse=True)
    else:
        items.sort(key=lambda x: float(x.get("cpu_percent") or 0), reverse=True)
    return items[:limit]


def _fetch_top_processes(sort_key: str, limit: int) -> list[dict[str, object]]:
    sort_arg = "--sort=-pcpu" if sort_key == "cpu" else "--sort=-rss"
    completed = subprocess.run(
        ["ps", "-eo", "pid,comm,pcpu,pmem,rss", "--no-headers", sort_arg],
        capture_output=True,
        text=True,
        check=False,
        timeout=3,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "ps failed")

    items: list[dict[str, object]] = []
    for raw_line in completed.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        name = parts[1].strip()
        try:
            cpu_percent = float(parts[2])
        except ValueError:
            cpu_percent = None
        try:
            mem_percent = float(parts[3])
        except ValueError:
            mem_percent = None
        try:
            rss_kb = int(parts[4])
        except ValueError:
            rss_kb = 0
        items.append(
            {
                "type": "process",
                "pid": pid,
                "name": name or str(pid),
                "cpu_percent": cpu_percent,
                "mem_percent": mem_percent,
                "mem_rss_bytes": rss_kb * 1024,
            }
        )

    if sort_key == "mem":
        items.sort(key=lambda x: int(x.get("mem_rss_bytes") or 0), reverse=True)
    else:
        items.sort(key=lambda x: float(x.get("cpu_percent") or 0), reverse=True)
    return items[:limit]


def get_system_top(scope: str, sort_key: str, limit: int = 10) -> Dict[str, object]:
    scope_norm = (scope or "").strip().lower()
    if scope_norm not in ("containers", "processes"):
        scope_norm = "containers"

    sort_norm = (sort_key or "").strip().lower()
    if sort_norm in ("mem", "memory", "ram"):
        sort_norm = "mem"
    else:
        sort_norm = "cpu"

    try:
        limit_int = int(limit)
    except (TypeError, ValueError):
        limit_int = 10
    limit_int = max(1, min(10, limit_int))

    if scope_norm == "processes":
        items = _fetch_top_processes(sort_norm, limit_int)
    else:
        items = _fetch_top_containers(sort_norm, limit_int)

    return {
        "scope": scope_norm,
        "sort": sort_norm,
        "limit": limit_int,
        "items": items,
    }


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

    def read(self) -> Dict[str, Dict[str, str | int]]:
        with self._lock:
            try:
                return json.loads(self._path.read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                return {}

    def _write(self, aliases: Dict[str, Dict[str, str | int]]) -> None:
        with self._lock:
            self._path.write_text(json.dumps(aliases, indent=2))

    def write(self, aliases: Dict[str, Dict[str, str | int] | str]) -> Dict[str, Dict[str, str | int]]:
        def parse_order(value):
            if value is None:
                return None
            if isinstance(value, bool):
                return None
            if isinstance(value, (int, float)):
                try:
                    return int(value)
                except (TypeError, ValueError):
                    return None
            if isinstance(value, str):
                raw = value.strip()
                if not raw:
                    return None
                try:
                    return int(float(raw))
                except ValueError:
                    return None
            return None

        def normalize(value):
            if isinstance(value, dict):
                return {
                    "alias": str(value.get("alias", "")).strip(),
                    "icon": str(value.get("icon", "")).strip(),
                    "order": parse_order(value.get("order")),
                }
            if isinstance(value, str) and value.strip().startswith("{"):
                try:
                    parsed = ast.literal_eval(value)
                    if isinstance(parsed, dict):
                        return {
                            "alias": str(parsed.get("alias", "")).strip(),
                            "icon": str(parsed.get("icon", "")).strip(),
                            "order": parse_order(parsed.get("order")),
                        }
                except Exception:
                    pass
            return {"alias": str(value or "").strip(), "icon": "", "order": None}

        sanitized: Dict[str, Dict[str, str | int]] = {}
        for name, value in aliases.items():
            key = name.strip()
            if not key:
                continue
            norm = normalize(value)
            if not norm["alias"] and not norm["icon"] and norm.get("order") is None:
                continue
            entry: Dict[str, str | int] = {}
            if norm["alias"]:
                entry["alias"] = norm["alias"]
            if norm["icon"]:
                entry["icon"] = norm["icon"]
            if norm.get("order") is not None:
                entry["order"] = norm["order"]
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

    def read(self) -> Dict[str, Dict[str, str | int]]:
        with self._lock:
            try:
                return json.loads(self._path.read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                return {}

    def _write(self, aliases: Dict[str, Dict[str, str | int]]) -> None:
        with self._lock:
            self._path.write_text(json.dumps(aliases, indent=2))

    def write(self, aliases: Dict[str, Dict[str, str | int] | str]) -> Dict[str, Dict[str, str | int]]:
        def parse_order(value):
            if value is None:
                return None
            if isinstance(value, bool):
                return None
            if isinstance(value, (int, float)):
                try:
                    return int(value)
                except (TypeError, ValueError):
                    return None
            if isinstance(value, str):
                raw = value.strip()
                if not raw:
                    return None
                try:
                    return int(float(raw))
                except ValueError:
                    return None
            return None

        def normalize(value):
            if isinstance(value, dict):
                return {
                    "alias": str(value.get("alias", "")).strip(),
                    "icon": str(value.get("icon", "")).strip(),
                    "order": parse_order(value.get("order")),
                }
            if isinstance(value, str) and value.strip().startswith("{"):
                try:
                    parsed = ast.literal_eval(value)
                    if isinstance(parsed, dict):
                        return {
                            "alias": str(parsed.get("alias", "")).strip(),
                            "icon": str(parsed.get("icon", "")).strip(),
                            "order": parse_order(parsed.get("order")),
                        }
                except Exception:
                    pass
            return {"alias": str(value or "").strip(), "icon": "", "order": None}

        sanitized: Dict[str, Dict[str, str | int]] = {}
        for cid, value in aliases.items():
            key = cid.strip()
            if not key:
                continue
            norm = normalize(value)
            if not norm["alias"] and not norm["icon"] and norm.get("order") is None:
                continue
            entry: Dict[str, str | int] = {}
            if norm["alias"]:
                entry["alias"] = norm["alias"]
            if norm["icon"]:
                entry["icon"] = norm["icon"]
            if norm.get("order") is not None:
                entry["order"] = norm["order"]
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


def safe_filename(text: str, default: str = "container") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", text or "").strip("-._")
    return cleaned or default


def inspect_container(container_id: str) -> dict:
    """Retorna o JSON do docker inspect para um container."""
    output = run_docker_command(["inspect", container_id])
    parsed = json.loads(output)
    if not parsed:
        raise DockerCommandError(["inspect", container_id], "Inspect vazio")
    return parsed[0]


def ensure_dockerfiles_dir() -> Path:
    DOCKERFILES_DIR.mkdir(parents=True, exist_ok=True)
    return DOCKERFILES_DIR


def container_label_from_inspect(data: dict, fallback: str = "container") -> str:
    name = (data.get("Name") or "").lstrip("/") or data.get("Id") or fallback
    return safe_filename(name, fallback)


def build_run_args_from_inspect(data: dict) -> List[str]:
    config = data.get("Config") or {}
    host_cfg = data.get("HostConfig") or {}
    name = (data.get("Name") or "").lstrip("/")
    args: List[str] = ["run", "-d", "--name", name]

    restart_policy = (host_cfg.get("RestartPolicy") or {}).get("Name") or ""
    if restart_policy and restart_policy != "no":
        args += ["--restart", restart_policy]

    network_mode = host_cfg.get("NetworkMode") or ""
    if network_mode and network_mode not in ("default", "bridge"):
        args += ["--network", network_mode]

    for bind in host_cfg.get("Binds") or []:
        args += ["-v", bind]

    port_bindings = host_cfg.get("PortBindings") or {}
    for container_port, bindings in port_bindings.items():
        for binding in bindings or []:
            host_ip = binding.get("HostIp") or ""
            host_port = binding.get("HostPort") or ""
            if not host_port:
                continue
            if host_ip and host_ip not in ("0.0.0.0", ""):
                args += ["-p", f"{host_ip}:{host_port}:{container_port}"]
            else:
                args += ["-p", f"{host_port}:{container_port}"]

    for env in config.get("Env") or []:
        args += ["-e", env]

    if config.get("WorkingDir"):
        args += ["-w", config["WorkingDir"]]

    if config.get("User"):
        args += ["-u", config["User"]]

    image = config.get("Image") or data.get("Image") or ""
    args.append(image)

    # Entrypoint + Cmd
    entrypoint = config.get("Entrypoint") or []
    cmd = config.get("Cmd") or []
    args += entrypoint + cmd
    return args


def build_dockerfile_from_inspect(data: dict) -> str:
    config = data.get("Config") or {}
    mounts = data.get("Mounts") or []
    lines = []
    base_image = config.get("Image") or "scratch"
    lines.append(f"FROM {base_image}")

    for env in config.get("Env") or []:
        lines.append(f"ENV {env}")

    if config.get("WorkingDir"):
        lines.append(f"WORKDIR {config['WorkingDir']}")

    exposed = config.get("ExposedPorts") or {}
    for port in exposed.keys():
        lines.append(f"EXPOSE {port}")

    # Declarar volumes conhecidos
    for mount in mounts:
        if mount.get("Destination"):
            lines.append(f"VOLUME {mount['Destination']}")

    entrypoint = config.get("Entrypoint")
    if entrypoint:
        lines.append(f"ENTRYPOINT {json.dumps(entrypoint)}")

    cmd = config.get("Cmd")
    if cmd:
        lines.append(f"CMD {json.dumps(cmd)}")

    return "\n".join(lines) + "\n"


def build_run_script(run_args: List[str]) -> str:
    quoted = " ".join(shlex.quote(part) for part in run_args)
    return "#!/usr/bin/env bash\nset -euo pipefail\n\n" f"docker {quoted}\n"


def create_export_zip_from_inspect(data: dict, include_data: bool = False) -> bytes:
    dockerfile = build_dockerfile_from_inspect(data)
    run_args = build_run_args_from_inspect(data)
    run_script = build_run_script(run_args)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("Dockerfile", dockerfile)
        zf.writestr("run.sh", run_script)
        zf.writestr("inspect.json", json.dumps(data, indent=2))
        if include_data:
            # Exporta o filesystem do container (sem volumes externos) como rootfs.tar.gz
            with tempfile.NamedTemporaryFile(suffix=".tar") as tmp:
                try:
                    run_docker_command(["export", "-o", tmp.name, container_id])
                    with open(tmp.name, "rb") as tar_file:
                        zf.writestr("rootfs.tar", tar_file.read())
                except DockerCommandError as error:
                    zf.writestr(
                        "data-export.log",
                        f"Falha ao exportar dados: {error.stderr}",
                    )
    return buffer.getvalue()


def create_export_zip(container_id: str, include_data: bool = False) -> bytes:
    data = inspect_container(container_id)
    return create_export_zip_from_inspect(data, include_data)
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
        if route == "/api/system-stats":
            self._handle_get_system_stats()
            return
        if route == "/api/system-top":
            self._handle_get_system_top(parsed)
            return
        if route == "/api/bing-wallpaper":
            self._handle_get_bing_wallpaper(parsed)
            return
        if route.startswith("/api/containers/") and route.endswith("/export"):
            self._handle_export_container(route)
            return
        if route.startswith("/api/groups/") and route.endswith("/export"):
            self._handle_export_group(route)
            return
        if route.startswith("/api/containers/") and route.endswith("/dockerfile"):
            self._handle_get_dockerfile(route)
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Unknown path")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        route = parsed.path
        if route == "/api/containers/create-from-dockerfile":
            self._handle_create_from_dockerfile()
            return
        if route == "/api/containers/create-from-command":
            self._handle_create_from_command()
            return
        if route.startswith("/api/containers/") and route.endswith("/restart-policy"):
            self._handle_set_restart_policy(route)
            return
        if route.startswith("/api/containers/") and route.endswith("/dockerfile"):
            self._handle_save_dockerfile(route)
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

    def _handle_get_bing_wallpaper(self, parsed) -> None:
        qs = parse_qs(parsed.query)
        market = qs.get("mkt", ["en-US"])[0]
        try:
            payload = get_bing_wallpaper(market)
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
            self._send_json({"error": "Falha ao obter wallpaper do Bing.", "details": str(error)}, code=502)
            return
        except Exception as error:
            self._send_json({"error": "Falha ao obter wallpaper do Bing.", "details": str(error)}, code=502)
            return
        self._send_json(payload)

    def _handle_get_system_stats(self) -> None:
        self._send_json(get_system_stats())

    def _handle_get_system_top(self, parsed) -> None:
        qs = parse_qs(parsed.query)
        scope = qs.get("scope", ["containers"])[0]
        sort_key = qs.get("sort", ["cpu"])[0]
        limit_raw = qs.get("limit", ["10"])[0]
        try:
            limit = int(limit_raw)
        except ValueError:
            limit = 10
        try:
            payload = get_system_top(scope, sort_key, limit=limit)
        except DockerCommandError as error:
            self._send_json({"error": str(error), "details": error.stderr}, code=500)
            return
        except Exception as error:
            self._send_json({"error": "Falha ao obter consumo do sistema.", "details": str(error)}, code=500)
            return
        self._send_json(payload)

    def _handle_export_container(self, route: str) -> None:
        remainder = route[len("/api/containers/") :]
        container_id = remainder.replace("/export", "").strip("/")
        include_data = False
        qs = parse_qs(urlparse(self.path).query)
        if qs.get("includeData", ["false"])[0].lower() in ("1", "true", "yes"):
            include_data = True
        try:
            data = inspect_container(container_id)
            label = container_label_from_inspect(data, container_id)
            payload = create_export_zip_from_inspect(data, include_data=include_data)
        except DockerCommandError as error:
            self._send_json({"error": str(error), "details": error.stderr}, code=500)
            return

        filename = f"{label}-export.zip"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(payload)

    def _handle_export_group(self, route: str) -> None:
        group_name = route[len("/api/groups/") : -len("/export")]
        groups = self.server.group_store.read()
        container_ids = groups.get(group_name, [])
        if not container_ids:
            self._send_json({"error": "Grupo vazio ou inexistente"}, code=404)
            return
        include_data = False
        qs = parse_qs(urlparse(self.path).query)
        if qs.get("includeData", ["false"])[0].lower() in ("1", "true", "yes"):
            include_data = True

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for cid in container_ids:
                try:
                    data = inspect_container(cid)
                    label = container_label_from_inspect(data, cid)
                    payload = create_export_zip_from_inspect(data, include_data=include_data)
                except DockerCommandError as error:
                    zf.writestr(f"{cid}/error.txt", error.stderr or str(error))
                    continue
                with zipfile.ZipFile(io.BytesIO(payload)) as inner:
                    for name in inner.namelist():
                        zf.writestr(f"{label}/{name}", inner.read(name))

        filename = f"{safe_filename(group_name, 'group')}-export.zip"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(buffer.getvalue())

    def _handle_get_dockerfile(self, route: str) -> None:
        remainder = route[len("/api/containers/") :]
        container_id = remainder.replace("/dockerfile", "").strip("/")
        ensure_dockerfiles_dir()
        try:
            data = inspect_container(container_id)
        except DockerCommandError as error:
            self._send_json({"error": str(error), "details": error.stderr}, code=500)
            return
        container_name = (data.get("Name") or container_id).lstrip("/")
        folder = DOCKERFILES_DIR / container_name
        folder.mkdir(parents=True, exist_ok=True)
        dockerfile_path = folder / "Dockerfile"
        if not dockerfile_path.exists():
            dockerfile_content = build_dockerfile_from_inspect(data)
            dockerfile_path.write_text(dockerfile_content)
        else:
            dockerfile_content = dockerfile_path.read_text()
        self._send_json({"path": str(dockerfile_path), "content": dockerfile_content})

    def _handle_save_dockerfile(self, route: str) -> None:
        remainder = route[len("/api/containers/") :]
        container_id = remainder.replace("/dockerfile", "").strip("/")
        payload = self._read_json_body()
        content = (payload or {}).get("content", "")
        if not isinstance(content, str) or not content.strip():
            self._send_json({"error": "Conteúdo inválido"}, code=400)
            return
        ensure_dockerfiles_dir()
        try:
            data = inspect_container(container_id)
        except DockerCommandError as error:
            self._send_json({"error": str(error), "details": error.stderr}, code=500)
            return

        container_name = (data.get("Name") or container_id).lstrip("/")
        folder = DOCKERFILES_DIR / container_name
        folder.mkdir(parents=True, exist_ok=True)
        dockerfile_path = folder / "Dockerfile"
        dockerfile_path.write_text(content)

        # Opcional: reconstruir imagem e reiniciar container
        image_tag = (data.get("Config") or {}).get("Image") or container_name
        try:
            run_docker_command(["build", "-t", image_tag, str(folder)])
        except DockerCommandError as error:
            self._send_json({"error": "Falha ao buildar imagem", "details": error.stderr}, code=500)
            return

        try:
            run_docker_command(["stop", container_id])
        except DockerCommandError:
            pass

        # Recria o container com os mesmos argumentos (run)
        run_args = build_run_args_from_inspect(data)
        try:
            idx = run_args.index(image_tag)
            run_args[idx] = image_tag
        except ValueError:
            pass
        try:
            # Remove existente se sobrou
            run_docker_command(["rm", container_id])
        except DockerCommandError:
            pass
        try:
            run_docker_command(run_args)
        except DockerCommandError as error:
            self._send_json({"error": "Falha ao recriar container", "details": error.stderr}, code=500)
            return

        self._send_json({"path": str(dockerfile_path), "status": "saved"})

    def _handle_create_from_dockerfile(self) -> None:
        payload = self._read_json_body()
        name = (payload or {}).get("name", "").strip()
        dockerfile = (payload or {}).get("dockerfile", "").strip()
        cmd = (payload or {}).get("command", "").strip()
        env_file = (payload or {}).get("env", "")
        extra_files = payload.get("files", []) if isinstance(payload, dict) else []
        if not name or not dockerfile:
            self._send_json({"error": "Nome e Dockerfile são obrigatórios"}, code=400)
            return
        ensure_dockerfiles_dir()
        folder = DOCKERFILES_DIR / name
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "Dockerfile").write_text(dockerfile)
        if env_file:
            (folder / ".env").write_text(env_file)
        for file_entry in extra_files:
            fname = file_entry.get("name")
            content = file_entry.get("content", "")
            if fname:
                target = folder / fname
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content)

        image_tag = f"{name}:latest"
        try:
            run_docker_command(["build", "-t", image_tag, str(folder)])
            run_cmd = ["run", "-d", "--name", name]
            if env_file:
                run_cmd += ["--env-file", str(folder / ".env")]
            run_cmd.append(image_tag)
            if cmd:
                run_cmd += shlex.split(cmd)
            run_docker_command(run_cmd)
        except DockerCommandError as error:
            self._send_json({"error": "Falha ao criar container", "details": error.stderr}, code=500)
            return
        self._send_json({"status": "created", "name": name})

    def _handle_create_from_command(self) -> None:
        payload = self._read_json_body()
        command = (payload or {}).get("command", "").strip()
        if not command:
            self._send_json({"error": "Comando é obrigatório"}, code=400)
            return
        # Remove prefixo "docker" se o usuário incluir
        parts = shlex.split(command)
        if parts and parts[0] == "docker":
            parts = parts[1:]
        try:
            run_docker_command(parts)
        except DockerCommandError as error:
            self._send_json({"error": "Falha ao executar comando", "details": error.stderr}, code=500)
            return
        self._send_json({"status": "executed"})
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
            "delete": ["rm", "-f", container_id],
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

        # Parse multipart data
        boundary_bytes = f"--{boundary}".encode()
        parts = body.split(boundary_bytes)

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
                    # Extract filename (handle both filename="x" and filename=x)
                    if 'filename="' in disposition_line:
                        start = disposition_line.index('filename="') + 10
                        end = disposition_line.index('"', start)
                        filename = disposition_line[start:end]
                    elif 'filename=' in disposition_line:
                        # Handle unquoted filename
                        start = disposition_line.index('filename=') + 9
                        # Find end (semicolon or end of line)
                        rest = disposition_line[start:]
                        if ';' in rest:
                            filename = rest[:rest.index(';')].strip()
                        else:
                            filename = rest.strip()

                    # Extract file content (after double CRLF)
                    content_start = part.find(b"\r\n\r\n")
                    if content_start != -1:
                        file_data = part[content_start + 4:]
                        # Remove trailing CRLF
                        if file_data.endswith(b"\r\n"):
                            file_data = file_data[:-2]
                    break

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
