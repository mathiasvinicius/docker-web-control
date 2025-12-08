#!/usr/bin/env python3
"""
Configuration loader for Docker Web Control.
Loads settings from environment variables or .env file.
"""

import os
from pathlib import Path
from typing import Optional

# Try to load .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    BASE_DIR = Path(__file__).resolve().parent
    ENV_FILE = BASE_DIR / ".env"
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE)
except ImportError:
    pass  # python-dotenv not installed, use environment variables only


class Config:
    """Application configuration."""

    # Server settings
    HOST: str = os.environ.get("HOST", "0.0.0.0")
    PORT: int = int(os.environ.get("PORT", "8088"))

    # Docker settings
    DOCKER_TIMEOUT: int = int(os.environ.get("DOCKER_TIMEOUT", "30"))

    # Debug mode
    DEBUG: bool = bool(os.environ.get("DEBUG", ""))

    # Paths
    BASE_DIR: Path = Path(__file__).resolve().parent
    STATIC_DIR: Path = BASE_DIR / "static"
    INDEX_FILE: Path = BASE_DIR / "index.html"
    DATA_DIR: Path = BASE_DIR / "data"

    # Data files
    GROUPS_FILE: Path = DATA_DIR / "groups.json"
    GROUP_ALIASES_FILE: Path = DATA_DIR / "group_aliases.json"
    CONTAINER_ALIASES_FILE: Path = DATA_DIR / "container_aliases.json"
    AUTOSTART_FILE: Path = DATA_DIR / "autostart.json"

    @classmethod
    def validate(cls) -> None:
        """Validate configuration and create necessary directories."""
        cls.DATA_DIR.mkdir(parents=True, exist_ok=True)
        cls.STATIC_DIR.mkdir(parents=True, exist_ok=True)


# Validate configuration on import
Config.validate()
