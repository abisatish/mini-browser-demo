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
              await page.goto(m.url, { 
                waitUntil: 'networkidle',
                timeout: 30000 
              });
              // Send screenshot after navigation completes
              await sendScreenshot();
            } catch (navError) {
              console.error('Navigation error:', navError.message);
              // Still send screenshot to show error page
              await sendScreenshot();
            }
            break;
            
          case 'privacy':
            privacyMode = m.enabled;
            console.log('Privacy mode:', privacyMode ? 'ON' : 'OFF');
            break;
            
          case 'click':
            console.log('Clicking at:', m.x, m.y);
            await page.mouse.click(m.x, m.y);
            
            // Wait for potential navigation or DOM changes
            try {
              await page.waitForLoadState('networkidle', { timeout: 1000 });
            } catch {
              // If no network activity, just wait a bit for DOM updates
              await page.waitForTimeout(300);
            }
            
            // Send screenshot after click action settles
            await sendScreenshot();
            break;
            
          case 'scroll':
            // Debounce scroll events
            if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
            
            await page.mouse.wheel(0, m.dy);
            
            scrollDebounceTimer = setTimeout(async () => {
              await sendScreenshot();
            }, 150); // Wait 150ms after last scroll event
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
              // Regular typing - debounce screenshots
              await page.keyboard.type(m.text);
              
              if (typeDebounceTimer) clearTimeout(typeDebounceTimer);
              typeDebounceTimer = setTimeout(async () => {
                await sendScreenshot();
              }, 200); // Wait 200ms after last keystroke
            }
            break;
            
          case 'requestScreenshot':
            // Allow client to manually request a screenshot
            await sendScreenshot();
            break;
        }
      } catch (error) {
        console.error('Error processing command:', error);
      }
    });

    // Event-driven screenshots (like ChatGPT) instead of continuous streaming
    let lastScrollTime = 0;
    let scrollDebounceTimer = null;
    let typeDebounceTimer = null;
    
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
    
    // Periodic check for auto-updating pages (much less frequent)
    const updateCheckInterval = setInterval(async () => {
      // Only check if page might have auto-updated content
      const currentUrl = page.url();
      if (currentUrl.includes('gmail') || currentUrl.includes('twitter') || currentUrl.includes('chat')) {
        await sendScreenshot();
      }
    }, 5000); // Every 5 seconds for dynamic pages

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      clearInterval(updateCheckInterval);
      if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
      if (typeDebounceTimer) clearTimeout(typeDebounceTimer);
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clearInterval(updateCheckInterval);
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