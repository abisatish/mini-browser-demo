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
  
  // Create persistent context to save cookies/logins
  const context = await browser.newContext({ 
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    deviceScaleFactor: 1,
    hasTouch: false,
    javascriptEnabled: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    // Save cookies and local storage
    storageState: {
      cookies: [],
      origins: []
    },
    // Additional browser context to appear more human
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  
  const page = await context.newPage();
  
  // Hide automation indicators
  await page.evaluateOnNewDocument(() => {
    // Hide webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
    
    // Add chrome object
    window.chrome = {
      runtime: {},
    };
    
    // Add plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
    
    // Add languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
  });
  
  // Error handling for page crashes
  page.on('crash', () => {
    console.log('Page crashed');
  });
  
  await page.goto('https://www.google.com');
  console.log('Browser page loaded - Google Search');

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
  wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');
    let privacyMode = false;
    
    // Send current URL when connection established
    const sendUrlUpdate = () => {
      try {
        const currentUrl = page.url();
        ws.send(JSON.stringify({ type: 'url', url: currentUrl }));
      } catch (error) {
        console.error('Error sending URL update:', error);
      }
    };
    
    // Monitor URL changes (remove previous listener if any)
    const urlChangeHandler = () => {
      sendUrlUpdate();
    };
    page.removeAllListeners('framenavigated');
    page.on('framenavigated', urlChangeHandler);
    
    ws.on('message', async (msg) => {
      try {
        const m = JSON.parse(msg.toString());
        
        switch (m.cmd) {
          case 'nav':
            console.log('Navigating to:', m.url);
            try {
              // Send multiple screenshots during navigation for smooth experience
              await sendScreenshot();
              
              // Start navigation without blocking
              page.goto(m.url, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
              }).then(() => {
                console.log('Navigation completed to:', m.url);
                sendUrlUpdate();
                sendScreenshot();
              }).catch((err) => {
                console.error('Navigation failed:', err.message);
              });
              
              // Send screenshots during loading
              setTimeout(() => sendScreenshot(), 200);
              setTimeout(() => sendScreenshot(), 500);
              setTimeout(() => sendScreenshot(), 1000);
              setTimeout(() => sendScreenshot(), 1500);
              setTimeout(() => sendScreenshot(), 2000);
            } catch (navError) {
              console.error('Navigation error:', navError.message);
              await sendScreenshot();
            }
            break;
            
          case 'privacy':
            privacyMode = m.enabled;
            console.log('Privacy mode:', privacyMode ? 'ON' : 'OFF');
            break;
            
          case 'click':
            console.log('Clicking at:', m.x, m.y);
            
            // Add human-like delay before click
            await page.waitForTimeout(50 + Math.random() * 100);
            
            // Move mouse to position first, then click (more human-like)
            await page.mouse.move(m.x, m.y);
            await page.waitForTimeout(20 + Math.random() * 30);
            await page.mouse.click(m.x, m.y);
            
            // Rapid screenshots after click for smooth feedback
            await sendScreenshot();
            setTimeout(() => sendScreenshot(), 50);
            setTimeout(() => sendScreenshot(), 150);
            setTimeout(() => sendScreenshot(), 300);
            
            // Check if click triggered navigation
            try {
              await page.waitForLoadState('domcontentloaded', { timeout: 500 });
              // Navigation detected
              sendUrlUpdate();
              await sendScreenshot();
              setTimeout(() => sendScreenshot(), 200);
              setTimeout(() => sendScreenshot(), 400);
            } catch {
              // No navigation, just UI update
              setTimeout(() => sendScreenshot(), 500);
            }
            break;
            
          case 'scroll':
            await page.mouse.wheel(0, m.dy);
            
            // For scrolling, the regular interval will handle updates
            // This prevents too many screenshots during rapid scrolling
            break;
            
          case 'type':
            console.log('Typing:', m.text);
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
              
              // Enter might trigger navigation
              if (m.text === 'Enter') {
                try {
                  await page.waitForLoadState('networkidle', { timeout: 2000 });
                } catch {
                  await page.waitForTimeout(500);
                }
                await sendScreenshot();
              } else {
                // For other special keys, send screenshot quickly
                await sendScreenshot(100);
              }
            } else {
              // Add human-like typing delay
              await page.keyboard.type(m.text, { delay: 50 + Math.random() * 50 });
              // Send screenshot right away so user sees their typing
              await sendScreenshot();
            }
            break;
            
          case 'requestScreenshot':
            // Allow client to manually request a screenshot
            await sendScreenshot();
            break;
            
          case 'goBack':
            console.log('Going back');
            try {
              await page.goBack({ timeout: 5000 });
              await sendScreenshot();
            } catch (error) {
              console.log('Cannot go back');
            }
            break;
            
          case 'goForward':
            console.log('Going forward');
            try {
              await page.goForward({ timeout: 5000 });
              await sendScreenshot();
            } catch (error) {
              console.log('Cannot go forward');
            }
            break;
        }
      } catch (error) {
        console.error('Error processing command:', error);
      }
    });

    // Event-driven screenshots plus regular updates for smooth experience
    
    // Send screenshot with error handling
    const sendScreenshot = async (addDelay = 0) => {
      try {
        if (ws.readyState !== ws.OPEN || privacyMode) return;
        
        // Add optional delay for page to settle
        if (addDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, addDelay));
        }
        
        const screenshot = await page.screenshot({ 
          type: 'jpeg', 
          quality: 85,
          fullPage: false,
          clip: { x: 0, y: 0, width: 1280, height: 720 },
          timeout: 3000,
          animations: 'disabled'  // Don't wait for animations/fonts
        });
        
        ws.send(screenshot, { binary: true });
      } catch (error) {
        console.error('Screenshot error:', error.message);
        
        // Don't reload on timeout - it causes more issues
        // Just skip the screenshot and continue
      }
    };
    
    // Send initial screenshot and URL
    sendScreenshot();
    sendUrlUpdate();
    
    // Regular screenshots for smooth experience (hybrid approach)
    const targetFPS = parseInt(process.env.TARGET_FPS) || 10; // 10 FPS for Railway
    const frameInterval = 1000 / targetFPS;
    
    const regularUpdateInterval = setInterval(async () => {
      await sendScreenshot();
    }, frameInterval); // Configurable FPS (default 10)

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      clearInterval(regularUpdateInterval);
      page.removeListener('framenavigated', urlChangeHandler);
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clearInterval(regularUpdateInterval);
      page.removeListener('framenavigated', urlChangeHandler);
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