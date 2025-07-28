#!/bin/bash

echo "Setting up SSL for secure WebSocket (wss://)"
echo "==========================================="

# Install certbot
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx

# Get your domain name
echo "Enter your domain name (e.g., browser.yourdomain.com):"
read DOMAIN

# Update nginx config for your domain
sudo cat > /etc/nginx/sites-available/browser-proxy << EOF
server {
    listen 80;
    server_name $DOMAIN;

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

# Restart nginx
sudo systemctl restart nginx

# Get SSL certificate
sudo certbot --nginx -d $DOMAIN

echo "SSL setup complete!"
echo "Your secure WebSocket URL is: wss://$DOMAIN"
echo ""
echo "Update your client to use:"
echo "const serverUrl = 'wss://$DOMAIN';"