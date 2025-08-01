#!/bin/bash

# AWS EC2 deployment script optimized for m5zn.xlarge instances
# High-performance browser automation with 4.5 GHz CPUs

set -e  # Exit on error

echo "🚀 Deploying Mini Browser Demo on AWS m5zn.xlarge"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running on EC2
if [ ! -f /sys/hypervisor/uuid ] || [ `head -c 3 /sys/hypervisor/uuid` != "ec2" ]; then
    echo -e "${YELLOW}Warning: This script is optimized for AWS EC2 instances${NC}"
fi

# Update system
echo -e "${GREEN}Updating system packages...${NC}"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

# Install essential tools
echo -e "${GREEN}Installing essential tools...${NC}"
sudo apt-get install -y curl git htop iotop build-essential

# Install Node.js 20 (LTS)
echo -e "${GREEN}Installing Node.js 20...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
echo -e "${GREEN}Installing PM2...${NC}"
sudo npm install -g pm2

# Install dependencies for Chromium
echo -e "${GREEN}Installing Chromium dependencies...${NC}"
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
    libgbm-dev \
    libxshmfence1

# Performance optimizations for m5zn
echo -e "${GREEN}Applying m5zn performance optimizations...${NC}"

# Install CPU frequency tools
sudo apt-get install -y linux-tools-common linux-tools-generic linux-tools-$(uname -r)

# Set CPU governor to performance (maximize 4.5 GHz speed)
echo 'GOVERNOR="performance"' | sudo tee /etc/default/cpufrequtils
sudo systemctl restart cpufrequtils 2>/dev/null || true

# Alternative method if cpufrequtils not available
for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
    echo "performance" | sudo tee $cpu > /dev/null 2>&1 || true
done

# Optimize system limits
echo -e "${GREEN}Optimizing system limits...${NC}"
sudo tee -a /etc/security/limits.conf > /dev/null <<EOF

# Mini Browser Demo Limits
* soft nofile 65535
* hard nofile 65535
* soft nproc 65535
* hard nproc 65535
EOF

# Optimize network settings for WebSocket
echo -e "${GREEN}Optimizing network settings...${NC}"
sudo tee -a /etc/sysctl.conf > /dev/null <<EOF

# Mini Browser Demo Network Optimizations
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.core.netdev_max_backlog = 5000
net.ipv4.tcp_congestion_control = bbr
net.core.default_qdisc = fq
EOF

sudo sysctl -p

# Clone repository (if not exists)
if [ ! -d "$HOME/mini-browser-demo" ]; then
    echo -e "${GREEN}Cloning repository...${NC}"
    cd $HOME
    git clone https://github.com/abisatish/mini-browser-demo.git
fi

cd $HOME/mini-browser-demo

# Build client
echo -e "${GREEN}Building client...${NC}"
cd client
npm install
npm run build
cd ..

# Setup server
echo -e "${GREEN}Setting up server...${NC}"
cd server
npm install

# Install Playwright browsers
echo -e "${GREEN}Installing Playwright browsers...${NC}"
npx playwright install chromium
npx playwright install-deps chromium

# Create environment file if not exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env file - Please add your API keys!${NC}"
    cat > .env <<EOF
# Server Configuration
PORT=3001
NODE_ENV=production

# Performance Settings for m5zn.xlarge
TARGET_FPS=10
NODE_OPTIONS="--max-old-space-size=12288"

# API Keys (EDIT THESE!)
OPENAI_API_KEY=your-openai-api-key-here
SERPAPI_KEY=optional-serpapi-key

# Cookie persistence (optional)
COOKIE_FILE=/home/ubuntu/mini-browser-demo/cookies.json
EOF
    echo -e "${RED}⚠️  Don't forget to edit .env with your API keys!${NC}"
fi

# Create PM2 ecosystem file (JSON format for ES modules)
echo -e "${GREEN}Creating PM2 configuration...${NC}"
cat > ecosystem.config.json <<'EOF'
{
  "apps": [{
    "name": "mini-browser",
    "script": "server.js",
    "instances": 1,
    "exec_mode": "fork",
    "env": {
      "NODE_ENV": "production",
      "PORT": "3001",
      "TARGET_FPS": "10"
    },
    "error_file": "logs/error.log",
    "out_file": "logs/out.log",
    "log_file": "logs/combined.log",
    "time": true,
    "max_memory_restart": "14G",
    "autorestart": true,
    "max_restarts": 10,
    "min_uptime": "10s",
    "node_args": "--max-old-space-size=12288",
    "merge_logs": true
  }]
}
EOF

# Create logs directory
mkdir -p logs

# Install and configure Nginx
echo -e "${GREEN}Installing Nginx...${NC}"
sudo apt-get install -y nginx

# Configure Nginx
sudo tee /etc/nginx/sites-available/mini-browser > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;
    
    # Increase timeouts for LinkedIn's slow pages
    proxy_connect_timeout 300;
    proxy_send_timeout 300;
    proxy_read_timeout 300;
    send_timeout 300;
    
    # WebSocket configuration
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # Additional headers
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Disable buffering for WebSocket
        proxy_buffering off;
    }
}
EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/mini-browser /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# Start application with PM2
echo -e "${GREEN}Starting application with PM2...${NC}"
pm2 start ecosystem.config.json
pm2 save

# Setup PM2 startup
PM2_STARTUP=$(pm2 startup systemd -u ubuntu --hp /home/ubuntu | grep "sudo env")
if [ ! -z "$PM2_STARTUP" ]; then
    eval "$PM2_STARTUP"
fi

# Install monitoring dashboard (optional)
echo -e "${GREEN}Setting up PM2 monitoring...${NC}"
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7

# Get instance information
INSTANCE_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || curl -s ifconfig.me)

# Final setup complete
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo ""
echo "Access your app at:"
echo -e "  ${GREEN}http://$INSTANCE_IP${NC}"
echo ""
echo "Useful commands:"
echo "  pm2 status         - Check app status"
echo "  pm2 logs           - View logs"
echo "  pm2 monit          - Real-time monitoring"
echo "  htop               - System resources"
echo "  sudo nginx -t      - Test nginx config"
echo ""
echo -e "${YELLOW}⚠️  Remember to:${NC}"
echo "  1. Edit /home/ubuntu/mini-browser-demo/server/.env with your API keys"
echo "  2. Configure security group to allow ports 80 and 3001"
echo "  3. Consider setting up SSL with Let's Encrypt"
echo ""
echo -e "${GREEN}To check if CPU is running at max speed (4.5 GHz):${NC}"
echo "  cat /proc/cpuinfo | grep 'cpu MHz'"