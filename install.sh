#!/bin/bash

# Docker Web Control - Enhanced Installation Script
# This script sets up Docker Web Control on any system with Docker installed

set -e

# ============================================================================
# CONFIGURATION
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_SYSTEM_INSTALL_DIR="/opt/docker-web-control"
SYSTEM_MODE=false
UPDATE_MODE=false

# Service names
MAIN_SERVICE_NAME="docker-web-control"
AUTOSTART_SERVICE_NAME="docker-web-control-autostart"

# ============================================================================
# PARSE ARGUMENTS
# ============================================================================
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --system)
                SYSTEM_MODE=true
                shift
                ;;
            --update)
                UPDATE_MODE=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

show_help() {
    cat <<EOF
Docker Web Control Installation Script

USAGE:
    ./install.sh [OPTIONS]

OPTIONS:
    --system    Install system-wide to /opt/docker-web-control (requires sudo)
    --update    Update existing installation (preserves data and config)
    --help      Show this help message

INSTALLATION MODES:
    1. Development/Custom Installation (default):
       ./install.sh

       Installs in current directory: $SCRIPT_DIR
       Suitable for development or custom locations

    2. System-wide Installation:
       sudo ./install.sh --system

       Installs to: $DEFAULT_SYSTEM_INSTALL_DIR
       Recommended for production use
       Requires root/sudo privileges

    3. Update Mode:
       sudo ./install.sh --update

       Updates code files in existing installation
       Preserves: .env, data/, icons/, service configuration
       Automatically detects installation location
       Restarts service if running

EXAMPLES:
    # Install in current directory
    ./install.sh

    # Install system-wide
    sudo ./install.sh --system

    # Update existing installation
    sudo ./install.sh --update

    # Get help
    ./install.sh --help
EOF
}

# ============================================================================
# VALIDATION FUNCTIONS
# ============================================================================
check_root_if_system_mode() {
    if [ "$SYSTEM_MODE" = true ] && [ "$EUID" -ne 0 ]; then
        echo "❌ Error: System-wide installation requires root privileges"
        echo "Please run: sudo ./install.sh --system"
        exit 1
    fi
}

check_docker_installed() {
    if ! command -v docker &> /dev/null; then
        echo "❌ Error: Docker is not installed!"
        echo "Please install Docker first: https://docs.docker.com/get-docker/"
        exit 1
    fi
    echo "✅ Docker found: $(docker --version)"
}

check_python_installed() {
    if ! command -v python3 &> /dev/null; then
        echo "❌ Error: Python 3 is not installed!"
        echo "Please install Python 3: https://www.python.org/downloads/"
        exit 1
    fi

    # Check version (3.6+)
    if ! python3 -c 'import sys; exit(0 if sys.version_info >= (3,6) else 1)' 2>/dev/null; then
        PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))' 2>/dev/null || echo "unknown")
        echo "❌ Error: Python 3.6+ required, found $PYTHON_VERSION"
        exit 1
    fi
    echo "✅ Python found: $(python3 --version)"
}

check_docker_permissions() {
    if ! docker ps &> /dev/null 2>&1; then
        echo "⚠️  Warning: Cannot access Docker daemon"
        echo "You may need to add your user to the docker group:"
        echo "  sudo usermod -aG docker \$USER"
        echo "  newgrp docker"
        echo ""
        # Don't exit - they might run as root
    else
        echo "✅ Docker permissions OK"
    fi
}

check_port_availability() {
    local port="${PORT:-8088}"
    if command -v lsof &> /dev/null; then
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo "⚠️  Warning: Port $port is already in use"
            echo "You may need to change the PORT in .env file"
        fi
    fi
}

# ============================================================================
# INSTALLATION FUNCTIONS
# ============================================================================
determine_install_dir() {
    if [ "$SYSTEM_MODE" = true ]; then
        INSTALL_DIR="$DEFAULT_SYSTEM_INSTALL_DIR"
    else
        INSTALL_DIR="$SCRIPT_DIR"
    fi
    echo "Installation directory: $INSTALL_DIR"
}

