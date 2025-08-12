#!/bin/bash

echo "🚀 Starting Mini-Browser Server (Smooth Mode - 2-3 Users)"
echo "==========================================="
echo "Configuration:"
echo "  - Max Users: 3"
echo "  - Target FPS: 20"
echo "  - Screenshot Quality: 85%"
echo "  - Workers: 2"
echo "  - Browsers per Worker: 2"
echo "==========================================="

# Load smooth configuration
export MAX_USERS=3
export TARGET_FPS=20
export SCREENSHOT_QUALITY=85
export NODE_OPTIONS="--max-old-space-size=2048"

# Start the multi-threaded server
node server-multithreaded.js