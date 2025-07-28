import express from 'express';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Browser pool for handling multiple users
class BrowserPool {
  constructor(maxBrowsers = 5) {
    this.browsers = [];
    this.availableBrowsers = [];
    this.maxBrowsers = maxBrowsers;
    this.sessions = new Map();
  }

  async init() {
    // Pre-launch browsers for faster session start
    for (let i = 0; i < Math.min(2, this.maxBrowsers); i++) {
      await this.createBrowser();
    }
  }

  async createBrowser() {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu', // No GPU needed for this approach
        '--no-first-run',
        '--disable-features=TranslateUI',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    });
    
    this.browsers.push(browser);
    this.availableBrowsers.push(browser);
    return browser;
  }

  async getSession(sessionId) {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId);
    }

    // Get or create browser
    let browser = this.availableBrowsers.pop();
    if (!browser && this.browsers.length < this.maxBrowsers) {
      browser = await this.createBrowser();
      this.availableBrowsers.splice(this.availableBrowsers.indexOf(browser), 1);
    } else if (!browser) {
      // All browsers in use, share one
      browser = this.browsers[Math.floor(Math.random() * this.browsers.length)];
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
    });

    const page = await context.newPage();
    
    const session = {
      browser,
      context,
      page,
      lastActivity: Date.now(),
      isStreaming: false
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  async closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.context.close();
      this.sessions.delete(sessionId);
      
      // Return browser to available pool if it has capacity
      const browserSessions = Array.from(this.sessions.values())
        .filter(s => s.browser === session.browser).length;
      
      if (browserSessions === 0 && !this.availableBrowsers.includes(session.browser)) {
        this.availableBrowsers.push(session.browser);
      }
    }
  }

  // Clean up idle sessions
  async cleanup() {
    const timeout = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > timeout) {
        console.log(`Cleaning up idle session: ${sessionId}`);
        await this.closeSession(sessionId);
      }
    }
  }
}

// Initialize browser pool
const browserPool = new BrowserPool(10); // Handle 10 browsers

(async () => {
  console.log('Starting scalable browser server...');
  
  await browserPool.init();
  
  // Periodic cleanup
  setInterval(() => browserPool.cleanup(), 60000);

  const app = express();
  const wss = new WebSocketServer({ noServer: true });

  app.use(express.static(path.join(__dirname, '../client/dist')));

  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok',
      activeSessions: browserPool.sessions.size,
      totalBrowsers: browserPool.browsers.length,
      availableBrowsers: browserPool.availableBrowsers.length
    });
  });

  // WebSocket connection handler
  wss.on('connection', async (ws, req) => {
    const sessionId = Math.random().toString(36).substring(7);
    console.log(`New session: ${sessionId}`);
    
    let session = null;
    
    try {
      session = await browserPool.getSession(sessionId);
      await session.page.goto('https://www.google.com');
    } catch (error) {
      console.error('Failed to create session:', error);
      ws.close();
      return;
    }

    // Different approach: Send DOM updates instead of video stream
    const sendUpdate = async (eventType = 'update') => {
      try {
        if (ws.readyState !== ws.OPEN) return;
        
        session.lastActivity = Date.now();
        
        // Option 1: Send screenshot only when needed
        if (eventType === 'screenshot' || eventType === 'navigation') {
          const screenshot = await session.page.screenshot({
            type: 'jpeg',
            quality: 70,
            fullPage: false
          });
          
          ws.send(JSON.stringify({
            type: 'screenshot',
            data: screenshot.toString('base64')
          }));
        }
        
        // Option 2: Send DOM structure (much more efficient)
        const pageInfo = await session.page.evaluate(() => {
          return {
            url: window.location.href,
            title: document.title,
            // Get interactive elements
            inputs: Array.from(document.querySelectorAll('input, textarea')).map(el => ({
              type: el.type,
              value: el.value,
              placeholder: el.placeholder,
              id: el.id,
              name: el.name,
              rect: el.getBoundingClientRect()
            })),
            buttons: Array.from(document.querySelectorAll('button, a')).slice(0, 50).map(el => ({
              text: el.textContent.trim().substring(0, 100),
              href: el.href,
              rect: el.getBoundingClientRect()
            })),
            // Get main text content
            text: document.body.innerText.substring(0, 5000)
          };
        });
        
        ws.send(JSON.stringify({
          type: 'dom',
          data: pageInfo
        }));
        
      } catch (error) {
        console.error('Update error:', error);
      }
    };

    // Handle commands
    ws.on('message', async (msg) => {
      try {
        const m = JSON.parse(msg.toString());
        session.lastActivity = Date.now();
        
        switch (m.cmd) {
          case 'nav':
            await session.page.goto(m.url, { waitUntil: 'domcontentloaded' });
            await sendUpdate('navigation');
            break;
            
          case 'click':
            await session.page.mouse.click(m.x, m.y);
            setTimeout(() => sendUpdate('click'), 500);
            break;
            
          case 'type':
            if (m.text === 'Enter') {
              await session.page.keyboard.press('Enter');
            } else {
              await session.page.keyboard.type(m.text);
            }
            await sendUpdate('type');
            break;
            
          case 'screenshot':
            await sendUpdate('screenshot');
            break;
            
          case 'startStream':
            // Only stream when explicitly requested
            session.isStreaming = true;
            break;
            
          case 'stopStream':
            session.isStreaming = false;
            break;
        }
      } catch (error) {
        console.error('Command error:', error);
      }
    });

    // Send initial state
    await sendUpdate('navigation');
    
    // Only send updates when streaming is enabled
    const updateInterval = setInterval(async () => {
      if (session && session.isStreaming) {
        await sendUpdate('screenshot');
      }
    }, 1000); // 1 FPS when streaming

    ws.on('close', async () => {
      console.log(`Session closed: ${sessionId}`);
      clearInterval(updateInterval);
      await browserPool.closeSession(sessionId);
    });
  });

  const port = process.env.PORT || 3001;
  
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Scalable browser server running on port ${port}`);
    console.log('Max concurrent browsers:', browserPool.maxBrowsers);
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