#!/bin/bash

# Secure API key setup script - DO NOT COMMIT THIS FILE TO GIT!
# Add this file to .gitignore

echo "Setting up API keys securely..."

# Create environment override file for systemd
sudo mkdir -p /etc/systemd/system/browser-server.service.d/
sudo tee /etc/systemd/system/browser-server.service.d/override.conf << EOF
[Service]
# Add your actual API keys here
Environment="OPENAI_API_KEY=$OPENAI_API_KEY"
Environment="ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"
EOF

# Reload systemd and restart service
sudo systemctl daemon-reload
sudo systemctl restart browser-server

echo "API keys configured!"
echo "To update keys in the future, edit: /etc/systemd/system/browser-server.service.d/override.conf"