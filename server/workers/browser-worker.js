import { parentPort, workerData } from 'worker_threads';

// Log startup immediately
console.log('[Worker Thread] Starting browser worker...');
console.log('[Worker Thread] Worker data:', workerData);

let chromium;
try {
  const playwright = await import('playwright');
  chromium = playwright.chromium;
  console.log('[Worker Thread] Playwright loaded successfully');
} catch (error) {
  console.error('[Worker Thread] Failed to load Playwright:', error);
  process.exit(1);
}

// Worker configuration
const { workerId, maxBrowsers, headless } = workerData;

console.log(`[Worker ${workerId}] Browser worker starting with config:`, { workerId, maxBrowsers, headless });

// Browser management
const browsers = new Map();
const contexts = new Map();
const pages = new Map();
const lastScreenshots = new Map(); // Store last screenshot hash for comparison
let browserCount = 0;

// Performance monitoring
let lastStatsReport = Date.now();
const stats = {
  commandsProcessed: 0,
  screenshotsGenerated: 0,
  errors: 0,
  averageResponseTime: 0
};

// Browser configuration optimized for Railway (CPU-only, 8 vCPUs, 8GB RAM)
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--disable-web-security',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-site-isolation-trials',
  '--no-first-run',
  '--disable-default-apps',
  '--disable-popup-blocking',
  '--disable-gpu',  // No GPU on Railway
  '--disable-software-rasterizer',
  '--disable-gpu-sandbox',
  '--disable-accelerated-2d-canvas',  // CPU rendering only
  '--disable-background-timer-throttling',  // No throttling for smooth performance
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=TranslateUI',
  '--disable-ipc-flooding-protection',
  '--enable-features=NetworkService,NetworkServiceInProcess',
  '--force-color-profile=srgb',  // Consistent colors
  '--metrics-recording-only',  // Disable metrics reporting
  '--disable-hang-monitor',  // Prevent false hang detection
  '--disable-breakpad',  // No crash reporting
  '--disable-domain-reliability',  // Less network overhead
  '--disable-sync',  // No sync needed
  '--no-pings',  // No telemetry
  '--use-fake-ui-for-media-stream',  // Prevent media permission dialogs
  '--use-fake-device-for-media-stream'  // Prevent device access issues
];

