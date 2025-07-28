import express from 'express';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp'; // Add sharp for image optimization

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  console.log('Starting optimized mini-browser server...');
  
  // Launch browser with GPU acceleration if available
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-zygote',
      // Enable GPU acceleration
      '--enable-gpu',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      // Performance optimizations
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      // Memory optimizations
      '--max_old_space_size=4096',
      '--memory-pressure-off'
    ]
  });
  
  const context = await browser.newContext({ 
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    deviceScaleFactor: 1, // Lower for better performance
    hasTouch: false,
    javascriptEnabled: true,
    // Disable unnecessary features
    permissions: [],
    colorScheme: 'light',
    reducedMotion: 'reduce'
  });
  
  const page = await context.newPage();
  
  // Disable unnecessary page features for performance
  await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico}', route => {
    // Block images for faster loading (optional)
    // route.abort();
    route.continue(); // Or continue to load images
  });
  
  // Block ads and tracking for performance
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('doubleclick.net') || 
        url.includes('google-analytics.com') ||
        url.includes('googletagmanager.com') ||
        url.includes('facebook.com/tr') ||
        url.includes('amazon-adsystem.com')) {
      route.abort();
    } else {
      route.continue();
    }
  });
  
  await page.goto('https://www.google.com');
  console.log('Browser page loaded - Google Search');

  const app = express();
  const wss = new WebSocketServer({ noServer: true });

  // Serve static files
  app.use(express.static(path.join(__dirname, '../client/dist')));

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok',
      message: 'Optimized Mini Browser Server Running',
      timestamp: new Date().toISOString()
    });
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });

  // WebSocket connection handler with optimizations
  wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection established');
    
    // Buffer for commands to batch process
    let commandBuffer = [];
    let commandTimer = null;
    
    const processCommandBuffer = async () => {
      const commands = [...commandBuffer];
      commandBuffer = [];
      
      for (const m of commands) {
        try {
          switch (m.cmd) {
            case 'nav':
              console.log('Navigating to:', m.url);
              await page.goto(m.url, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
              });
              break;
            case 'click':
              await page.mouse.click(m.x, m.y);
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
              break;
          }
        } catch (error) {
          console.error('Error processing command:', error.message);
        }
      }
    };
    
    ws.on('message', async (msg) => {
      try {
        const m = JSON.parse(msg.toString());
        commandBuffer.push(m);
        
        // Batch process commands every 16ms (60 FPS timing)
        if (commandTimer) clearTimeout(commandTimer);
        commandTimer = setTimeout(processCommandBuffer, 16);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });

    // Optimized screenshot streaming
    let screenshotInterval;
    let isCapturing = false;
    const targetFPS = parseInt(process.env.TARGET_FPS) || 30;
    const frameInterval = 1000 / targetFPS;
    const quality = parseInt(process.env.JPEG_QUALITY) || 80;
    
    // Use sharp for faster image processing if needed
    const optimizeImage = async (buffer) => {
      if (process.env.USE_SHARP === 'true') {
        return await sharp(buffer)
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
      }
      return buffer;
    };
    
    const captureAndSend = async () => {
      if (isCapturing || ws.readyState !== ws.OPEN) return;
      
      isCapturing = true;
      const startTime = Date.now();
      
      try {
        const screenshot = await page.screenshot({ 
          type: 'jpeg', 
          quality,
          fullPage: false,
          clip: { x: 0, y: 0, width: 1280, height: 720 },
          timeout: Math.max(frameInterval - 10, 100)
        });
        
        // Optional: Use sharp for better compression
        const optimized = await optimizeImage(screenshot);
        
        if (ws.readyState === ws.OPEN) {
          ws.send(optimized);
        }
        
        // Log performance metrics
        const captureTime = Date.now() - startTime;
        if (captureTime > frameInterval) {
          console.log(`Warning: Frame capture took ${captureTime}ms (target: ${frameInterval}ms)`);
        }
      } catch (error) {
        if (!error.message.includes('Timeout')) {
          console.error('Screenshot error:', error.message);
        }
      } finally {
        isCapturing = false;
      }
    };
    
    // Use setInterval for consistent timing
    screenshotInterval = setInterval(captureAndSend, frameInterval);

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      clearInterval(screenshotInterval);
      if (commandTimer) clearTimeout(commandTimer);
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clearInterval(screenshotInterval);
      if (commandTimer) clearTimeout(commandTimer);
    });
  });

  const port = process.env.PORT || 3001;
  
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Optimized mini-browser server running on port ${port}`);
    console.log(`Target FPS: ${process.env.TARGET_FPS || 30}`);
    console.log(`JPEG Quality: ${process.env.JPEG_QUALITY || 80}`);
  });
  
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

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