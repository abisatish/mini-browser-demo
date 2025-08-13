#!/bin/bash

# Startup script optimized for m7a.2xlarge (32GB RAM)
echo "🚀 Starting server optimized for 32GB RAM..."

# Set Node.js to use up to 24GB heap (leaving 8GB for OS and Chromium)
export NODE_OPTIONS="--max-old-space-size=24576 --max-semi-space-size=256"

# Set environment variables for 32GB configuration
export MAX_USERS=10
export BROWSER_WORKERS=6
export BROWSERS_PER_WORKER=2
export REQUEST_QUEUE_SIZE=100

# Start the server
node server-multithreaded.js