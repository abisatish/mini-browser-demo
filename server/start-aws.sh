#!/bin/bash

echo "🚀 Starting High-Performance Browser Server"
echo "==========================================="

# Set high performance settings
export TARGET_FPS=${TARGET_FPS:-30}
export NODE_ENV=production
export PORT=${PORT:-3001}

echo "Configuration:"
echo "- Target FPS: $TARGET_FPS"
echo "- Port: $PORT"
echo "- Node Environment: $NODE_ENV"
echo ""

# Check available CPU cores
CORES=$(nproc)
echo "Available CPU cores: $CORES"

# For high FPS, use more aggressive settings
if [ "$TARGET_FPS" -ge 30 ]; then
    echo "High FPS mode enabled - optimizing for performance"
    export NODE_OPTIONS="--max-old-space-size=4096"
    
    # Set CPU governor to performance (if available)
    if command -v cpupower &> /dev/null; then
        sudo cpupower frequency-set -g performance 2>/dev/null || true
    fi
fi

# Start the server with performance monitoring
echo ""
echo "Starting server..."
echo "Access at: http://$(curl -s ifconfig.me):$PORT"
echo ""

# Run with real-time performance stats
node server.js | while IFS= read -r line; do
    echo "[$(date '+%H:%M:%S')] $line"
    
    # Log warnings about slow frames
    if [[ $line == *"Slow frame"* ]]; then
        echo "⚠️  PERFORMANCE WARNING: Slow frame detected"
    fi
done