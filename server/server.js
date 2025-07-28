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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    deviceScaleFactor: 1, // Lower for better performance on personal server
    hasTouch: false,
    javascriptEnabled: true,
    // Save cookies and local storage
    storageState: {
      cookies: [],
      origins: []
    }
  });
  
  const page = await context.newPage();
  
  // Error handling for page crashes
  page.on('crash', async () => {
    console.log('Page crashed, creating new page...');
    const newPage = await context.newPage();
    Object.setPrototypeOf(page, Object.getPrototypeOf(newPage));
    Object.assign(page, newPage);
    await page.goto('https://www.google.com');
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
    
    ws.on('message', async (msg) => {
      try {
        const m = JSON.parse(msg.toString());
        
        switch (m.cmd) {
          case 'nav':
            console.log('Navigating to:', m.url);
            try {
              // Send multiple screenshots during navigation for smooth experience
              await sendScreenshot();
              
              // Start navigation
              const navPromise = page.goto(m.url, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
              });
              
              // Send screenshots during loading
              setTimeout(() => sendScreenshot(), 100);
              setTimeout(() => sendScreenshot(), 300);
              setTimeout(() => sendScreenshot(), 500);
              
              // Wait for navigation
              await navPromise;
              
              // Send URL update to client
              const currentUrl = page.url();
              ws.send(JSON.stringify({ type: 'urlUpdate', url: currentUrl }));
              
              await sendScreenshot();
              
              // More screenshots as page settles
              setTimeout(() => sendScreenshot(), 200);
              setTimeout(() => sendScreenshot(), 400);
              setTimeout(() => sendScreenshot(), 600);
              setTimeout(() => sendScreenshot(), 800);
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
            const urlBefore = page.url();
            await page.mouse.click(m.x, m.y);
            
            // Rapid screenshots after click for smooth feedback
            await sendScreenshot();
            setTimeout(() => sendScreenshot(), 50);
            setTimeout(() => sendScreenshot(), 150);
            setTimeout(() => sendScreenshot(), 300);
            
            // Check if click triggered navigation
            try {
              await page.waitForLoadState('domcontentloaded', { timeout: 500 });
              // Navigation detected, send URL update
              const urlAfter = page.url();
              if (urlAfter !== urlBefore) {
                ws.send(JSON.stringify({ type: 'urlUpdate', url: urlAfter }));
              }
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
              // Regular typing - send screenshot immediately for responsive feel
              await page.keyboard.type(m.text);
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
              const currentUrl = page.url();
              ws.send(JSON.stringify({ type: 'urlUpdate', url: currentUrl }));
              await sendScreenshot();
            } catch (error) {
              console.log('Cannot go back');
            }
            break;
            
          case 'goForward':
            console.log('Going forward');
            try {
              await page.goForward({ timeout: 5000 });
              const currentUrl = page.url();
              ws.send(JSON.stringify({ type: 'urlUpdate', url: currentUrl }));
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
          timeout: 5000
        });
        
        ws.send(screenshot);
      } catch (error) {
        console.error('Screenshot error:', error.message);
        
        // Only try recovery for persistent errors
        if (error.message.includes('Timeout')) {
          try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
            console.log('Page reloaded after screenshot timeout');
          } catch (reloadError) {
            console.error('Reload failed:', reloadError.message);
          }
        }
      }
    };
    
    // Send initial screenshot
    sendScreenshot();
    
    // Regular screenshots for smooth experience (hybrid approach)
    const targetFPS = parseInt(process.env.TARGET_FPS) || 10; // 10 FPS for Railway
    const frameInterval = 1000 / targetFPS;
    
    const regularUpdateInterval = setInterval(async () => {
      await sendScreenshot();
    }, frameInterval); // Configurable FPS (default 10)

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      clearInterval(regularUpdateInterval);
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clearInterval(regularUpdateInterval);
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