prepare_system_installation() {
    if [ "$SYSTEM_MODE" != true ]; then
        return
    fi

    echo "Preparing system-wide installation..."

    # Check if directory exists
    if [ -d "$INSTALL_DIR" ]; then
        echo ""
        echo "⚠️  Warning: $INSTALL_DIR already exists"
        echo "Options:"
        echo "  1) Backup and update (recommended)"
        echo "  2) Overwrite (data directory will be preserved)"
        echo "  3) Abort installation"
        read -p "Choose (1/2/3): " choice

        case $choice in
            1)
                BACKUP_DIR="${INSTALL_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
                echo "Creating backup at $BACKUP_DIR..."
                mv "$INSTALL_DIR" "$BACKUP_DIR"
                echo "✅ Backed up to: $BACKUP_DIR"
                ;;
            2)
                # Preserve data directory
                if [ -d "$INSTALL_DIR/data" ]; then
                    echo "Preserving data directory..."
                    cp -r "$INSTALL_DIR/data" "/tmp/docker-web-control-data.backup"
                fi
                ;;
            3)
                echo "Installation aborted"
                exit 0
                ;;
            *)
                echo "Invalid choice. Aborting."
                exit 1
                ;;
        esac
    fi

    # Create installation directory
    mkdir -p "$INSTALL_DIR"

    # Copy files
    echo "Copying files to $INSTALL_DIR..."

    # Core files
    cp "$SCRIPT_DIR/server.py" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/autostart.py" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/restart.sh" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/index.html" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/.env.example" "$INSTALL_DIR/"

    # Documentation
    cp "$SCRIPT_DIR/README.md" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/AUTOSTART_SETUP.md" "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR/LICENSE" "$INSTALL_DIR/" 2>/dev/null || true

    # Directories
    cp -r "$SCRIPT_DIR/static" "$INSTALL_DIR/" 2>/dev/null || true

    # Restore data if we backed it up
    if [ -d "/tmp/docker-web-control-data.backup" ]; then
        cp -r "/tmp/docker-web-control-data.backup" "$INSTALL_DIR/data"
        rm -rf "/tmp/docker-web-control-data.backup"
        echo "✅ Data directory restored"
    fi

    echo "✅ Files copied to $INSTALL_DIR"
}

setup_directories() {
    echo "Setting up directories..."

    mkdir -p "$INSTALL_DIR/data"
    mkdir -p "$INSTALL_DIR/icons"

    # Set permissions
    if [ "$SYSTEM_MODE" = true ]; then
        chown -R root:root "$INSTALL_DIR"
        chmod -R 755 "$INSTALL_DIR"
        chmod 755 "$INSTALL_DIR"/server.py "$INSTALL_DIR"/autostart.py "$INSTALL_DIR"/restart.sh 2>/dev/null || true
    else
        chmod +x "$INSTALL_DIR"/server.py "$INSTALL_DIR"/autostart.py "$INSTALL_DIR"/restart.sh 2>/dev/null || true
    fi

    echo "✅ Directories created"
}

install_dependencies() {
    echo "📦 Installing Python dependencies..."

    if [ -f "$INSTALL_DIR/requirements.txt" ]; then
        if [ "$SYSTEM_MODE" = true ]; then
            pip3 install -r "$INSTALL_DIR/requirements.txt" 2>/dev/null || {
                echo "⚠️  Warning: Could not install Python dependencies (optional)"
                echo "The application will still run without them"
            }
        else
            pip3 install -r "$INSTALL_DIR/requirements.txt" --user 2>/dev/null || {
                echo "⚠️  Warning: Could not install Python dependencies (optional)"
                echo "The application will still run without them"
            }
        fi
    fi
}

setup_env_file() {
    if [ ! -f "$INSTALL_DIR/.env" ]; then
        echo "📝 Creating .env file..."
        cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
        echo "✅ Created .env file (you can edit it to customize settings)"
    else
        echo "✅ .env file already exists"
    fi
}

# ============================================================================
# SYSTEMD SERVICE GENERATION
# ============================================================================
generate_main_service() {
    local service_file="$1"

    # Detect Python path
    local python_path=$(which python3 2>/dev/null || which python 2>/dev/null || echo "/usr/bin/python3")

    cat > "$service_file" <<EOF
[Unit]
Description=Docker Web Control Interface
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=$python_path $INSTALL_DIR/server.py
Restart=always
RestartSec=10
StandardOutput=append:$INSTALL_DIR/server.log
StandardError=append:$INSTALL_DIR/server.log

Environment="DOCKER_TIMEOUT=30"
Environment="HOST=0.0.0.0"
Environment="PORT=8088"

[Install]
WantedBy=multi-user.target
EOF
}

generate_autostart_service() {
    local service_file="$1"

    # Detect Python path
    local python_path=$(which python3 2>/dev/null || which python 2>/dev/null || echo "/usr/bin/python3")

    cat > "$service_file" <<EOF
[Unit]
Description=Docker Containers Autostart
After=docker.service network.target
Requires=docker.service
Wants=$MAIN_SERVICE_NAME.service

[Service]
Type=oneshot
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=$python_path $INSTALL_DIR/autostart.py
RemainAfterExit=yes
StandardOutput=append:$INSTALL_DIR/autostart.log
StandardError=append:$INSTALL_DIR/autostart.log

# Wait for Docker to be ready
ExecStartPre=/bin/sleep 5

[Install]
WantedBy=multi-user.target
EOF
}