// Create a new browser instance
async function createBrowser(sessionId) {
  if (browserCount >= maxBrowsers) {
    throw new Error(`Worker ${workerId} at max capacity (${maxBrowsers} browsers)`);
  }
  
  const browserId = `browser_${workerId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    console.log(`[Worker ${workerId}] Creating browser ${browserId} for session ${sessionId}`);
    
    // Launch browser with optimized settings and memory limits
    const browser = await chromium.launch({
      headless: headless,
      args: [
        ...BROWSER_ARGS,
        '--disable-dev-shm-usage',  // Critical for Docker
        '--max-renderer-process-count=2',  // Allow 2 renderer processes
        '--memory-pressure-off'  // Disable memory pressure reporting
        // Removed memory limits - let Chrome manage its own memory
      ],
      // Reduce resource usage
      chromiumSandbox: false,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false
    });
    
    // Create context with reasonable defaults
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      deviceScaleFactor: 1,
      hasTouch: false,
      javascriptEnabled: true,
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
      // Reduce animations for better performance
      reducedMotion: 'reduce',
      forcedColors: 'none'
    });
    
    // Add stealth scripts
    await context.addInitScript(() => {
      // Basic stealth to avoid detection
      delete Object.getPrototypeOf(navigator).webdriver;
      
      // Mock chrome object
      window.chrome = {
        app: {},
        runtime: {
          connect: () => {},
          sendMessage: () => {}
        }
      };
      
      // Override navigator.plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
    });
    
    // Create initial page
    const page = await context.newPage();
    
    // Set up error handling with auto-recovery
    page.on('crash', async () => {
      console.error(`[Worker ${workerId}] Page crashed for browser ${browserId}, attempting recovery...`);
      
      // Mark browser as crashed to prevent screenshot attempts
      pages.set(browserId + '_crashed', true);
      
      // Try to recreate the page
      try {
        // Close the crashed page
        await page.close().catch(() => {});
        
        // Wait a bit for memory to be freed
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Create a new page
        const newPage = await context.newPage();
        pages.set(browserId, newPage);
        
        // Re-setup crash handler
        newPage.on('crash', () => {
          console.error(`[Worker ${workerId}] Page crashed again for browser ${browserId}`);
          pages.set(browserId + '_crashed', true);
          // Don't try to recover again, let main thread handle it
        });
        
        newPage.on('pageerror', (error) => {
          if (error.message.includes('ERR_') || error.message.includes('net::')) {
            console.log(`[Worker ${workerId}] Network error on ${browserId}: ${error.message}`);
          }
        });
        
        // Navigate to a safe page
        await newPage.goto('about:blank', { timeout: 5000 }).catch(() => {});
        
        // Clear crashed flag
        pages.delete(browserId + '_crashed');
        
        console.log(`[Worker ${workerId}] Page recovered for browser ${browserId}`);
        
        // Notify main thread of recovery
        parentPort.postMessage({
          type: 'browserRecovered',
          browserId,
          workerId
        });
      } catch (error) {
        console.error(`[Worker ${workerId}] Failed to recover page:`, error);
        handleBrowserError(browserId, new Error('Page crash unrecoverable'));
      }
    });
    
    page.on('pageerror', (error) => {
      // Silently handle page errors unless critical
      if (error.message.includes('ERR_') || error.message.includes('net::')) {
        console.log(`[Worker ${workerId}] Network error on ${browserId}: ${error.message}`);
      }
    });
    
    // Navigate to initial page
    await page.goto('https://www.google.com', { 
      waitUntil: 'domcontentloaded',
      timeout: 10000 
    });
    
    // Store references
    browsers.set(browserId, browser);
    contexts.set(browserId, context);
    pages.set(browserId, page);
    browserCount++;
    
    // Notify main thread
    parentPort.postMessage({
      type: 'browserCreated',
      browserId,
      sessionId,
      workerId
    });
    
    console.log(`[Worker ${workerId}] Browser ${browserId} created successfully`);
    return browserId;
    
  } catch (error) {
    console.error(`[Worker ${workerId}] Failed to create browser:`, error);
    throw error;
  }
}

// Close a browser instance
async function closeBrowser(browserId) {
  const browser = browsers.get(browserId);
  if (browser) {
    try {
      await browser.close();
      browsers.delete(browserId);
      contexts.delete(browserId);
      pages.delete(browserId);
      browserCount--;
      
      parentPort.postMessage({
        type: 'browserClosed',
        browserId,
        workerId
      });
      
      console.log(`[Worker ${workerId}] Browser ${browserId} closed`);
    } catch (error) {
      console.error(`[Worker ${workerId}] Error closing browser:`, error);
    }
  }
}

// Execute browser command
async function executeBrowserCommand(browserId, command) {
  const page = pages.get(browserId);
  if (!page) {
    throw new Error(`Browser ${browserId} not found`);
  }
  
  const startTime = Date.now();
  let response = { type: 'response', command: command.cmd };
  
  try {
    switch (command.cmd) {
      case 'nav':
        // Mark page as navigating to prevent screenshot errors
        pages.set(browserId + '_navigating', true);
        
        // Send loading state immediately
        response.loading = true;
        response.url = command.url;
        response.message = 'Navigating...';
        
        // Log heavy pages for debugging
        const isHeavyPage = command.url.includes('linkedin.com/checkpoint') || 
                           command.url.includes('linkedin.com/login') ||
                           command.url.includes('signin') ||
                           command.url.includes('auth');
        
        if (isHeavyPage) {
          console.log(`[Worker ${workerId}] Navigating to heavy page: ${command.url}`);
          response.message = 'Loading authentication page...';
        }
        
        try {
          await page.goto(command.url, { 
            waitUntil: 'domcontentloaded',
            timeout: 15000 
          });
          response.url = page.url();
          response.title = await page.title().catch(() => 'Loading...');
          response.loading = false;
          response.success = true;
          
          // Wait a bit for page to stabilize
          await page.waitForTimeout(500);
        } catch (navError) {
          console.error(`[Worker ${workerId}] Navigation error:`, navError.message);
          response.error = navError.message;
          response.loading = false;
        } finally {
          // Clear navigation flag
          pages.delete(browserId + '_navigating');
        }
        break;
        
      case 'click':
        // Check current URL for potentially heavy pages
        const currentUrl = page.url();
        
        // Click with shorter timeout for heavy pages like LinkedIn login
        if (currentUrl.includes('linkedin.com') || currentUrl.includes('login') || currentUrl.includes('signin')) {
          // For auth pages, click and don't wait for navigation
          await page.mouse.click(command.x, command.y);
          // Don't wait for navigation completion
          response.warning = 'Auth page - navigation may take time';
        } else {
          await page.mouse.click(command.x, command.y);
          await page.waitForTimeout(100);
        }
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
        
        if (specialKeys[command.text]) {
          await page.keyboard.press(specialKeys[command.text]);
        } else {
          // Minimal delay for instant typing feedback
          await page.keyboard.type(command.text, { delay: 10 });
        }
        break;
        
      case 'scroll':
        await page.mouse.wheel(0, command.dy);
        break;
        
      case 'requestScreenshot':
        // SKIP screenshots entirely during navigation or if crashed
        if (pages.has(browserId + '_navigating') || pages.has(browserId + '_crashed')) {
          response.skipped = true;
          response.reason = pages.has(browserId + '_crashed') ? 'page_crashed' : 'page_navigating';
          break;
        }
        
        
        // Quick check if page exists and is ready
        try {
          const pageExists = await page.evaluate(() => true).catch(() => false);
          if (!pageExists) {
            response.skipped = true;
            response.reason = 'page_not_ready';
            break;
          }
        } catch {
          response.skipped = true;
          response.reason = 'page_error';
          break;
        }
        
        // Take screenshot with FINAL quality (no recompression needed)
        // ChatGPT optimization: Set JPEG quality at capture time
        const quality = command.quality || 80;  // Use passed quality or default
        
        // Smart screenshot: Lower quality for idle sessions
        const adaptiveQuality = command.isIdle ? 60 : quality;
        
        try {
          const screenshot = await Promise.race([
            page.screenshot({
              type: 'jpeg',
              quality: adaptiveQuality,  // Adaptive quality based on activity
              fullPage: false,
              clip: { x: 0, y: 0, width: 1280, height: 720 },
              animations: 'allow', // Don't wait for animations to finish
              timeout: command.isIdle ? 500 : 300  // Longer timeout for idle (less urgent)
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Screenshot timeout')), command.isIdle ? 550 : 350)
            )
          ]).catch(() => null);
          
          if (screenshot) {
            // Simple change detection: compare screenshot size
            const lastSize = lastScreenshots.get(browserId);
            const currentSize = screenshot.length;
            
            // If size is very similar (within 5%), might be unchanged
            if (lastSize && Math.abs(currentSize - lastSize) / lastSize < 0.05) {
              response.possiblyUnchanged = true;
            }
            
            lastScreenshots.set(browserId, currentSize);
            response.screenshot = screenshot;
            response.compressed = true;  // Flag that this is already at final quality
            response.quality = adaptiveQuality;
            stats.screenshotsGenerated++;
          } else {
            response.skipped = true;
            response.reason = 'timeout';
          }
        } catch {
          response.skipped = true;
          response.reason = 'failed';
        }
        break;
        
      case 'goBack':
        await page.goBack({ timeout: 5000 });
        response.url = page.url();
        break;
        
      case 'goForward':
        await page.goForward({ timeout: 5000 });
        response.url = page.url();
        break;
        
      case 'search':
        // Execute search (simplified version)
        response.results = [];
        break;
        
      default:
        throw new Error(`Unknown command: ${command.cmd}`);
    }
    
    stats.commandsProcessed++;
    const responseTime = Date.now() - startTime;
    stats.averageResponseTime = (stats.averageResponseTime + responseTime) / 2;
    
  } catch (error) {
    console.error(`[Worker ${workerId}] Command error:`, error);
    stats.errors++;
    response.error = error.message;
  }
  
  return response;
}

// Handle browser errors
async function handleBrowserError(browserId, error) {
  console.error(`[Worker ${workerId}] Browser ${browserId} error:`, error);
  
  // Try to recover by recreating the browser
  try {
    await closeBrowser(browserId);
    // Browser will be recreated by main thread if needed
  } catch (closeError) {
    console.error(`[Worker ${workerId}] Failed to close errored browser:`, closeError);
  }
}

// Report worker stats periodically with memory monitoring
setInterval(() => {
  const now = Date.now();
  const load = browserCount / maxBrowsers;
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const heapPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  
  // Only warn if actual memory usage is high
  // With 1GB worker heap limit, warn at 800MB
  if (heapUsedMB > 800) {  // Warn at 800MB actual usage
    console.warn(`[Worker ${workerId}] High memory usage: ${heapUsedMB.toFixed(1)}MB`);
    // Removed automatic browser closing - let the system handle memory pressure naturally
  }
  
  parentPort.postMessage({
    type: 'workerStats',
    workerId,
    stats: {
      browsers: browserCount,
      maxBrowsers,
      load,
      memory: {
        heapUsedMB: heapUsedMB.toFixed(1),
        heapPercent: heapPercent.toFixed(1)
      },
      ...stats
    },
    timestamp: now
  });
  
  // Reset counters
  if (now - lastStatsReport > 60000) {  // Every minute
    stats.commandsProcessed = 0;
    stats.screenshotsGenerated = 0;
    stats.errors = 0;
    lastStatsReport = now;
  }
}, 5000);

// Message handler from main thread
parentPort.on('message', async (msg) => {
  const { messageId } = msg;
  let response = { messageId: messageId || 'no_id' };
  
  try {
    switch (msg.cmd) {
      case 'init':
        console.log(`[Worker ${workerId}] Initialized`);
        response.status = 'ready';
        response.workerId = workerId;
        break;
        
      case 'createBrowser':
        console.log(`[Worker ${workerId}] Received createBrowser command for session ${msg.sessionId}`);
        try {
          const browserId = await createBrowser(msg.sessionId);
          response.browserId = browserId;
          console.log(`[Worker ${workerId}] Browser created: ${browserId}`);
        } catch (error) {
          console.error(`[Worker ${workerId}] Failed to create browser:`, error);
          response.error = error.message;
        }
        break;
        
      case 'closeBrowser':
        await closeBrowser(msg.browserId);
        response.status = 'closed';
        break;
        
      case 'browserCommand':
        const result = await executeBrowserCommand(msg.browserId, msg.command);
        response = { ...response, ...result };
        break;
        
      case 'getStats':
        response.stats = {
          browsers: browserCount,
          maxBrowsers,
          load: browserCount / maxBrowsers
        };
        break;
        
      case 'shutdown':
        // Close all browsers
        for (const [browserId] of browsers) {
          await closeBrowser(browserId);
        }
        process.exit(0);
        break;
        
      default:
        response.error = `Unknown command: ${msg.cmd}`;
    }
  } catch (error) {
    response.error = error.message;
    console.error(`[Worker ${workerId}] Error:`, error);
  }
  
  // Always send response back to main thread
  if (parentPort) {
    console.log(`[Worker ${workerId}] Sending response for command ${msg.cmd}, messageId: ${response.messageId}`);
    parentPort.postMessage(response);
  } else {
    console.error(`[Worker ${workerId}] Parent port not available`);
  }
});

// Cleanup on exit
process.on('exit', async () => {
  console.log(`[Worker ${workerId}] Shutting down...`);
  for (const [browserId] of browsers) {
    try {
      await closeBrowser(browserId);
    } catch (error) {
      // Silent fail on exit
    }
  }
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error(`[Worker ${workerId}] Uncaught exception:`, error);
  parentPort.postMessage({
    type: 'error',
    workerId,
    error: error.message
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[Worker ${workerId}] Unhandled rejection:`, reason);
  parentPort.postMessage({
    type: 'error',
    workerId,
    error: `Unhandled rejection: ${reason}`
  });
});

console.log(`[Worker ${workerId}] Browser worker ready`);