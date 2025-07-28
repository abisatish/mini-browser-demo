import express         from 'express';
import { WebSocketServer } from 'ws';
import { chromium }     from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  let browser;
  let context;
  let page;

  try {
    console.log('Launching browser...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    console.log('Creating browser context...');
    context = await browser.newContext({ 
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1
    });
    
    console.log('Creating new page...');
    page = await context.newPage();
    
    console.log('Navigating to initial page...');
    await page.goto('https://ai.google/');
    console.log('Browser setup completed successfully');
  } catch (error) {
    console.error('Failed to setup browser:', error.message);
    console.error('Please ensure Playwright browsers are installed: npx playwright install chromium');
    process.exit(1);
  }

  const app      = express();
  const wss      = new WebSocketServer({ noServer: true });

  // Serve static files from the built client
  app.use(express.static(path.join(__dirname, '../client/dist')));

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'Mini Browser Server Running' });
  });

  // Serve the React app for all other routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });

  // Receive clicks, keys, navigation commands
  wss.on('connection', ws => {
    console.log('New WebSocket connection established');
    
    ws.on('message', async msg => {
      try {
        const m = JSON.parse(msg);
        console.log('Received command:', m.cmd, m);
        
        if (m.cmd === 'nav') {
          console.log('Navigating to:', m.url);
          // Add protocol if missing
          let targetUrl = m.url;
          if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
          }
          await page.goto(targetUrl, { waitUntil: 'networkidle' });
          // Wait a bit for the page to fully load and be interactive
          await page.waitForTimeout(2000);
          console.log('Navigation completed');
        }
        if (m.cmd === 'click') {
          console.log('Clicking at:', m.x, m.y);
          try {
            await page.mouse.click(m.x, m.y);
            console.log('Click completed');
          } catch (error) {
            console.log('Click failed:', error.message);
          }
        }
        if (m.cmd === 'scroll') {
          console.log('Scrolling by:', m.dy);
          await page.mouse.wheel(0, m.dy);
          console.log('Scroll completed');
        }
        if (m.cmd === 'type') {
          console.log('Typing:', m.text);
          await page.keyboard.type(m.text);
          console.log('Type completed');
        }
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    // Stream screenshots at 10 FPS
    const pump = setInterval(async () => {
      try {
        const screenshot = await page.screenshot({ 
          type: 'jpeg', 
          quality: 80,
          fullPage: false
        });
        if (ws.readyState === ws.OPEN) {
          ws.send(screenshot);
        }
      } catch (error) {
        console.error('Screenshot error:', error.message);
      }
    }, 100); // 10 FPS (1000ms / 10fps = 100ms)
    
    ws.on('close', () => {
      console.log('WebSocket connection closed');
      clearInterval(pump);
    });
  });

  // Upgrade HTTP → WS
  const port = process.env.PORT || 3001;
  const server = app.listen(port, () => {
    console.log(`Mini‑browser fullstack app running on port ${port}`);
  });
  
  server.on('upgrade', (req, sock, head) =>
    wss.handleUpgrade(req, sock, head, ws => wss.emit('connection', ws, req))
  );
})();
