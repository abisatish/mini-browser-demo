# AWS EC2 Setup Guide for Mini Browser Demo

## Quick Setup for m5zn.xlarge Instance

### 1. Launch EC2 Instance

1. Go to AWS EC2 Console
2. Click "Launch Instance"
3. Configure:
   - **Name**: mini-browser-demo
   - **AMI**: Ubuntu Server 22.04 LTS (64-bit x86)
   - **Instance Type**: `m5zn.xlarge` (4 vCPUs, 16 GB RAM, 4.5 GHz CPU)
   - **Key Pair**: Create new or use existing
   - **Network Settings**: 
     - Allow SSH (port 22)
     - Allow HTTP (port 80)
     - Allow Custom TCP (port 3001)
   - **Storage**: 30 GB gp3 (faster than gp2)

### 2. Connect to Instance

```bash
ssh -i your-key.pem ubuntu@your-ec2-public-ip
```

### 3. Quick Deploy

```bash
# Download and run the deployment script
curl -O https://raw.githubusercontent.com/yourusername/mini-browser-demo/main/server/deploy-aws.sh
chmod +x deploy-aws.sh
./deploy-aws.sh
```

### 4. Manual Setup (if needed)

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Git
sudo apt-get install -y git

# Clone your repository
git clone https://github.com/yourusername/mini-browser-demo.git
cd mini-browser-demo

# Build client
cd client
npm install
npm run build
cd ..

# Setup server
cd server
npm install

# Install Playwright browsers
npx playwright install chromium
npx playwright install-deps

# Create environment file
cat > .env << EOF
PORT=3001
TARGET_FPS=10
OPENAI_API_KEY=your-api-key-here
SERPAPI_KEY=your-serpapi-key-if-needed
EOF

# Start server
npm start
```

### 5. Setup as System Service

```bash
# Create systemd service
sudo nano /etc/systemd/system/mini-browser.service
```

Add this content:
```ini
[Unit]
Description=Mini Browser Demo Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/mini-browser-demo/server
Environment="NODE_ENV=production"
Environment="PORT=3001"
Environment="TARGET_FPS=10"
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl enable mini-browser
sudo systemctl start mini-browser

# Check status
sudo systemctl status mini-browser

# View logs
sudo journalctl -u mini-browser -f
```

### 6. Setup Nginx Reverse Proxy (Recommended)

```bash
# Install nginx
sudo apt-get install -y nginx

# Configure proxy
sudo nano /etc/nginx/sites-available/mini-browser
```

Add:
```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        
        # WebSocket specific
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/mini-browser /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

### 7. Performance Optimization for m5zn.xlarge

```bash
# Set CPU governor to performance
sudo apt-get install -y linux-tools-common linux-tools-$(uname -r)
echo 'GOVERNOR="performance"' | sudo tee /etc/default/cpufrequtils
sudo systemctl restart cpufrequtils

# Increase file limits
sudo nano /etc/security/limits.conf
# Add:
# ubuntu soft nofile 65535
# ubuntu hard nofile 65535

# Optimize network
sudo nano /etc/sysctl.conf
# Add:
# net.core.rmem_max = 134217728
# net.core.wmem_max = 134217728
# net.ipv4.tcp_rmem = 4096 87380 134217728
# net.ipv4.tcp_wmem = 4096 65536 134217728

sudo sysctl -p
```

### 8. SSL Setup (Optional but Recommended)

```bash
# Install Certbot
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot

# Get certificate (replace with your domain)
sudo certbot --nginx -d yourdomain.com
```

### 9. Monitoring

```bash
# Install monitoring tools
sudo apt-get install -y htop iotop nethogs

# Monitor in real-time
htop  # CPU/Memory
iotop  # Disk I/O
nethogs  # Network usage

# Check browser server logs
sudo journalctl -u mini-browser -f
```

### 10. Cost Optimization

- **Use Spot Instances**: Up to 70% cheaper
  - In EC2 console, choose "Spot" under Advanced Details
  - Set max price at 50% of on-demand price
  
- **Auto Start/Stop**:
  - Use AWS Lambda + CloudWatch Events to stop instance at night
  - Start only when needed

- **Use Savings Plans**: 
  - If running 24/7, commit to 1-year for 40% discount

## Troubleshooting

### High CPU Usage
```bash
# Check what's using CPU
top -H
ps aux | sort -k3 -nr | head
```

### Memory Issues
```bash
# Check memory
free -h
# Clear cache if needed
sudo sync && echo 3 | sudo tee /proc/sys/vm/drop_caches
```

### Screenshot Timeouts
- Increase timeout in server.js
- Check LinkedIn for bot detection
- Reduce TARGET_FPS if needed

## Access Your App

Once deployed:
- Direct: `http://your-ec2-ip:3001`
- Via Nginx: `http://your-ec2-ip`
- With domain: `https://yourdomain.com`

## Important Security Notes

1. **Change default security group** to only allow your IP for SSH
2. **Keep your API keys secure** - use AWS Secrets Manager or Parameter Store
3. **Enable CloudWatch monitoring** for alerts
4. **Regular updates**: `sudo apt-get update && sudo apt-get upgrade`