offer_systemd_installation() {
    echo ""
    echo "=========================================="
    echo "Systemd Service Installation (Optional)"
    echo "=========================================="
    echo ""
    echo "Would you like to install systemd services?"
    echo "This allows Docker Web Control to run as a system service."
    echo ""
    read -p "Install systemd services? (y/n): " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping systemd installation"
        return
    fi

    # Check for root
    if [ "$EUID" -ne 0 ]; then
        echo "❌ Error: Installing systemd services requires root privileges"
        echo "Run this script with sudo to install services"
        return
    fi

    # Generate service files in temp location
    local temp_main_service="/tmp/$MAIN_SERVICE_NAME.service"
    local temp_autostart_service="/tmp/$AUTOSTART_SERVICE_NAME.service"

    echo "Generating service files..."
    generate_main_service "$temp_main_service"
    generate_autostart_service "$temp_autostart_service"

    # Check for old service names
    if systemctl list-unit-files 2>/dev/null | grep -q "docker-control.service"; then
        echo ""
        echo "⚠️  Warning: Old 'docker-control' service detected"
        echo "Would you like to disable it before installing new services?"
        read -p "Disable old service? (y/n): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            systemctl stop docker-control.service 2>/dev/null || true
            systemctl disable docker-control.service 2>/dev/null || true
            systemctl stop docker-autostart.service 2>/dev/null || true
            systemctl disable docker-autostart.service 2>/dev/null || true
            echo "✅ Old services disabled"
        fi
    fi

    # Install service files
    echo "Installing service files..."
    cp "$temp_main_service" "/etc/systemd/system/$MAIN_SERVICE_NAME.service"
    cp "$temp_autostart_service" "/etc/systemd/system/$AUTOSTART_SERVICE_NAME.service"

    # Reload systemd
    systemctl daemon-reload
    echo "✅ Service files installed"

    # Offer to enable services
    echo ""
    read -p "Enable services to start on boot? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        systemctl enable "$MAIN_SERVICE_NAME.service"
        systemctl enable "$AUTOSTART_SERVICE_NAME.service"
        echo "✅ Services enabled"
    fi

    # Offer to start services now
    echo ""
    read -p "Start services now? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        systemctl start "$MAIN_SERVICE_NAME.service"
        echo "✅ Service started"

        # Check status
        sleep 2
        if systemctl is-active --quiet "$MAIN_SERVICE_NAME.service"; then
            echo "✅ Service is running"
        else
            echo "⚠️  Warning: Service may have failed to start"
            echo "Check status with: systemctl status $MAIN_SERVICE_NAME"
        fi
    fi

    # Clean up temp files
    rm -f "$temp_main_service" "$temp_autostart_service"
}

# ============================================================================
# UPDATE MODE FUNCTIONS
# ============================================================================
detect_installation() {
    # Try to detect existing installation
    local detected_dir=""

    # Check if service exists and get WorkingDirectory
    if systemctl list-unit-files 2>/dev/null | grep -q "$MAIN_SERVICE_NAME.service"; then
        detected_dir=$(systemctl cat "$MAIN_SERVICE_NAME" 2>/dev/null | grep "^WorkingDirectory=" | cut -d= -f2)
    fi

    # Check common locations
    if [ -z "$detected_dir" ]; then
        if [ -f "$DEFAULT_SYSTEM_INSTALL_DIR/server.py" ]; then
            detected_dir="$DEFAULT_SYSTEM_INSTALL_DIR"
        elif [ -f "$SCRIPT_DIR/server.py" ]; then
            detected_dir="$SCRIPT_DIR"
        fi
    fi

    echo "$detected_dir"
}

