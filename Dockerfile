FROM node:18-slim

# Install dependencies needed for Playwright/Chromium and sharp
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

# Install dependencies
RUN npm install
RUN cd client && npm install
RUN cd server && npm install

# Copy application code
COPY . .

# Build the React client
RUN cd client && npm run build

# Install Playwright browsers (just Chromium)
RUN cd server && npx playwright install chromium

# Set default environment variables optimized for Railway (8 vCPUs, 8GB RAM)
ENV MAX_USERS=3
ENV TARGET_FPS=15
ENV SCREENSHOT_QUALITY=80
ENV BROWSER_WORKERS=2
ENV BROWSERS_PER_WORKER=2
ENV NODE_OPTIONS="--max-old-space-size=6144"
ENV SCREENSHOT_COMPRESSION=false
ENV PRIORITY_MODE=true

# Expose port (Railway will override this with PORT env var)
EXPOSE 3001

# Change to server directory and start the multi-threaded server
WORKDIR /app/server
CMD ["node", "server-multithreaded.js"]