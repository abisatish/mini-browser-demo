import express from 'express';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  console.log('Starting ChatGPT-style optimized browser server...');
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({ 
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1
  });
  
  const page = await context.newPage();
  await page.goto('https://www.google.com');

  const app = express();
  const wss = new WebSocketServer({ noServer: true });

  app.use(express.static(path.join(__dirname, '../client/dist')));

  wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    
    // Send screenshot only when page changes
    let lastScreenshotHash = '';
    
    const sendScreenshotIfChanged = async () => {
      try {
        const screenshot = await page.screenshot({ 
          type: 'jpeg', 
          quality: 80,
          fullPage: false
        });
        
        // Simple hash to detect changes (in production, use proper hashing)
        const hash = screenshot.length.toString();
        
        if (hash !== lastScreenshotHash) {
          ws.send(screenshot);
          lastScreenshotHash = hash;
        }
      } catch (error) {
        console.error('Screenshot error:', error);
      }
    };

    // Initial screenshot
    sendScreenshotIfChanged();

    ws.on('message', async (msg) => {
      try {
        const m = JSON.parse(msg.toString());
        
        switch (m.cmd) {
          case 'nav':
            console.log('Navigating to:', m.url);
            // Use network idle to know when page is ready
            await page.goto(m.url, { 
              waitUntil: 'networkidle',
              timeout: 30000 
            });
            await sendScreenshotIfChanged();
            break;
            
          case 'click':
            console.log('Clicking at:', m.x, m.y);
            await page.mouse.click(m.x, m.y);
            
            // Smart waiting - wait for any of these conditions:
            await Promise.race([
              page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {}),
              page.waitForTimeout(500), // At least 500ms
            ]);
            
            await sendScreenshotIfChanged();
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
            
            // For typing, send updates more frequently
            await page.waitForTimeout(100);
            await sendScreenshotIfChanged();
            break;
            
          case 'scroll':
            await page.mouse.wheel(0, m.dy);
            // Debounce scroll screenshots
            await page.waitForTimeout(200);
            await sendScreenshotIfChanged();
            break;
            
          case 'getState':
            // Send current state without action
            await sendScreenshotIfChanged();
            break;
        }
      } catch (error) {
        console.error('Command error:', error);
      }
    });

    // Periodic state check (much less frequent than streaming)
    const stateCheckInterval = setInterval(async () => {
      // Check if page has changed (e.g., auto-refresh, animations)
      await sendScreenshotIfChanged();
    }, 2000); // Every 2 seconds instead of 15 times per second

    ws.on('close', () => {
      console.log('WebSocket closed');
      clearInterval(stateCheckInterval);
    });
  });

  const port = process.env.PORT || 3001;
  
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`ChatGPT-style server running on port ${port}`);
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