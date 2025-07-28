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
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--no-first-run',
      '--disable-default-apps',
      '--disable-popup-blocking'
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
    timezoneId: 'America/Los_Angeles', // Pacific time - common for real users
    // Cookie persistence - saves sessions, NOT passwords!
    storageState: process.env.COOKIE_FILE ? 
      { path: process.env.COOKIE_FILE } : 
      undefined,
    // Additional browser context to appear more human
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  
  // Hide automation indicators before creating pages
  await context.addInitScript(() => {
    // Override the webdriver property
    delete Object.getPrototypeOf(navigator).webdriver;
    
    // Add chrome object with proper properties
    window.chrome = {
      app: {},
      runtime: {
        connect: () => {},
        sendMessage: () => {}
      },
      loadTimes: () => ({})
    };
    
    // Mock plugins
    const mockPlugins = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
      { name: 'Native Client', filename: 'internal-nacl-plugin' }
    ];
    
    Object.defineProperty(navigator, 'plugins', {
      get: () => mockPlugins
    });
    
    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
    
    // Fix toString
    window.navigator.toString = () => '[object Navigator]';
    window.navigator.permissions.toString = () => '[object Permissions]';
    
    // Override WebGL fingerprint
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) {
        return 'Intel Inc.';
      }
      if (parameter === 37446) {
        return 'Intel Iris OpenGL Engine';
      }
      return getParameter.apply(this, arguments);
    };
    
    // Override canvas fingerprint
    const toDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function() {
      if (this.width === 220 && this.height === 30) {
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      }
      return toDataURL.apply(this, arguments);
    };
    
    // Override screen properties
    Object.defineProperty(window.screen, 'availTop', { get: () => 0 });
    Object.defineProperty(window.screen, 'availLeft', { get: () => 0 });
    
    // Add battery API
    navigator.getBattery = () => Promise.resolve({
      charging: true,
      chargingTime: 0,
      dischargingTime: Infinity,
      level: 1
    });
  });
  
  const page = await context.newPage();
  
  // Save cookies periodically (every 5 minutes)
  if (process.env.COOKIE_FILE) {
    setInterval(async () => {
      try {
        await context.storageState({ path: process.env.COOKIE_FILE });
        console.log('Cookies saved (sessions only, no passwords)');
      } catch (error) {
        console.error('Failed to save cookies:', error);
      }
    }, 5 * 60 * 1000);
  }
  
  // Handle popups for OAuth (Gmail, Google, etc)
  context.on('page', async (popup) => {
    console.log('Popup detected:', popup.url());
    // Track popups but don't interfere with them
    popup.on('close', () => {
      console.log('Popup closed');
    });
  });
  
  // Override page visibility to always report visible
  await page.addInitScript(() => {
    Object.defineProperty(document, 'hidden', { get: () => false });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
  });
  
  // Track mouse position
  let lastMousePos = { x: 640, y: 360 }; // Start in center
  
  // Error handling for page crashes
  page.on('crash', () => {
    console.log('Page crashed');
  });
  
  // Go to Google with all stealth measures
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
            
            // Debug: Log what element we're clicking on
            const clickedElement = await page.evaluate(({x, y}) => {
              const elem = document.elementFromPoint(x, y);
              return {
                tag: elem ? elem.tagName : 'none',
                class: elem ? elem.className : 'none',
                text: elem ? elem.textContent?.substring(0, 50) : 'none'
              };
            }, {x: m.x, y: m.y});
            console.log('Clicking on element:', clickedElement);
            
            // Add human-like delay before click
            await page.waitForTimeout(50 + Math.random() * 100);
            
            // More human-like mouse movement with curve
            const steps = 5 + Math.floor(Math.random() * 5);
            for (let i = 1; i <= steps; i++) {
              const progress = i / steps;
              // Add slight curve to movement
              const curve = Math.sin(progress * Math.PI) * 20;
              const x = lastMousePos.x + (m.x - lastMousePos.x) * progress + (i < steps/2 ? curve : -curve);
              const y = lastMousePos.y + (m.y - lastMousePos.y) * progress;
              await page.mouse.move(x, y);
              await page.waitForTimeout(15 + Math.random() * 25);
            }
            
            // Final move to exact position
            await page.mouse.move(m.x, m.y);
            lastMousePos = { x: m.x, y: m.y };
            await page.waitForTimeout(100 + Math.random() * 150);
            
            // For Google Images, use a more direct click approach
            const currentUrl = page.url();
            if (currentUrl.includes('google.com/search') && currentUrl.includes('tbm=isch')) {
              // Google Images - dispatch click event directly to ensure it works
              await page.evaluate(({x, y}) => {
                const element = document.elementFromPoint(x, y);
                if (element) {
                  const clickEvent = new MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y
                  });
                  element.dispatchEvent(clickEvent);
                }
              }, {x: m.x, y: m.y});
            }
            
            // Always do the regular click as well
            await page.mouse.click(m.x, m.y);
            
            // For LinkedIn login, add extra delay and force focus
            if (currentUrl.includes('linkedin.com')) {
              await page.waitForTimeout(300);
              // Try to focus the clicked element
              await page.evaluate(({x, y}) => {
                const element = document.elementFromPoint(x, y);
                if (element && (element.tagName === 'INPUT' || element.tagName === 'BUTTON')) {
                  element.focus();
                  // For buttons, try clicking again
                  if (element.tagName === 'BUTTON' || element.type === 'submit') {
                    setTimeout(() => element.click(), 100);
                  }
                }
              }, {x: m.x, y: m.y});
            }
            
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
            // Add slight mouse movement during scroll (more natural)
            const scrollX = lastMousePos.x + (Math.random() - 0.5) * 10;
            const scrollY = lastMousePos.y + (Math.random() - 0.5) * 10;
            await page.mouse.move(scrollX, scrollY);
            lastMousePos = { x: scrollX, y: scrollY };
            await page.mouse.wheel(0, m.dy);
            
            // For scrolling, the regular interval will handle updates
            // This prevents too many screenshots during rapid scrolling
            break;
            
          case 'type':
            console.log('Typing:', m.text);
            
            // Check if we're typing in a password field
            const isPasswordField = await page.evaluate(() => {
              const activeElement = document.activeElement;
              return activeElement && activeElement.type === 'password';
            });
            
            if (isPasswordField) {
              console.log('Typing in password field');
            }
            
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
              
              // Tab might move between fields
              if (m.text === 'Tab') {
                await page.waitForTimeout(200);
                await sendScreenshot();
              }
              // Enter might trigger navigation or form submission
              else if (m.text === 'Enter') {
                // For LinkedIn, wait longer for login processing
                const currentUrl = page.url();
                if (currentUrl.includes('linkedin.com')) {
                  console.log('LinkedIn login - waiting for response');
                  await page.waitForTimeout(1000);
                }
                
                try {
                  await page.waitForLoadState('networkidle', { timeout: 3000 });
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
    
    // Save cookies before shutdown
    if (process.env.COOKIE_FILE) {
      try {
        await context.storageState({ path: process.env.COOKIE_FILE });
        console.log('Final cookie save completed');
      } catch (error) {
        console.error('Failed to save cookies on shutdown:', error);
      }
    }
    
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