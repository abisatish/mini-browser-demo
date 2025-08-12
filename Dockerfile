FROM node:18-slim

# Install dependencies needed for Playwright/Chromium
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy all application code first
COPY . .

# Install dependencies in one RUN command to reduce layers
RUN npm install && \
    cd client && npm install && \
    cd ../server && npm install

# Build the React client
RUN cd client && npm run build

# Install Playwright browsers with dependencies
RUN cd server && npx playwright install --with-deps chromium

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