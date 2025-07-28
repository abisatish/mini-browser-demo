#!/bin/bash

# AWS EC2 deployment script for high-performance browser streaming

# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install dependencies for Chromium
sudo apt-get install -y \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libxss1 \
    libgtk-3-0

# Clone and setup your app
git clone https://github.com/yourusername/mini-browser-demo.git
cd mini-browser-demo/server
npm install

# Install Playwright browsers
npx playwright install chromium

# For GPU instances (g4dn), enable GPU support
if nvidia-smi &> /dev/null; then
    echo "GPU detected, enabling hardware acceleration"
    export PLAYWRIGHT_CHROMIUM_USE_HARDWARE_ACCELERATION=1
fi

# Create systemd service for auto-start
sudo cat > /etc/systemd/system/browser-server.service << EOF
[Unit]
Description=Browser Streaming Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/mini-browser-demo/server
Environment="NODE_ENV=production"
Environment="PORT=3001"
Environment="TARGET_FPS=30"
Environment="NODE_ENV=production"
# For even higher FPS on powerful instances:
# Environment="TARGET_FPS=60"
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl enable browser-server
sudo systemctl start browser-server

# Setup nginx for WebSocket proxy (optional)
sudo apt-get install -y nginx
sudo cat > /etc/nginx/sites-available/browser-proxy << EOF
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/browser-proxy /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

echo "Server deployed! Access at http://<your-ec2-ip>"
echo "To view logs: journalctl -u browser-server -f"
echo "To change FPS: sudo systemctl edit browser-server"