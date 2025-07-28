import express         from 'express';
import { WebSocketServer } from 'ws';
import { chromium }     from 'playwright';

(async () => {
  const browser  = await chromium.launch();
  const context  = await browser.newContext({ viewport: { width: 1280, height: 720 }});
  const page     = await context.newPage();
  await page.goto('https://www.google.com');

  const app      = express();
  const wss      = new WebSocketServer({ noServer: true });

  // Receive clicks, keys, navigation commands
  wss.on('connection', ws => {
    ws.on('message', async msg => {
      const m = JSON.parse(msg);
      if (m.cmd === 'nav')   return page.goto(m.url);
      if (m.cmd === 'click') return page.mouse.click(m.x, m.y);
      if (m.cmd === 'scroll')return page.mouse.wheel(0, m.dy);
      if (m.cmd === 'type')  return page.keyboard.type(m.text);
    });

    // Stream fresh screenshots ~5 fps
    const pump = setInterval(async () => {
      ws.send(await page.screenshot({ type: 'jpeg', quality: 60 }));
    }, 200);
    ws.on('close', () => clearInterval(pump));
  });

  // Upgrade HTTP → WS
  const server = app.listen(3001);
  server.on('upgrade', (req, sock, head) =>
    wss.handleUpgrade(req, sock, head, ws => wss.emit('connection', ws, req))
  );

  console.log('Mini‑browser backend running on ws://localhost:3001');
})();
