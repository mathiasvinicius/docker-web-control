# Docker Web Control

**Visualize, group and automate Docker containers — in a CasaOS‑inspired web UI.**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Docker](https://img.shields.io/badge/docker-required-blue)

[🇧🇷 Português](#-português) · [🇺🇸 English](#-english)

## 📸 Screenshots

<details open>
<summary><strong>🇧🇷 Português (PT‑BR)</strong></summary>

<img src="docs/images/main-interface_pt.png" alt="Docker Web Control - Interface principal (PT-BR)" width="900" />

</details>

<details>
<summary><strong>🇺🇸 English</strong></summary>

<img src="docs/images/main-interface_en.png" alt="Docker Web Control - Main interface (EN)" width="900" />

</details>

---

## 🇧🇷 Português

### ✨ Destaques

- 🎴 **Cards visuais**: containers individuais + grupos
- ↕ **Organização por arrastar e soltar** (ordem persistida como apelidos/ícones)
- 🧩 **Grupos**: criar, adicionar/remover containers, ações em lote
- 🚀 **Auto-start** por container ou grupo (atualiza restart policy no Docker)
- 🌄 **Fundo Bing opcional** + controle de transparência do painel
- 🕒 **Widgets (CasaOS‑like)**: relógio + status do sistema (CPU/RAM) com Top 10 (containers ou processos)
- 🏷️ **Apelidos & ícones** (com upload de ícones)
- 🧱 **Criar containers** via Dockerfile ou comando CLI
- 📦 **Exportar** container/grupo como ZIP
- 🌐 **Idiomas**: PT‑BR e EN

### ✅ Requisitos

- Docker instalado e rodando
- Python 3.10+
- Permissão para executar `docker` (ex.: usuário no grupo `docker`)

### 🚀 Instalação (recomendado: /opt + systemd)

```bash
git clone https://github.com/mathiasvinicius/docker-web-control.git
cd docker-web-control
sudo ./install.sh --system
```

Acesse: `http://localhost:8088`

### 🔄 Atualização

```bash
cd docker-web-control
git pull
sudo ./install.sh --update
```

### ⚙️ Configuração (`.env`)

`server.py` e `autostart.py` carregam `.env` automaticamente (sem sobrescrever variáveis já definidas).

```bash
HOST=0.0.0.0
PORT=8088
DOCKER_TIMEOUT=30
# DEBUG=1
```

### 🧭 Dicas de uso

- **Top CPU/RAM**: clique em **CPU** ou **RAM** no widget “Status do Sistema”.
  - ✅ “Apenas containers” (padrão): usa `docker stats`
  - ⛔ desmarcado: lista processos do sistema (tipo `htop`)
  - Sempre mostra **no máximo 10 itens**

### 📡 API (principais endpoints)

- `GET /api/containers`
- `POST /api/containers/{id}/start|stop|restart|delete`
- `POST /api/containers/{id}/restart-policy`
- `GET /api/groups` / `POST /api/groups`
- `GET /api/autostart` / `POST /api/autostart`
- `GET /api/container-aliases` / `POST /api/container-aliases`
- `POST /api/upload-icon`
- `GET /api/bing-wallpaper?mkt=pt-BR|en-US`
- `GET /api/system-stats`
- `GET /api/system-top?scope=containers|processes&sort=cpu|mem&limit=10`

### 🧩 Auto-start no boot (opcional)

Veja o guia: `AUTOSTART_SETUP.md`.

---

## 🇺🇸 English

### ✨ Highlights

- 🎴 **Visual cards**: standalone containers + groups
- ↕ **Drag & drop ordering** (persisted like aliases/icons)
- 🧩 **Groups**: create, add/remove containers, batch actions
- 🚀 **Auto-start** per container or group (updates Docker restart policy)
- 🌄 **Optional Bing wallpaper** + panel transparency control
- 🕒 **CasaOS‑like widgets**: clock + system status (CPU/RAM) with Top 10 (containers or processes)
- 🏷️ **Aliases & icons** (with icon upload)
- 🧱 **Create containers** via Dockerfile or CLI command
- 📦 **Export** container/group as ZIP
- 🌐 **Languages**: PT‑BR and EN

### ✅ Requirements

- Docker installed and running
- Python 3.10+
- Permission to run `docker` (e.g., user in the `docker` group)

### 🚀 Install (recommended: /opt + systemd)

```bash
git clone https://github.com/mathiasvinicius/docker-web-control.git
cd docker-web-control
sudo ./install.sh --system
```

Open: `http://localhost:8088`

### 🔄 Update

```bash
cd docker-web-control
git pull
sudo ./install.sh --update
```

### ⚙️ Configuration (`.env`)

`server.py` and `autostart.py` load `.env` automatically (without overriding existing env vars).

```bash
HOST=0.0.0.0
PORT=8088
DOCKER_TIMEOUT=30
# DEBUG=1
```

### 🧭 Usage tips

- **Top CPU/RAM**: click **CPU** or **RAM** in the “System status” widget.
  - ✅ “Only containers” (default): uses `docker stats`
  - ⛔ unchecked: shows system processes (htop‑like)
  - Always shows **up to 10 items**

### 📡 API (main endpoints)

- `GET /api/containers`
- `POST /api/containers/{id}/start|stop|restart|delete`
- `POST /api/containers/{id}/restart-policy`
- `GET /api/groups` / `POST /api/groups`
- `GET /api/autostart` / `POST /api/autostart`
- `GET /api/container-aliases` / `POST /api/container-aliases`
- `POST /api/upload-icon`
- `GET /api/bing-wallpaper?mkt=pt-BR|en-US`
- `GET /api/system-stats`
- `GET /api/system-top?scope=containers|processes&sort=cpu|mem&limit=10`

### 🧩 Auto-start on boot (optional)

See: `AUTOSTART_SETUP.md`.

---

## 📄 License

MIT — see `LICENSE`.
