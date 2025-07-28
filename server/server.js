import express         from 'express';
import { WebSocketServer } from 'ws';
import { chromium }     from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const browser  = await chromium.launch();
  const context  = await browser.newContext({ viewport: { width: 1280, height: 720 }});
  const page     = await context.newPage();
  await page.goto('https://www.google.com');

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
    ws.on('message', async msg => {
      const m = JSON.parse(msg);
      if (m.cmd === 'nav')   return page.goto(m.url);
      if (m.cmd === 'click') return page.mouse.click(m.x, m.y);
      if (m.cmd === 'scroll')return page.mouse.wheel(0, m.dy);
      if (m.cmd === 'type')  return page.keyboard.type(m.text);
    });

    // Stream fresh screenshots ~5 fps
    const pump = setInterval(async () => {
      ws.send(await page.screenshot({ type: 'jpeg', quality: 60 }));
    }, 200);
    ws.on('close', () => clearInterval(pump));
  });

  // Upgrade HTTP → WS
  const port = process.env.PORT || 3001;
  const server = app.listen(port, () => {
    console.log(`Mini‑browser backend running on port ${port}`);
  });
  
  server.on('upgrade', (req, sock, head) =>
    wss.handleUpgrade(req, sock, head, ws => wss.emit('connection', ws, req))
  );
})();
