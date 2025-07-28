import express from 'express';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  console.log('Starting GPU-Optimized Browser Server...');
  console.log('Target FPS:', process.env.TARGET_FPS || 15);
  
  // Launch browser optimized for GPU rendering
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      
      // GPU optimization flags
      '--enable-gpu',
      '--enable-webgl',
      '--enable-accelerated-2d-canvas',
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
      
      // Performance flags
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--high-dpi-support=1',
      '--force-device-scale-factor=1'
    ]
  });
  
  const context = await browser.newContext({ 
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    deviceScaleFactor: 1,
    hasTouch: false,
    javascriptEnabled: true
  });
  
  const page = await context.newPage();
  
  // Increase timeout for stability
  page.setDefaultTimeout(30000);
  
  await page.goto('https://www.google.com');
  console.log('Browser ready - Google loaded');

  const app = express();
  const wss = new WebSocketServer({ noServer: true });

  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok',
      fps: process.env.TARGET_FPS || 15,
      gpu: 'enabled'
    });
  });

  wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    let privacyMode = false;
    let lastScreenshotTime = Date.now();
    let frameCount = 0;
    
    // Track performance
    setInterval(() => {
      if (frameCount > 0) {
        console.log(`Performance: ${frameCount} fps`);
        frameCount = 0;
      }
    }, 1000);
    
    // Efficient screenshot function
    const sendScreenshot = async (priority = false) => {
      // Skip if too soon (unless priority)
      const now = Date.now();
      if (!priority && now - lastScreenshotTime < 50) return;
      
      if (ws.readyState !== ws.OPEN || privacyMode) return;
      
      try {
        const screenshot = await page.screenshot({ 
          type: 'jpeg', 
          quality: 85,
          fullPage: false,
          clip: { x: 0, y: 0, width: 1280, height: 720 },
          timeout: 2000 // Shorter timeout with GPU
        });
        
        ws.send(screenshot);
        lastScreenshotTime = now;
        frameCount++;
      } catch (error) {
        // Just skip frame on error
        console.log('Frame skipped');
      }
    };
    
    // Handle commands
    ws.on('message', async (msg) => {
      try {
        const m = JSON.parse(msg.toString());
        
        switch (m.cmd) {
          case 'nav':
            console.log('Navigating to:', m.url);
            // Immediate feedback
            await sendScreenshot(true);
            
            page.goto(m.url, { 
              waitUntil: 'domcontentloaded',
              timeout: 30000 
            }).then(async () => {
              // Send several screenshots as page loads
              for (let i = 0; i < 5; i++) {
                await sendScreenshot(true);
                await new Promise(r => setTimeout(r, 200));
              }
            }).catch(err => {
              console.error('Nav error:', err.message);
            });
            break;
            
          case 'click':
            await page.mouse.click(m.x, m.y);
            // Immediate feedback
            await sendScreenshot(true);
            // Follow-up screenshots
            setTimeout(() => sendScreenshot(true), 100);
            setTimeout(() => sendScreenshot(true), 300);
            break;
            
          case 'scroll':
            await page.mouse.wheel(0, m.dy);
            // Let regular updates handle scroll
            break;
            
          case 'type':
            const specialKeys = {
              'Enter': 'Enter',
              'Backspace': 'Backspace',
              'Tab': 'Tab',
              'Delete': 'Delete',
              'ArrowLeft': 'ArrowLeft',
              'ArrowRight': 'ArrowRight',
              'ArrowUp': 'ArrowUp',
              'ArrowDown': 'ArrowDown'
            };
            
            if (specialKeys[m.text]) {
              await page.keyboard.press(specialKeys[m.text]);
            } else {
              await page.keyboard.type(m.text);
            }
            // Immediate feedback for typing
            await sendScreenshot(true);
            break;
            
          case 'privacy':
            privacyMode = m.enabled;
            break;
            
          case 'requestScreenshot':
            await sendScreenshot(true);
            break;
        }
      } catch (error) {
        console.error('Command error:', error);
      }
    });
    
    // Regular updates for smooth viewing
    const targetFPS = parseInt(process.env.TARGET_FPS) || 15;
    const frameInterval = 1000 / targetFPS;
    
    // Smart frame skipping - don't queue up if running behind
    let updating = false;
    const regularUpdate = setInterval(async () => {
      if (!updating) {
        updating = true;
        await sendScreenshot();
        updating = false;
      }
    }, frameInterval);
    
    // Initial screenshot
    sendScreenshot(true);
    
    ws.on('close', () => {
      console.log('WebSocket closed');
      clearInterval(regularUpdate);
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clearInterval(regularUpdate);
    });
  });

  const port = process.env.PORT || 3001;
  
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`GPU-Optimized server running on port ${port}`);
    console.log(`Access at: http://YOUR-EC2-IP:${port}`);
  });
  
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    server.close();
    await browser.close();
    process.exit(0);
  });

})().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});