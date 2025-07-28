import express from 'express';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  console.log('Starting STABLE browser server...');
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
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
  
  // Set longer default timeout
  page.setDefaultTimeout(30000);
  
  await page.goto('https://www.google.com');
  console.log('Browser page loaded');

  const app = express();
  const wss = new WebSocketServer({ noServer: true });

  app.use(express.static(path.join(__dirname, '../client/dist')));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    let privacyMode = false;
    let screenshotInProgress = false;
    
    // Stable screenshot function - no auto-reload on timeout
    const sendScreenshot = async () => {
      if (screenshotInProgress || ws.readyState !== ws.OPEN || privacyMode) return;
      
      screenshotInProgress = true;
      
      try {
        const screenshot = await page.screenshot({ 
          type: 'jpeg', 
          quality: 75, // Lower quality for stability
          fullPage: false,
          clip: { x: 0, y: 0, width: 1280, height: 720 },
          timeout: 10000 // Longer timeout
        });
        
        if (ws.readyState === ws.OPEN) {
          ws.send(screenshot);
        }
      } catch (error) {
        console.log('Screenshot skipped:', error.message);
        // Don't reload - just skip this frame
      } finally {
        screenshotInProgress = false;
      }
    };
    
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
              // Simple screenshot after nav
              setTimeout(() => sendScreenshot(), 500);
              setTimeout(() => sendScreenshot(), 1000);
            } catch (navError) {
              console.error('Navigation error:', navError.message);
            }
            break;
            
          case 'click':
            await page.mouse.click(m.x, m.y);
            setTimeout(() => sendScreenshot(), 100);
            setTimeout(() => sendScreenshot(), 300);
            break;
            
          case 'scroll':
            await page.mouse.wheel(0, m.dy);
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
            setTimeout(() => sendScreenshot(), 50);
            break;
            
          case 'privacy':
            privacyMode = m.enabled;
            break;
        }
      } catch (error) {
        console.error('Command error:', error);
      }
    });
    
    // Stable FPS - lower but consistent
    const targetFPS = parseInt(process.env.TARGET_FPS) || 10;
    const frameInterval = 1000 / targetFPS;
    
    console.log(`Streaming at ${targetFPS} FPS`);
    
    const regularUpdateInterval = setInterval(() => {
      sendScreenshot();
    }, frameInterval);
    
    // Send initial screenshot
    sendScreenshot();
    
    ws.on('close', () => {
      console.log('WebSocket closed');
      clearInterval(regularUpdateInterval);
    });
  });

  const port = process.env.PORT || 3001;
  
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Stable server running on port ${port}`);
  });
  
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

})().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});