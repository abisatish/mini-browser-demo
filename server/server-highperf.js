import express from 'express';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  console.log('Starting HIGH PERFORMANCE browser server...');
  console.log('Target FPS:', process.env.TARGET_FPS || 30);
  
  // Launch browser with performance optimizations
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      
      // Performance optimizations
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
      '--use-gl=desktop', // For GPU instances
      
      // Reduce overhead
      '--disable-features=TranslateUI,BlinkGenPropertyTrees',
      '--disable-ipc-flooding-protection',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      
      // Memory optimizations
      '--max_old_space_size=4096',
      '--memory-pressure-off',
      
      // Network optimizations  
      '--aggressive-cache-discard',
      '--disable-background-networking'
    ]
  });
  
  const context = await browser.newContext({ 
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    hasTouch: false,
    javascriptEnabled: true,
    // Disable animations for performance
    reducedMotion: 'reduce',
    colorScheme: 'light'
  });
  
  const page = await context.newPage();
  
  // Block unnecessary resources for performance
  await page.route('**/*', route => {
    const blockedTypes = ['font', 'media'];
    const blockedDomains = [
      'google-analytics.com',
      'googletagmanager.com',
      'doubleclick.net',
      'facebook.com',
      'twitter.com'
    ];
    
    const url = route.request().url();
    const resourceType = route.request().resourceType();
    
    if (blockedTypes.includes(resourceType) || 
        blockedDomains.some(domain => url.includes(domain))) {
      route.abort();
    } else {
      route.continue();
    }
  });
  
  await page.goto('https://www.google.com');
  console.log('Browser page loaded');

  const app = express();
  const wss = new WebSocketServer({ noServer: true });

  app.use(express.static(path.join(__dirname, '../client/dist')));

  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok',
      fps: process.env.TARGET_FPS || 30,
      performance: 'optimized'
    });
  });

  wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    let privacyMode = false;
    let isCapturing = false;
    
    // High-performance screenshot function
    const sendScreenshot = async () => {
      if (isCapturing || ws.readyState !== ws.OPEN || privacyMode) return;
      
      isCapturing = true;
      const startTime = performance.now();
      
      try {
        const screenshot = await page.screenshot({ 
          type: 'jpeg', 
          quality: 80, // Balance quality/performance
          fullPage: false,
          clip: { x: 0, y: 0, width: 1280, height: 720 },
          timeout: 100 // Very short timeout for high FPS
        });
        
        ws.send(screenshot);
        
        // Log performance warnings
        const captureTime = performance.now() - startTime;
        if (captureTime > 50) {
          console.warn(`Slow frame: ${captureTime.toFixed(1)}ms`);
        }
      } catch (error) {
        if (!error.message.includes('Timeout')) {
          console.error('Screenshot error:', error.message);
        }
      } finally {
        isCapturing = false;
      }
    };
    
    // Message handling
    ws.on('message', async (msg) => {
      try {
        const m = JSON.parse(msg.toString());
        
        switch (m.cmd) {
          case 'nav':
            console.log('Navigating to:', m.url);
            page.goto(m.url, { 
              waitUntil: 'domcontentloaded',
              timeout: 30000 
            }).then(() => sendScreenshot());
            break;
            
          case 'click':
            await page.mouse.click(m.x, m.y);
            setTimeout(sendScreenshot, 100);
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
            setTimeout(sendScreenshot, 50);
            break;
            
          case 'privacy':
            privacyMode = m.enabled;
            break;
        }
      } catch (error) {
        console.error('Command error:', error);
      }
    });
    
    // High FPS streaming
    const targetFPS = parseInt(process.env.TARGET_FPS) || 30;
    const frameInterval = 1000 / targetFPS;
    
    console.log(`Streaming at ${targetFPS} FPS (${frameInterval.toFixed(1)}ms interval)`);
    
    // Use high-precision timer for consistent FPS
    let lastFrameTime = performance.now();
    const frameTimer = setInterval(() => {
      const now = performance.now();
      const delta = now - lastFrameTime;
      
      // Skip frame if we're running behind
      if (delta >= frameInterval * 0.9) {
        sendScreenshot();
        lastFrameTime = now;
      }
    }, Math.max(frameInterval / 2, 10)); // Check twice per frame
    
    // Send initial screenshot
    sendScreenshot();
    
    ws.on('close', () => {
      console.log('WebSocket closed');
      clearInterval(frameTimer);
    });
  });

  const port = process.env.PORT || 3001;
  
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`High-performance server running on port ${port}`);
    console.log('Optimizations: GPU support, resource blocking, high-precision timers');
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