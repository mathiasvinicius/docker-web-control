# Configuração de Auto-Start para Containers Docker

Este guia explica como configurar containers e grupos para iniciarem automaticamente quando o sistema reiniciar.

## 🚀 Funcionalidades

- ✅ Iniciar grupos inteiros de containers no boot
- ✅ Iniciar containers individuais no boot
- ✅ Interface web para configuração fácil
- ✅ Logs detalhados de inicialização
- ✅ Integração com systemd

## 📋 Pré-requisitos

- Docker instalado e funcionando
- Sistema com systemd (Ubuntu, Debian, CentOS, etc.)
- Permissões de root/sudo
- Docker Web Control instalado (veja README.md)

## 🔧 Instalação

### Método Automático (Recomendado)

Se você instalou usando `sudo ./install.sh --system`, os serviços de autostart já foram configurados automaticamente durante a instalação!

Você pode habilitá-los com:

```bash
sudo systemctl enable docker-web-control-autostart
sudo systemctl start docker-web-control-autostart
sudo systemctl status docker-web-control-autostart
```

### Método Manual

Se você precisa configurar manualmente:

```bash
# Executar o instalador no modo system que gera os serviços automaticamente
cd /path/to/docker-web-control
sudo ./install.sh --system
```

O instalador irá:
1. Gerar o arquivo `docker-web-control-autostart.service` com os paths corretos
2. Copiar para `/etc/systemd/system/`
3. Oferecer habilitá-lo para o boot

## 📍 Localizando seu Diretório de Instalação

Se você não tem certeza onde o Docker Web Control está instalado:

```bash
# Via systemd (se instalado como serviço)
systemctl cat docker-web-control | grep WorkingDirectory

# Via processo em execução
ps aux | grep server.py

# Localizações comuns:
# - System-wide: /opt/docker-web-control
# - Desenvolvimento: onde você clonou o repositório
```

### 2. Configurar Containers/Grupos

Acesse a interface web em `http://localhost:8088` e:

1. Navegue até a seção **"Auto-start no Boot"** (na parte inferior da página)
2. Selecione os **grupos** que deseja iniciar automaticamente
3. Selecione **containers individuais** se necessário
4. Clique em **"Salvar Configurações"**

## 📝 Como Usar

### Via Interface Web

1. **Configurar Grupos para Auto-start:**
   - Marque os checkboxes dos grupos desejados na seção "Grupos para Auto-start"
   - O sistema mostrará quantos containers cada grupo possui

2. **Configurar Containers Individuais:**
   - Marque os checkboxes dos containers desejados na seção "Containers Individuais"
   - Você verá o status atual de cada container (Rodando/Parado)

3. **Salvar:**
   - Clique no botão "Salvar Configurações"
   - As configurações serão aplicadas no próximo boot do sistema

### Teste Manual do Autostart

Para testar sem reiniciar o sistema:

```bash
# Para instalação system-wide:
sudo python3 /opt/docker-web-control/autostart.py

# Para instalação customizada, detectar o caminho:
INSTALL_DIR=$(systemctl cat docker-web-control 2>/dev/null | grep WorkingDirectory | cut -d= -f2)
sudo python3 $INSTALL_DIR/autostart.py

# Ver logs (system-wide):
cat /opt/docker-web-control/autostart.log

# Ou via journalctl:
sudo journalctl -u docker-web-control-autostart
```

## 📊 Logs

Os logs de inicialização são salvos em:
```
/opt/docker-web-control/autostart.log
```

Para visualizar os logs em tempo real:
```bash
tail -f /opt/docker-web-control/autostart.log
```

Para ver logs do systemd:
```bash
sudo journalctl -u docker-web-control-autostart -f
```

## 🔄 Gerenciamento do Serviço

```bash
# Ver status
sudo systemctl status docker-web-control-autostart

# Habilitar (iniciar no boot)
sudo systemctl enable docker-web-control-autostart

# Desabilitar (não iniciar no boot)
sudo systemctl disable docker-web-control-autostart

# Executar manualmente (sem reiniciar)
sudo systemctl start docker-web-control-autostart

# Ver logs
sudo journalctl -u docker-web-control-autostart -n 50
```

## 📁 Arquivos de Configuração

- **`data/autostart.json`** - Configuração de quais containers/grupos iniciar
- **`autostart.py`** - Script que executa a inicialização
- **`docker-web-control-autostart.service`** - Arquivo de serviço systemd
- **`autostart.log`** - Log de execuções

## 🔍 Solução de Problemas

### Containers não iniciam no boot

1. **Verificar se o serviço está habilitado:**
   ```bash
   sudo systemctl is-enabled docker-web-control-autostart
   ```

2. **Verificar logs:**
   ```bash
   sudo journalctl -u docker-web-control-autostart -n 100
   ```

3. **Verificar configuração:**
   ```bash
   cat /opt/docker-web-control/data/autostart.json
   ```

### Docker não está pronto no boot

O serviço aguarda automaticamente até 10 tentativas (20 segundos) para o Docker estar pronto. Se ainda assim houver problemas:

1. Editar o serviço:
   ```bash
   sudo nano /etc/systemd/system/docker-web-control-autostart.service
   ```

2. Aumentar o tempo de espera em `ExecStartPre`:
   ```ini
   ExecStartPre=/bin/sleep 10
   ```

3. Recarregar e reiniciar:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart docker-web-control-autostart
   ```

### Verificar ordem de inicialização

O serviço `docker-web-control-autostart` está configurado para iniciar **depois** do Docker:
```ini
After=docker.service network.target
Requires=docker.service
```

## 📚 Exemplo de Uso

### Cenário: Iniciar stack de produção

1. **Criar grupo** "producao" com containers:
   - nginx
   - app-backend
   - postgres

2. **Marcar grupo para autostart:**
   - Acessar interface web
   - Marcar checkbox do grupo "producao"
   - Salvar configurações

3. **Testar:**
   ```bash
   # Parar todos os containers do grupo
   docker stop nginx app-backend postgres

   # Executar autostart manualmente
   sudo python3 /opt/docker-web-control/autostart.py

   # Verificar
   docker ps | grep -E "nginx|app-backend|postgres"
   ```

## ⚙️ Configuração Avançada

### Modificar timeout do Docker

Editar `autostart.py` e alterar:
```python
DOCKER_TIMEOUT = 30  # Aumentar se necessário
```

### Mudar ordem de inicialização

Os containers são iniciados na ordem em que aparecem nos grupos/lista. Para controlar a ordem:

1. Use grupos separados
2. Configure delays customizados editando `autostart.py`

## 🔐 Segurança

- O script roda como **root** (necessário para controlar Docker)
- Apenas containers/grupos configurados são iniciados
- Comandos Docker são sanitizados com `shlex.quote()`
- Logs registram todas as ações

## 📞 Suporte

Para problemas:
1. Verificar logs: `autostart.log` e `journalctl`
2. Verificar configuração: `data/autostart.json`
3. Testar manualmente: `python3 autostart.py`
