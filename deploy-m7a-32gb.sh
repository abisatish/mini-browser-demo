#!/bin/bash

# AWS EC2 deployment script for m7a.2xlarge (8 vCPUs, 32GB RAM)
# Optimized for high-performance browser streaming with 10+ concurrent users

echo "🚀 Starting deployment for m7a.2xlarge (32GB RAM) instance..."

# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install build essentials
sudo apt-get install -y build-essential git

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
    libgtk-3-0 \
    libx11-xcb1 \
    libxcb-dri3-0 \
    libatspi2.0-0 \
    libcups2

# Set system limits for high concurrency
sudo bash -c 'cat >> /etc/security/limits.conf << EOF
* soft nofile 65535
* hard nofile 65535
* soft nproc 32768
* hard nproc 32768
EOF'

# Optimize system for 32GB RAM
sudo bash -c 'cat >> /etc/sysctl.conf << EOF
# Increase system memory limits
vm.max_map_count=262144
fs.file-max=2097152
fs.inotify.max_user_watches=524288
net.core.somaxconn=65535
net.ipv4.tcp_max_syn_backlog=3240000
EOF'
sudo sysctl -p

# Clone repository (adjust to your repo URL)
cd /home/ubuntu
git clone https://github.com/abisatish/mini-browser-demo.git
cd mini-browser-demo

# Build client
cd client
npm install
npm run build
cd ..

# Setup server with 32GB optimizations
cd server
npm install

# Install Playwright browsers with dependencies
npx playwright install chromium
npx playwright install-deps chromium

# Create environment file for 32GB configuration
cat > .env << EOF
# m7a.2xlarge Configuration (32GB RAM)
NODE_ENV=production
PORT=3001

# Optimized for 10-12 concurrent users
MAX_USERS=10
BROWSER_WORKERS=6
BROWSERS_PER_WORKER=2
REQUEST_QUEUE_SIZE=100

# Performance settings
TARGET_FPS=12
SCREENSHOT_QUALITY=75
PRIORITY_MODE=true

# Add your API keys here if needed
# OPENAI_API_KEY=your_key_here
# ANTHROPIC_API_KEY=your_key_here
EOF

# Create systemd service with 32GB optimizations
sudo cat > /etc/systemd/system/browser-server.service << 'EOF'
[Unit]
Description=Browser Streaming Server (32GB Optimized)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/mini-browser-demo/server

# Node.js memory settings for 32GB RAM
Environment="NODE_OPTIONS=--max-old-space-size=24576 --max-semi-space-size=256"
Environment="NODE_ENV=production"
Environment="PORT=3001"

# 32GB Configuration
Environment="MAX_USERS=10"
Environment="BROWSER_WORKERS=6"
Environment="BROWSERS_PER_WORKER=2"
Environment="REQUEST_QUEUE_SIZE=100"
Environment="TARGET_FPS=12"
Environment="SCREENSHOT_QUALITY=75"

# Use the multithreaded server
ExecStart=/usr/bin/node server-multithreaded.js

# Restart policy
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Process limits for high concurrency
LimitNOFILE=65535
LimitNPROC=32768

[Install]
WantedBy=multi-user.target
EOF

# Setup nginx for WebSocket proxy with optimizations
sudo apt-get install -y nginx
sudo cat > /etc/nginx/sites-available/browser-proxy << 'EOF'
server {
    listen 80;
    server_name _;
    
    # Increase buffer sizes for 32GB RAM
    client_body_buffer_size 128k;
    client_max_body_size 10m;
    client_header_buffer_size 1k;
    large_client_header_buffers 4 16k;
    
    # WebSocket specific
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    
    # Timeouts
    proxy_connect_timeout 7d;
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;
    
    # Buffering settings
    proxy_buffering off;
    tcp_nodelay on;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Disable buffering for streaming
        proxy_buffering off;
        proxy_cache off;
    }
}
EOF

# Optimize nginx for high concurrency
sudo cat > /etc/nginx/nginx.conf << 'EOF'
user www-data;
worker_processes auto;
worker_rlimit_nofile 65535;
pid /run/nginx.pid;

events {
    worker_connections 4096;
    multi_accept on;
    use epoll;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    # Logging
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;
    
    # Gzip
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml application/atom+xml image/svg+xml text/x-js text/x-cross-domain-policy application/x-font-ttf application/x-font-opentype application/vnd.ms-fontobject image/x-icon;
    
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
EOF

# Enable nginx site
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/browser-proxy /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Enable and start services
sudo systemctl daemon-reload
sudo systemctl enable browser-server
sudo systemctl start browser-server

# Create monitoring script
cat > ~/monitor.sh << 'EOF'
#!/bin/bash
echo "=== Browser Server Status ==="
sudo systemctl status browser-server --no-pager
echo ""
echo "=== Memory Usage ==="
free -h
echo ""
echo "=== Top Processes ==="
ps aux --sort=-%mem | head -10
echo ""
echo "=== Active Connections ==="
ss -tunap | grep :3001
echo ""
echo "=== Server Logs (last 20 lines) ==="
sudo journalctl -u browser-server -n 20 --no-pager
EOF
chmod +x ~/monitor.sh

# Create restart script
cat > ~/restart.sh << 'EOF'
#!/bin/bash
echo "Restarting browser server..."
sudo systemctl restart browser-server
echo "Server restarted. Checking status..."
sleep 3
sudo systemctl status browser-server --no-pager
EOF
chmod +x ~/restart.sh

# Final setup message
echo ""
echo "✅ ============================================="
echo "✅ Deployment Complete for m7a.2xlarge!"
echo "✅ ============================================="
echo ""
echo "📊 Configuration:"
echo "   - Max concurrent users: 10"
echo "   - Browser workers: 6"
echo "   - Browsers per worker: 2"
echo "   - Total browser capacity: 12"
echo "   - Node.js heap: 24GB"
echo "   - Worker heap: 3GB each"
echo ""
echo "🌐 Access your server at:"
echo "   http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
echo ""
echo "📝 Useful commands:"
echo "   ~/monitor.sh              - Check server status and memory"
echo "   ~/restart.sh              - Restart the server"
echo "   sudo journalctl -u browser-server -f   - View live logs"
echo "   sudo systemctl stop browser-server     - Stop server"
echo "   sudo systemctl start browser-server    - Start server"
echo ""
echo "⚠️  Remember to:"
echo "   1. Configure your AWS Security Group to allow ports 80 and 3001"
echo "   2. Add your API keys to /home/ubuntu/mini-browser-demo/server/.env"
echo "   3. Consider setting up an Elastic IP for a stable address"
echo "============================================="