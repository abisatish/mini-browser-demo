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
      // OPTIMIZATION #7: Chromium launch flags for containers
      args: [
        ...BROWSER_ARGS,
        '--disable-dev-shm-usage',  // Critical for Docker
        '--disable-background-timer-throttling',  // Don't throttle timers
        '--disable-renderer-backgrounding',  // Keep renderer active
        '--disable-features=TranslateUI',  // Trim extras
        '--max-renderer-process-count=1',  // One renderer per browser
        '--memory-pressure-off'  // Disable memory pressure reporting
      ],
      // Reduce resource usage
      chromiumSandbox: false,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false
    });
    
    // Create context with reasonable defaults
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },  // OPTIMIZATION #6: Force 720p viewport
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
    
    // OPTIMIZATION #5: Block heavy resources (video/streaming/analytics)
    try {
      await context.route('**/*', (route, request) => {
        const type = request.resourceType();
        const url = request.url();
        
        // Kill video/audio streams and very large files
        if (type === 'media' || url.endsWith('.mp4') || url.endsWith('.m3u8') || url.endsWith('.webm')) {
          return route.abort();
        }
        
        // Block heavy trackers/ads that hurt FPS
        if (url.includes('doubleclick.net') || url.includes('googletagmanager.com') || 
            url.includes('google-analytics.com') || url.includes('facebook.com/tr')) {
          return route.abort();
        }
        
        return route.continue();
      });
    } catch (routeError) {
      console.log(`[Worker ${workerId}] Route setup error (non-fatal):`, routeError.message);
    }
    
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
    
    // OPTIMIZATION #5: Disable animations and transitions for better performance
    try {
      await page.addStyleTag({ 
        content: `
          * { 
            animation: none !important; 
            transition: none !important; 
          }
          video, canvas { 
            filter: opacity(0.9999); /* pause heavy paints without blanking */
          }
        `
      });
    } catch (styleError) {
      console.log(`[Worker ${workerId}] Style injection error (non-fatal):`, styleError.message);
    }
    
    // OPTIMIZATION #6: Ensure viewport is 720p
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
    } catch (viewportError) {
      console.log(`[Worker ${workerId}] Viewport error (non-fatal):`, viewportError.message);
    }
    
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
    
    // Navigate to LinkedIn Sales Navigator
    await page.goto('https://www.linkedin.com/sales', { 
      waitUntil: 'domcontentloaded',
      timeout: 15000 
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
          console.log(`[Worker ${workerId}] Starting navigation to: ${command.url}`);
          await page.goto(command.url, { 
            waitUntil: 'domcontentloaded',
            timeout: 15000 
          });
          const finalUrl = page.url();
          const title = await page.title().catch(() => 'Loading...');
          console.log(`[Worker ${workerId}] Navigation completed - URL: ${finalUrl}, Title: ${title}`);
          
          response.url = finalUrl;
          response.title = title;
          response.loading = false;
          response.success = true;
          
          // Wait a bit for page to stabilize
          await page.waitForTimeout(500);
        } catch (navError) {
          console.error(`[Worker ${workerId}] Navigation error:`, navError.message);
          console.error(`[Worker ${workerId}] Failed URL was: ${command.url}`);
          response.error = navError.message;
          response.loading = false;
        } finally {
          // Clear navigation flag
          pages.delete(browserId + '_navigating');
          console.log(`[Worker ${workerId}] Navigation flag cleared for browser ${browserId}`);
        }
        break;
        
      case 'scanLeads':
        console.log(`[Worker ${workerId}] Starting lead scan`);
        
        try {
          const currentUrl = page.url();
          console.log(`[Worker ${workerId}] Scanning leads on page: ${currentUrl}`);
          
          // Take full page screenshot (exact same as profile scanner)
          console.log(`[Worker ${workerId}] Capturing full page screenshot for leads...`);
          const screenshot = await page.screenshot({ 
            type: 'jpeg', 
            quality: 80,
            fullPage: true
          });
          console.log(`[Worker ${workerId}] Lead screenshot captured, size: ${screenshot.length} bytes`);
          
          // Import AI SDKs
          const { default: Anthropic } = await import('@anthropic-ai/sdk');
          const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
          }) : null;
          
          if (!anthropic) {
            console.log(`[Worker ${workerId}] No AI client configured`);
            response.type = 'leadsAnalysis';
            response.error = 'No AI client configured (need Anthropic API key)';
            break;
          }
          
          console.log(`[Worker ${workerId}] 🔵 API: Using Claude for lead analysis`);
            
          try {
            console.log(`[Worker ${workerId}] 🔵 API: Preparing Claude request for leads...`);
            const startTime = Date.now();
              
            const claudeResponse = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 1000,
                temperature: 0.3,
                messages: [{
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `Look at this screenshot and extract information about any people/profiles visible.

This could be:
- A LinkedIn profile or search results
- Sales Navigator leads
- Any webpage with people's information

For each person visible, extract:
- name: Their full name
- title: Their job title/position (or "Not available" if not shown)
- company: Their company/organization (or "Not available" if not shown)

Extract ALL people visible in the screenshot, whether it's one person or many.

Return ONLY a valid JSON array. Example format:
[{"name": "John Doe", "title": "Software Engineer", "company": "Tech Corp"}]

If you cannot find any people/profiles, return: []`
                    },
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: "image/jpeg",
                        data: screenshot.toString('base64')
                      }
                    }
                  ]
                }]
              });
              
            const endTime = Date.now();
            console.log(`[Worker ${workerId}] 🔵 API: Claude API call completed in:`, endTime - startTime, 'ms');
            
            const content = claudeResponse.content[0].text;
            console.log(`[Worker ${workerId}] 🔵 API: Claude extracted leads text:`, content);
            
            // Parse response
            try {
              const jsonMatch = content.match(/\[[\s\S]*\]/) || [null, content];
              const jsonString = jsonMatch[0] || content;
              const leads = JSON.parse(jsonString.trim());
              
              console.log(`[Worker ${workerId}] 🔵 API: Successfully parsed ${leads.length} leads`);
              response.type = 'leadsAnalysis';
              response.leads = leads;
              
            } catch (e) {
              console.error(`[Worker ${workerId}] 🔵 API: Failed to parse Claude response:`, content);
              response.type = 'leadsAnalysis';
              response.error = 'Failed to parse lead data from screenshot';
            }
            
          } catch (claudeError) {
            console.error(`[Worker ${workerId}] 🔵 API: Claude error occurred`);
            console.error(`[Worker ${workerId}] 🔵 API: Error message:`, claudeError.message);
            response.type = 'leadsAnalysis';
            response.error = claudeError.message || 'Failed to analyze leads';
          }
          
        } catch (error) {
          console.error(`[Worker ${workerId}] Lead scan error:`, error);
          response.type = 'leadsAnalysis';
          response.error = error.message || 'Failed to scan leads';
        }
        break;
        
      case 'scanProfile':
        console.log(`[Worker ${workerId}] Starting profile scan with full page capture`);
        
        try {
          const currentUrl = page.url();
          console.log(`[Worker ${workerId}] Scanning profile on page: ${currentUrl}`);
          
          // Wait a bit for page to fully load
          await page.waitForTimeout(1000);
          
          // Fixed interval scrolling with screenshots at each position
          const SCROLL_STEP = 721; // Fixed scroll step
          const TOTAL_HEIGHT = 2688; // Target total height
          const NUM_SCROLLS = Math.ceil(TOTAL_HEIGHT / SCROLL_STEP); // Should be about 4 scrolls
          
          console.log(`[Worker ${workerId}] ============================================`);
          console.log(`[Worker ${workerId}] FIXED INTERVAL SCROLLING PLAN:`);
          console.log(`[Worker ${workerId}] Scroll step: ${SCROLL_STEP}px`);
          console.log(`[Worker ${workerId}] Total height to cover: ${TOTAL_HEIGHT}px`);
          console.log(`[Worker ${workerId}] Number of scrolls: ${NUM_SCROLLS}`);
          console.log(`[Worker ${workerId}] ============================================`);
          
          // Array to hold all screenshots
          const scrollScreenshots = [];
          
          // Start at top
          await page.evaluate(() => {
            window.scrollTo(0, 0);
          });
          await page.waitForTimeout(1000);
          
          // FOR LOOP - exactly NUM_SCROLLS iterations, no stopping early
          for (let i = 0; i < NUM_SCROLLS; i++) {
            const scrollPosition = i * SCROLL_STEP;
            
            // Scroll to specific position
            await page.evaluate((pos) => {
              window.scrollTo(0, pos);
            }, scrollPosition);
            
            // Wait for content to load at this position
            await page.waitForTimeout(1500);
            
            // Get current state
            const scrollState = await page.evaluate(() => {
              const leadsRows = document.querySelectorAll('tr[data-x--people-list--row]');
              return {
                scrollY: window.scrollY,
                documentHeight: document.documentElement.scrollHeight,
                bodyHeight: document.body.scrollHeight,
                visibleLeads: leadsRows.length,
                viewportHeight: window.innerHeight
              };
            });
            
            console.log(`[Worker ${workerId}] Scroll ${i + 1}/${NUM_SCROLLS}:`);
            console.log(`[Worker ${workerId}]   - Scrolled to: ${scrollState.scrollY}px`);
            console.log(`[Worker ${workerId}]   - Document height: ${scrollState.documentHeight}px`);
            console.log(`[Worker ${workerId}]   - Body height: ${scrollState.bodyHeight}px`);
            console.log(`[Worker ${workerId}]   - Visible leads: ${scrollState.visibleLeads}`);
            
            // Take screenshot at this scroll position
            const screenshot = await page.screenshot({ 
              type: 'jpeg', 
              quality: 80,
              fullPage: false  // Just viewport at current scroll position
            });
            
            scrollScreenshots.push({
              scrollPosition: scrollState.scrollY,
              screenshot: screenshot,
              leadCount: scrollState.visibleLeads,
              documentHeight: scrollState.documentHeight
            });
            
            console.log(`[Worker ${workerId}]   - Screenshot ${i + 1} captured (${(screenshot.length / 1024).toFixed(2)} KB)`);
          }
          
          console.log(`[Worker ${workerId}] ============================================`);
          console.log(`[Worker ${workerId}] SCROLLING COMPLETE:`);
          console.log(`[Worker ${workerId}] Total screenshots taken: ${scrollScreenshots.length}`);
          console.log(`[Worker ${workerId}] ============================================`);
          
          // Scroll back to top for final full-page capture
          await page.evaluate(() => {
            window.scrollTo(0, 0);
          });
          await page.waitForTimeout(500);
          
          // Get final page info after all scrolling
          const pageInfo = await page.evaluate(() => {
            const leadsRows = document.querySelectorAll('tr[data-x--people-list--row]');
            const scrollHeight = document.documentElement.scrollHeight;
            const viewportHeight = window.innerHeight;
            const bodyHeight = document.body.scrollHeight;
            
            return {
              leadCount: leadsRows.length,
              scrollHeight,
              viewportHeight,
              bodyHeight,
              url: window.location.href
            };
          });
          
          console.log(`[Worker ${workerId}] FINAL STATE AFTER ALL SCROLLS:`);
          console.log(`[Worker ${workerId}]   - Total leads found: ${pageInfo.leadCount}`);
          console.log(`[Worker ${workerId}]   - Final document height: ${pageInfo.scrollHeight}px`);
          console.log(`[Worker ${workerId}]   - Final body height: ${pageInfo.bodyHeight}px`);
          
          // Now take the final full-page screenshot
          console.log(`[Worker ${workerId}] ============================================`);
          console.log(`[Worker ${workerId}] TAKING FINAL FULL PAGE SCREENSHOT:`);
          console.log(`[Worker ${workerId}] Expected capture: 1280 x ${pageInfo.scrollHeight} pixels`);
          console.log(`[Worker ${workerId}] ============================================`);
          
          const fullPageScreenshot = await page.screenshot({ 
            type: 'jpeg', 
            quality: 80,
            fullPage: true  // This should now capture everything that was loaded
          });
          
          // Function to extract JPEG dimensions from buffer
          function getJpegDimensions(buffer) {
            // JPEG format: SOI marker (FFD8) followed by segments
            // We're looking for SOF0 (FFC0) or SOF2 (FFC2) markers which contain dimensions
            let i = 2; // Skip SOI marker
            while (i < buffer.length - 9) {
              if (buffer[i] === 0xFF) {
                const marker = buffer[i + 1];
                // SOF0 (baseline) or SOF2 (progressive) markers
                if (marker === 0xC0 || marker === 0xC2) {
                  // Height is at offset 5-6, Width at 7-8 from marker
                  const height = (buffer[i + 5] << 8) | buffer[i + 6];
                  const width = (buffer[i + 7] << 8) | buffer[i + 8];
                  return { width, height };
                }
                // Skip to next segment
                const segmentLength = (buffer[i + 2] << 8) | buffer[i + 3];
                i += segmentLength + 2;
              } else {
                i++;
              }
            }
            return { width: 0, height: 0 };
          }
          
          // Get actual dimensions from the JPEG buffer
          const actualDimensions = getJpegDimensions(fullPageScreenshot);
          
          console.log(`[Worker ${workerId}] ============================================`);
          console.log(`[Worker ${workerId}] ACTUAL SCREENSHOT CAPTURED:`);
          console.log(`[Worker ${workerId}] Dimensions: ${actualDimensions.width} x ${actualDimensions.height} pixels`);
          console.log(`[Worker ${workerId}] File size: ${(fullPageScreenshot.length / 1024).toFixed(2)} KB`);
          console.log(`[Worker ${workerId}] Height match: ${actualDimensions.height === pageInfo.scrollHeight ? '✓ MATCHES EXPECTED' : `✗ MISMATCH (expected ${pageInfo.scrollHeight}px)`}`);
          console.log(`[Worker ${workerId}] ============================================`);
          
          // Get the actual dimensions of the screenshot
          const screenshotInfo = {
            bytes: fullPageScreenshot.length,
            actualWidth: actualDimensions.width,
            actualHeight: actualDimensions.height,
            expectedHeight: pageInfo.scrollHeight,
            viewportHeight: pageInfo.viewportHeight,
            viewportWidth: 1280,  // We set this to 1280 in browser config
            estimatedPixels: pageInfo.scrollHeight * 1280,
            actualPixels: actualDimensions.width * actualDimensions.height
          };
          
          console.log(`[Worker ${workerId}] ✅ Full page screenshot captured:`);
          console.log(`[Worker ${workerId}]   - File size: ${screenshotInfo.bytes} bytes`);
          console.log(`[Worker ${workerId}]   - ACTUAL dimensions: ${screenshotInfo.actualWidth} x ${screenshotInfo.actualHeight} pixels`);
          console.log(`[Worker ${workerId}]   - Expected dimensions: 1280 x ${screenshotInfo.expectedHeight} pixels`);
          console.log(`[Worker ${workerId}]   - Dimension match: ${screenshotInfo.actualHeight === screenshotInfo.expectedHeight ? '✅ YES' : '❌ NO'}`);
          console.log(`[Worker ${workerId}]   - Actual pixels: ${(screenshotInfo.actualPixels / 1000000).toFixed(1)} megapixels`);
          console.log(`[Worker ${workerId}]   - Page had ${pageInfo.leadCount} leads visible`);
          console.log(`[Worker ${workerId}]   - Bytes per pixel: ${(screenshotInfo.bytes / screenshotInfo.actualPixels).toFixed(3)}`);
          
          // Use the 4 scroll screenshots instead of the full page screenshot
          const screenshots = scrollScreenshots.map(s => s.screenshot);
          
          // Scroll back to top after capture
          await page.evaluate(() => window.scrollTo(0, 0));
          
          console.log(`[Worker ${workerId}] Using ${scrollScreenshots.length} scroll screenshots for analysis`);
          
          // Import AI SDKs
          const { default: Anthropic } = await import('@anthropic-ai/sdk');
          const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
          }) : null;
          
          if (!anthropic) {
            console.log(`[Worker ${workerId}] No AI client configured`);
            response.type = 'profileAnalysis';
            response.error = 'No AI client configured (need Anthropic API key)';
            break;
          }
          
          console.log(`[Worker ${workerId}] 🔵 API: Using Claude for profile analysis`);
          
          const prompt = `Look at this screenshot and extract information about any people/profiles visible.

For each person visible, extract:
- name: Their full name
- title: Their job title/position (or "Not available" if not shown)
- company: Their company/organization (or "Not available" if not shown)

Extract ALL people visible in the screenshot, whether it's one person or many.

Return ONLY a valid JSON array. Example format:
[{"name": "John Doe", "title": "Software Engineer", "company": "Tech Corp"}]

If you cannot find any people/profiles, return: []`;
          
          try {
            console.log(`[Worker ${workerId}] 🔵 API: Preparing Claude request with ${screenshots.length} screenshots...`);
            const startTime = Date.now();
            
            // Build content array with text prompt followed by all screenshots
            const contentArray = [
              {
                type: "text",
                text: prompt + "\n\nI'm showing you multiple screenshots from scrolling through the page. Extract ALL unique people you see across all screenshots. Don't duplicate if you see the same person multiple times."
              }
            ];
            
            // Add each screenshot as an image
            for (let i = 0; i < screenshots.length; i++) {
              contentArray.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: screenshots[i].toString('base64')
                }
              });
            }
            
            const claudeResponse = await anthropic.messages.create({
              model: "claude-3-5-sonnet-20241022",
              max_tokens: 2000, // Increased for more results
              temperature: 0.3,
              messages: [{
                role: "user",
                content: contentArray
              }]
            });
            
            const endTime = Date.now();
            console.log(`[Worker ${workerId}] 🔵 API: Claude API call completed in:`, endTime - startTime, 'ms');
            
            const content = claudeResponse.content[0].text;
            console.log(`[Worker ${workerId}] 🔵 API: Claude extracted profile text:`, content);
            
            // Parse response (now expecting an array of leads)
            try {
              const jsonMatch = content.match(/\[[\s\S]*\]/) || [null, content];
              const jsonString = jsonMatch[0] || content;
              const leads = JSON.parse(jsonString.trim());
              
              console.log(`[Worker ${workerId}] 🔵 API: Successfully parsed ${leads.length} leads from profile scan`);
              response.type = 'profileAnalysis';
              response.leads = leads;  // Changed from profileData to leads
              response.rawAnalysis = content;
              
            } catch (e) {
              console.error(`[Worker ${workerId}] 🔵 API: Failed to parse Claude response:`, content);
              response.type = 'profileAnalysis';
              response.leads = [];  // Changed from profileData to leads
              response.rawAnalysis = content;
            }
            
          } catch (claudeError) {
            console.error(`[Worker ${workerId}] 🔵 API: Claude error occurred`);
            console.error(`[Worker ${workerId}] 🔵 API: Error message:`, claudeError.message);
            response.type = 'profileAnalysis';
            response.error = claudeError.message || 'Failed to analyze profile';
          }
          
        } catch (error) {
          console.error(`[Worker ${workerId}] Profile scan error:`, error);
          response.type = 'profileAnalysis';
          response.error = error.message || 'Failed to scan profile';
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
        
        // Optimization #1: Check readyState to skip during loading
        const readyState = await page.evaluate(() => document.readyState).catch(() => 'loading');
        if (readyState === 'loading') {
          response.skipped = true;
          response.reason = 'page_loading';
          break;
        }
        
        // OPTIMIZATION #1: Encode at capture (JPEG) - no post re-compression
        const quality = Math.max(40, Math.min(95, command.quality ?? 75));
        
        try {
          const buf = await page.screenshot({
            type: 'jpeg',  // JPEG is 5-10x cheaper than PNG
            quality: quality,
            clip: { x: 0, y: 0, width: 1280, height: 720 },  // Force 720p viewport
            fullPage: false,
            timeout: 300
          });
          
          if (buf) {
            // ZERO-COPY transfer using transferList
            response.screenshot = buf;
            response.compressed = true;  // Mark as already compressed
            response.transferList = [buf.buffer];  // Transfer ownership to main thread
            stats.screenshotsGenerated++;
          } else {
            response.skipped = true;
            response.reason = 'failed';
          }
        } catch (error) {
          response.skipped = true;
          response.reason = 'error';
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
  
  // Don't warn about memory - let it run freely
  // Memory management is handled by the OS and Node.js
  
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
    // Use transferList for zero-copy transfer of screenshots
    if (response.transferList) {
      parentPort.postMessage(response, response.transferList);
      delete response.transferList; // Clean up
    } else {
      parentPort.postMessage(response);
    }
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

process.on('unhandledRejection', (reason) => {
  console.error(`[Worker ${workerId}] Unhandled rejection:`, reason);
  parentPort.postMessage({
    type: 'error',
    workerId,
    error: `Unhandled rejection: ${reason}`
  });
});

console.log(`[Worker ${workerId}] Browser worker ready`);