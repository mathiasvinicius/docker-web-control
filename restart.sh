#!/bin/bash
# Script para reiniciar o servidor Docker Control

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/server.pid"
LOG_FILE="$SCRIPT_DIR/server.log"

echo "=== Reiniciando Docker Control Server ==="

# Encontra processo na porta 8088
PORT_PID=$(lsof -ti:8088 2>/dev/null || fuser 8088/tcp 2>/dev/null | awk '{print $1}')

if [ ! -z "$PORT_PID" ]; then
    echo "Encontrado processo na porta 8088 (PID: $PORT_PID)"

    # Verifica se precisa de sudo
    PROC_USER=$(ps -o user= -p $PORT_PID 2>/dev/null)
    if [ "$PROC_USER" = "root" ] && [ "$(whoami)" != "root" ]; then
        echo "Processo rodando como root, usando sudo..."
        sudo kill $PORT_PID 2>/dev/null
        sleep 2

        # Força se ainda estiver rodando
        if ps -p $PORT_PID > /dev/null 2>&1; then
            echo "Forçando parada..."
            sudo kill -9 $PORT_PID 2>/dev/null
        fi
    else
        kill $PORT_PID 2>/dev/null
        sleep 2

        if ps -p $PORT_PID > /dev/null 2>&1; then
            kill -9 $PORT_PID 2>/dev/null
        fi
    fi
    echo "✓ Servidor antigo parado"
else
    echo "Nenhum servidor rodando na porta 8088"
fi

# Inicia novo servidor
echo "Iniciando novo servidor..."
cd "$SCRIPT_DIR"

# Inicia como root se o usuário atual não for root
if [ "$(whoami)" != "root" ]; then
    echo "Iniciando servidor como root..."
    sudo nohup python3 server.py > "$LOG_FILE" 2>&1 &
    NEW_PID=$(pgrep -f "python3 server.py" | tail -1)
else
    nohup python3 server.py > "$LOG_FILE" 2>&1 &
    NEW_PID=$!
fi

echo $NEW_PID > "$PID_FILE"

sleep 2

# Verifica se iniciou
if ps -p $NEW_PID > /dev/null 2>&1; then
    echo "✓ Servidor iniciado com sucesso (PID: $NEW_PID)"
    echo "✓ Logs em: $LOG_FILE"

    # Testa a API
    if curl -s http://localhost:8088/api/containers > /dev/null; then
        echo "✓ API respondendo corretamente"
    else
        echo "⚠ API não está respondendo, verificar logs"
    fi
else
    echo "✗ Falha ao iniciar servidor, verificar logs"
    cat "$LOG_FILE"
    exit 1
fi
