#!/bin/bash

# Docker Web Control - Uninstallation Script
# This script removes Docker Web Control from your system

set -e

MAIN_SERVICE_NAME="docker-web-control"
AUTOSTART_SERVICE_NAME="docker-web-control-autostart"
SYSTEM_INSTALL_DIR="/opt/docker-web-control"

echo "=========================================="
echo "Docker Web Control - Uninstallation"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  Warning: Some operations require root privileges"
    echo "Run with sudo for complete uninstallation"
    echo ""
fi

# Function to stop and disable services
uninstall_services() {
    echo "Removing systemd services..."

    # Stop services
    if systemctl is-active --quiet "$MAIN_SERVICE_NAME.service" 2>/dev/null; then
        echo "Stopping $MAIN_SERVICE_NAME service..."
        systemctl stop "$MAIN_SERVICE_NAME.service" 2>/dev/null || true
    fi

    if systemctl is-active --quiet "$AUTOSTART_SERVICE_NAME.service" 2>/dev/null; then
        echo "Stopping $AUTOSTART_SERVICE_NAME service..."
        systemctl stop "$AUTOSTART_SERVICE_NAME.service" 2>/dev/null || true
    fi

    # Disable services
    if systemctl is-enabled --quiet "$MAIN_SERVICE_NAME.service" 2>/dev/null; then
        echo "Disabling $MAIN_SERVICE_NAME service..."
        systemctl disable "$MAIN_SERVICE_NAME.service" 2>/dev/null || true
    fi

    if systemctl is-enabled --quiet "$AUTOSTART_SERVICE_NAME.service" 2>/dev/null; then
        echo "Disabling $AUTOSTART_SERVICE_NAME service..."
        systemctl disable "$AUTOSTART_SERVICE_NAME.service" 2>/dev/null || true
    fi

    # Remove service files
    if [ -f "/etc/systemd/system/$MAIN_SERVICE_NAME.service" ]; then
        echo "Removing service file: $MAIN_SERVICE_NAME.service"
        rm -f "/etc/systemd/system/$MAIN_SERVICE_NAME.service"
    fi

    if [ -f "/etc/systemd/system/$AUTOSTART_SERVICE_NAME.service" ]; then
        echo "Removing service file: $AUTOSTART_SERVICE_NAME.service"
        rm -f "/etc/systemd/system/$AUTOSTART_SERVICE_NAME.service"
    fi

    # Check for old service names
    if [ -f "/etc/systemd/system/docker-control.service" ]; then
        echo "Removing old service file: docker-control.service"
        systemctl stop docker-control.service 2>/dev/null || true
        systemctl disable docker-control.service 2>/dev/null || true
        rm -f "/etc/systemd/system/docker-control.service"
    fi

    if [ -f "/etc/systemd/system/docker-autostart.service" ]; then
        echo "Removing old service file: docker-autostart.service"
        systemctl stop docker-autostart.service 2>/dev/null || true
        systemctl disable docker-autostart.service 2>/dev/null || true
        rm -f "/etc/systemd/system/docker-autostart.service"
    fi

    # Reload systemd
    systemctl daemon-reload 2>/dev/null || true

    echo "✅ Services removed"
}

# Function to remove installation directory
remove_installation() {
    local install_dir="$1"

    if [ ! -d "$install_dir" ]; then
        echo "⚠️  Installation directory not found: $install_dir"
        return
    fi

    echo ""
    echo "Found installation at: $install_dir"
    echo ""
    echo "⚠️  WARNING: This will delete the entire directory!"
    echo "This includes:"
    echo "  - Application files"
    echo "  - Configuration (.env)"
    echo "  - Data directory (groups, aliases, autostart config)"
    echo "  - Uploaded icons"
    echo "  - Log files"
    echo ""
    read -p "Are you sure you want to delete $install_dir? (yes/no): " -r
    echo ""

    if [ "$REPLY" = "yes" ]; then
        # Offer to backup data
        echo "Would you like to backup the data directory before deletion?"
        read -p "Create backup? (y/n): " -n 1 -r
        echo ""

        if [[ $REPLY =~ ^[Yy]$ ]]; then
            BACKUP_DIR="${install_dir}_backup_$(date +%Y%m%d_%H%M%S)"
            echo "Creating backup of data directory..."
            mkdir -p "$BACKUP_DIR"

            if [ -d "$install_dir/data" ]; then
                cp -r "$install_dir/data" "$BACKUP_DIR/" 2>/dev/null || true
            fi

            if [ -d "$install_dir/icons" ]; then
                cp -r "$install_dir/icons" "$BACKUP_DIR/" 2>/dev/null || true
            fi

            if [ -f "$install_dir/.env" ]; then
                cp "$install_dir/.env" "$BACKUP_DIR/" 2>/dev/null || true
            fi

            echo "✅ Backup created at: $BACKUP_DIR"
            echo ""
        fi

        echo "Removing $install_dir..."
        rm -rf "$install_dir"
        echo "✅ Installation directory removed"
    else
        echo "Skipping directory removal"
    fi
}

# Main uninstallation flow
main() {
    # Remove services
    if [ "$EUID" -eq 0 ]; then
        uninstall_services
    else
        echo "⚠️  Skipping service removal (requires root)"
        echo "To remove services, run: sudo $0"
        echo ""
    fi

    # Check for system-wide installation
    if [ -d "$SYSTEM_INSTALL_DIR" ]; then
        if [ "$EUID" -eq 0 ]; then
            remove_installation "$SYSTEM_INSTALL_DIR"
        else
            echo "⚠️  System-wide installation found at: $SYSTEM_INSTALL_DIR"
            echo "To remove it, run: sudo $0"
        fi
    else
        echo "No system-wide installation found at $SYSTEM_INSTALL_DIR"
    fi

    # Check current directory
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "$SCRIPT_DIR/server.py" ]; then
        echo ""
        echo "Local installation detected in current directory: $SCRIPT_DIR"
        echo "Would you like to remove it?"
        read -p "Remove local installation? (y/n): " -n 1 -r
        echo ""

        if [[ $REPLY =~ ^[Yy]$ ]]; then
            remove_installation "$SCRIPT_DIR"
        fi
    fi

    echo ""
    echo "=========================================="
    echo "✅ Uninstallation Complete!"
    echo "=========================================="
    echo ""
    echo "Docker Web Control has been removed from your system."
    echo ""
    echo "Note: This script does not:"
    echo "  - Remove Docker itself"
    echo "  - Remove Python"
    echo "  - Stop or remove your Docker containers"
    echo ""
}

# Run uninstallation
main