update_installation() {
    echo "=========================================="
    echo "Docker Web Control - Update Mode"
    echo "=========================================="
    echo ""

    # Detect installation
    INSTALL_DIR=$(detect_installation)

    if [ -z "$INSTALL_DIR" ] || [ ! -d "$INSTALL_DIR" ]; then
        echo "❌ Error: No existing installation found"
        echo ""
        echo "Tried locations:"
        echo "  - $DEFAULT_SYSTEM_INSTALL_DIR"
        echo "  - Current directory: $SCRIPT_DIR"
        echo "  - Systemd service WorkingDirectory"
        echo ""
        echo "Please install first using:"
        echo "  sudo ./install.sh --system"
        exit 1
    fi

    echo "📍 Found installation at: $INSTALL_DIR"
    echo ""

    # Check if service is running
    SERVICE_RUNNING=false
    if systemctl is-active --quiet "$MAIN_SERVICE_NAME.service" 2>/dev/null; then
        SERVICE_RUNNING=true
        echo "🔄 Service is currently running"
    fi

    echo ""
    echo "Update will:"
    echo "  ✅ Update code files (server.py, autostart.py, etc.)"
    echo "  ✅ Update static files (HTML, CSS, JS)"
    echo "  ✅ Update documentation (README.md, etc.)"
    echo "  ⚠️  Preserve: .env, data/, icons/"
    if [ "$SERVICE_RUNNING" = true ]; then
        echo "  🔄 Restart the service"
    fi
    echo ""
    read -p "Continue with update? (y/n): " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Update cancelled"
        exit 0
    fi

    echo ""
    echo "Updating files..."

    # Core files
    cp "$SCRIPT_DIR/server.py" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/autostart.py" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/restart.sh" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/index.html" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/"

    # Documentation (optional)
    cp "$SCRIPT_DIR/README.md" "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR/AUTOSTART_SETUP.md" "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR/LICENSE" "$INSTALL_DIR/" 2>/dev/null || true

    # Static directory
    if [ -d "$SCRIPT_DIR/static" ]; then
        cp -r "$SCRIPT_DIR/static" "$INSTALL_DIR/" 2>/dev/null || true
    fi

    # Set permissions
    chmod +x "$INSTALL_DIR"/server.py "$INSTALL_DIR"/autostart.py "$INSTALL_DIR"/restart.sh 2>/dev/null || true

    echo "✅ Files updated"

    # Restart service if it was running
    if [ "$SERVICE_RUNNING" = true ]; then
        echo ""
        echo "Restarting service..."
        systemctl restart "$MAIN_SERVICE_NAME.service"
        sleep 2

        if systemctl is-active --quiet "$MAIN_SERVICE_NAME.service"; then
            echo "✅ Service restarted successfully"
        else
            echo "⚠️  Warning: Service may have failed to restart"
            echo "Check status with: systemctl status $MAIN_SERVICE_NAME"
        fi
    fi

    echo ""
    echo "=========================================="
    echo "✅ Update Complete!"
    echo "=========================================="
    echo ""
    echo "Updated: $INSTALL_DIR"
    echo ""
    if [ "$SERVICE_RUNNING" = true ]; then
        echo "Service status: Running"
        echo "View logs: sudo journalctl -u $MAIN_SERVICE_NAME -f"
    else
        echo "Service status: Not running"
        echo "Start with: sudo systemctl start $MAIN_SERVICE_NAME"
    fi
    echo ""
    echo "Access: http://localhost:8088"
    echo ""
}

# ============================================================================
# MAIN INSTALLATION FLOW
# ============================================================================
main() {
    parse_arguments "$@"

    # Handle update mode
    if [ "$UPDATE_MODE" = true ]; then
        update_installation
        exit 0
    fi

    echo "=========================================="
    echo "Docker Web Control - Installation"
    echo "=========================================="
    echo ""

    # Determine mode
    if [ "$SYSTEM_MODE" = true ]; then
        echo "Mode: System-wide installation"
    else
        echo "Mode: Development/Custom installation"
    fi
    echo ""

    # Pre-installation checks
    check_root_if_system_mode
    check_docker_installed
    check_python_installed
    check_docker_permissions

    # Determine installation directory
    determine_install_dir
    echo ""

    # Execute installation
    if [ "$SYSTEM_MODE" = true ]; then
        prepare_system_installation
    fi

    setup_directories
    install_dependencies
    setup_env_file
    check_port_availability

    echo ""
    echo "=========================================="
    echo "✅ Installation Complete!"
    echo "=========================================="
    echo ""
    echo "Installation directory: $INSTALL_DIR"
    echo ""

    if [ "$SYSTEM_MODE" = true ]; then
        # Offer systemd installation for system mode
        offer_systemd_installation

        echo ""
        echo "To manage the service:"
        echo "  sudo systemctl start $MAIN_SERVICE_NAME"
        echo "  sudo systemctl stop $MAIN_SERVICE_NAME"
        echo "  sudo systemctl status $MAIN_SERVICE_NAME"
        echo "  sudo journalctl -u $MAIN_SERVICE_NAME -f"
    else
        # Development mode - show manual instructions
        echo "To start the server manually:"
        echo "  cd $INSTALL_DIR"
        echo "  ./server.py"
        echo ""
        echo "Or use the restart script:"
        echo "  cd $INSTALL_DIR"
        echo "  ./restart.sh"
        echo ""
        echo "To install as systemd service later:"
        echo "  sudo ./install.sh --system"
    fi

    echo ""
    echo "Web interface will be available at:"
    echo "  http://localhost:8088"
    echo ""
    echo "For more information, see:"
    echo "  - README.md"
    echo "  - AUTOSTART_SETUP.md"
    echo ""
}

# Run main installation
main "$@"
