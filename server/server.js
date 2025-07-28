import express from 'express';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  console.log('Starting mini-browser server...');
  
  // Launch browser with proper options for containerized environment
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });
  
  const context = await browser.newContext({ 
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    deviceScaleFactor: 2, // Higher quality rendering
    hasTouch: false,
    javascriptEnabled: true
  });
  
  const page = await context.newPage();
  
  // Error handling for page crashes
  page.on('crash', async () => {
    console.log('Page crashed, creating new page...');
    const newPage = await context.newPage();
    Object.setPrototypeOf(page, Object.getPrototypeOf(newPage));
    Object.assign(page, newPage);
    await page.goto('https://ai.google');
  });
  
  await page.goto('https://ai.google');
  console.log('Browser page loaded - Google AI');

  const app = express();
  const wss = new WebSocketServer({ noServer: true });

  // Serve static files from the built client
  app.use(express.static(path.join(__dirname, '../client/dist')));

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok',
      message: 'Mini Browser Server Running',
      timestamp: new Date().toISOString()
    });
  });

  // Serve the React app for all other routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });

  // WebSocket connection handler
  wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection established');
    
    ws.on('message', async (msg) => {
      try {
        const m = JSON.parse(msg.toString());
        
        switch (m.cmd) {
          case 'nav':
            console.log('Navigating to:', m.url);
            try {
              await page.goto(m.url, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
              });
            } catch (navError) {
              console.error('Navigation error:', navError.message);
            }
            break;
          case 'click':
            console.log('Clicking at:', m.x, m.y);
            await page.mouse.click(m.x, m.y);
            break;
          case 'scroll':
            console.log('Scrolling by:', m.dy);
            await page.mouse.wheel(0, m.dy);
            break;
          case 'type':
            console.log('Typing:', m.text);
            if (m.text === 'Enter') {
              await page.keyboard.press('Enter');
            } else if (m.text === 'Backspace') {
              await page.keyboard.press('Backspace');
            } else if (m.text === 'Tab') {
              await page.keyboard.press('Tab');
            } else {
              await page.keyboard.type(m.text);
            }
            break;
        }
      } catch (error) {
        console.error('Error processing command:', error);
      }
    });

    // Stream screenshots at 30 FPS for smoother experience
    let screenshotInterval;
    let lastScreenshotTime = 0;
    const targetFPS = 30;
    const frameInterval = 1000 / targetFPS;
    
    const startScreenshots = async () => {
      screenshotInterval = setInterval(async () => {
        const now = Date.now();
        
        // Skip frame if we're running behind
        if (now - lastScreenshotTime < frameInterval * 0.8) {
          return;
        }
        
        try {
          if (ws.readyState === ws.OPEN) {
            const screenshot = await page.screenshot({ 
              type: 'jpeg', 
              quality: 90, // Higher quality for better appearance
              fullPage: false,
              clip: { x: 0, y: 0, width: 1280, height: 720 }
            });
            ws.send(screenshot);
            lastScreenshotTime = now;
          } else {
            clearInterval(screenshotInterval);
          }
        } catch (error) {
          console.error('Screenshot error:', error);
          clearInterval(screenshotInterval);
        }
      }, frameInterval);
    };
    
    startScreenshots();

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      clearInterval(screenshotInterval);
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clearInterval(screenshotInterval);
    });
  });

  // Use PORT env variable (Railway provides this)
  const port = process.env.PORT || 3001;
  
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Mini-browser server running on port ${port}`);
    console.log(`Health check available at http://localhost:${port}/api/health`);
  });
  
  // Handle WebSocket upgrade
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
      console.log('HTTP server closed');
    });
    await browser.close();
    process.exit(0);
  });

})().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});