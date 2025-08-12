# Multi-threaded Server Deployment Guide

## Architecture Overview

The multi-threaded server uses Worker Threads to handle concurrent users efficiently:

### Thread Architecture:
1. **Main Thread**: Handles HTTP/WebSocket connections, routing, and coordination
2. **Browser Workers** (2-4 threads): Each manages 1-3 browser instances
3. **Screenshot Worker**: Dedicated thread for image processing and compression
4. **AI Worker** (optional): Handles AI API calls without blocking

### Key Features:
- **Session Management**: Tracks active sessions with automatic cleanup
- **Browser Pooling**: Isolates users in separate browser instances
- **Request Queuing**: Prioritizes commands and prevents overload
- **Automatic Recovery**: Restarts failed workers automatically
- **Performance Monitoring**: Real-time stats via /api/health endpoint

## Performance Capabilities

### Railway (512MB - 8GB RAM):
- **10 concurrent users** with smooth performance
- **8 FPS** screenshot updates
- **9 browser instances** (3 workers × 3 browsers)
- **~400MB per browser** memory usage
- **Total: ~4GB RAM** for full capacity

### Scaling Options:

#### Light Load (4-5 users):
```env
MAX_USERS=5
WORKER_THREADS=2
BROWSERS_PER_WORKER=3
TARGET_FPS=10
```

#### Medium Load (10 users):
```env
MAX_USERS=10
WORKER_THREADS=3
BROWSERS_PER_WORKER=3
TARGET_FPS=8
```

#### Heavy Load (15+ users - AWS recommended):
```env
MAX_USERS=20
WORKER_THREADS=4
BROWSERS_PER_WORKER=5
TARGET_FPS=6
```

## Deployment Instructions

### Railway Deployment:

1. **Set environment variables** in Railway dashboard:
   ```
   PORT=3001
   MAX_USERS=10
   TARGET_FPS=8
   OPENAI_API_KEY=your_key
   ANTHROPIC_API_KEY=your_key
   NODE_OPTIONS=--max-old-space-size=4096
   ```

2. **Update start command** in Railway:
   ```
   npm run start:multi
   ```

3. **Monitor performance**:
   - Check `/api/health` endpoint
   - Monitor Railway metrics dashboard
   - Watch for memory usage

### AWS EC2 Deployment (Recommended for 10+ users):

1. **Instance Type**: t3.xlarge (4 vCPU, 16GB RAM)

2. **Setup commands**:
   ```bash
   # Install Node.js 18+
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Install Chrome dependencies
   sudo apt-get update
   sudo apt-get install -y \
     libnss3 libatk-bridge2.0-0 libdrm2 \
     libxkbcommon0 libgbm1 libasound2
   
   # Clone and setup
   git clone your-repo
   cd mini-browser-demo/server
   npm install
   
   # Set environment
   export MAX_USERS=20
   export WORKER_THREADS=4
   export NODE_OPTIONS="--max-old-space-size=12288"
   
   # Run with PM2
   npm install -g pm2
   pm2 start server-multithreaded.js --name mini-browser
   pm2 save
   pm2 startup
   ```

## Monitoring & Debugging

### Health Check Endpoint:
```bash
curl http://your-server/api/health
```

Returns:
```json
{
  "status": "ok",
  "sessions": {
    "active": 5,
    "max": 10
  },
  "workers": {
    "totalBrowsers": 5,
    "averageLoad": 0.55
  },
  "queues": {
    "requests": 2,
    "screenshots": 1
  }
}
```

### Common Issues:

1. **High Memory Usage**:
   - Reduce BROWSERS_PER_WORKER
   - Lower SCREENSHOT_QUALITY
   - Decrease TARGET_FPS

2. **Slow Response**:
   - Check worker load via /api/health
   - Increase WORKER_THREADS if CPU available
   - Review REQUEST_QUEUE_SIZE

3. **Browser Crashes**:
   - Workers auto-restart
   - Check logs for crash reasons
   - May need to increase memory limits

## Performance Tuning

### For Railway (Limited Resources):
- Keep `WORKER_THREADS` at 2-3
- Use `SCREENSHOT_QUALITY` of 60-70
- Set `TARGET_FPS` to 6-8
- Enable aggressive cleanup with shorter `SESSION_TIMEOUT`

### For AWS (More Resources):
- Increase `WORKER_THREADS` to 4-6
- Use `SCREENSHOT_QUALITY` of 80
- Set `TARGET_FPS` to 10-15
- Longer `SESSION_TIMEOUT` for better UX

## Testing

Run the load test script:
```bash
node test-concurrent.js
```

This will simulate multiple concurrent users and report performance metrics.