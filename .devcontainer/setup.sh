#!/usr/bin/env bash
set -e

# Load nvm
export NVM_DIR="/usr/local/share/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Use project-specified Node version (or LTS)
nvm install
nvm use
corepack enable

# Optional: ensure Playwright browsers are installed globally
npx playwright install --with-deps
npm install -g @anthropic-ai/claude-code

# Install kubelogin for AKS authentication
echo "Installing kubelogin..."
KUBELOGIN_VERSION=$(curl -s https://api.github.com/repos/Azure/kubelogin/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
curl -sSL "https://github.com/Azure/kubelogin/releases/download/${KUBELOGIN_VERSION}/kubelogin-linux-amd64.zip" -o /tmp/kubelogin.zip
unzip -q /tmp/kubelogin.zip -d /tmp
sudo mv /tmp/bin/linux_amd64/kubelogin /usr/local/bin/
sudo chmod +x /usr/local/bin/kubelogin
rm -rf /tmp/kubelogin.zip /tmp/bin
echo "✅ kubelogin ${KUBELOGIN_VERSION} installed"

# Configure bash history for unlimited size
echo "Configuring bash history..."
cat >> /home/vscode/.bashrc << 'EOF'

# Unlimited bash history with timestamps (matches host format)
HISTSIZE=-1
HISTFILESIZE=-1
HISTTIMEFORMAT="%F %T "
shopt -s histappend
EOF
echo "✅ Bash history configured"

echo "✅ Dev container setup complete."
