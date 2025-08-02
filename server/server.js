import express from 'express';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import cors from 'cors';

dotenv.config();

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

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
    
    // For auth popups, handle them properly
    if (popup.url().includes('accounts.google.com') || popup.url().includes('oauth')) {
      // Set viewport for popup
      await popup.setViewportSize({ width: 800, height: 600 });
      
      // Make sure popup stays open
      popup.on('close', () => {
        console.log('Auth popup closed');
      });
      
      // Don't block the popup
      await popup.bringToFront();
    }
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
  
  // Listen for navigation requests that might be blocked
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      console.log('Page navigated to:', frame.url());
    }
  });
  
  // Handle navigation errors
  page.on('pageerror', error => {
    console.error('Page error:', error.message);
  });
  
  // Log console messages for debugging
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const errorText = msg.text();
      // Filter out all Chrome extension errors
      if (errorText.includes('chrome-extension://')) {
        return; // Skip logging this error
      }
      console.log('Browser console error:', errorText);
    }
  });
  
  // Handle failed requests
  page.on('requestfailed', request => {
    const url = request.url();
    // Filter out common LinkedIn tracking/analytics failures
    if (url.includes('/MQNt1aTRQzXHrf') || url.includes('/li/tscp/sct')) {
      return; // Skip logging these
    }
    console.log('Request failed:', url, request.failure()?.errorText);
  });

  const app = express();
  const wss = new WebSocketServer({ noServer: true });

  // Middleware
  app.use(cors()); // Enable CORS for all routes
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../client/dist')));

  // Helper functions for contextualized endpoint
  async function extractLinkedInDataFromScreenshot(screenshot) {
    if (!openai) {
      throw new Error('OpenAI client not configured');
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract professional information from this LinkedIn profile screenshot. Return as JSON with fields: name, currentPosition, currentCompany, previousCompanies, education, skills, summary.`
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
                detail: "high"
              }
            }
          ]
        }
      ],
      temperature: 0.3
    });

    try {
      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || [null, content];
      const jsonString = jsonMatch[1] || content;
      return JSON.parse(jsonString.trim());
    } catch (e) {
      throw new Error('Failed to parse LinkedIn data from screenshot');
    }
  }

  async function fetchLinkedInData(linkedInUrl, browserPage) {
    console.log('Navigating to LinkedIn URL:', linkedInUrl);
    
    // Navigate to LinkedIn URL
    await browserPage.goto(linkedInUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait for network idle
    try {
      await browserPage.waitForLoadState('networkidle', { timeout: 5000 });
      console.log('Page reached network idle state');
    } catch (e) {
      console.log('Timeout waiting for network idle, continuing anyway');
    }
    
    // Wait for LinkedIn profile elements
    try {
      await browserPage.waitForSelector('section.artdeco-card', { timeout: 5000 });
      console.log('LinkedIn profile sections loaded');
    } catch (e) {
      console.log('Could not find profile sections, continuing anyway');
    }
    
    // Monitor content changes and wait for stability
    let previousTextLength = 0;
    let stableCount = 0;
    let contentStabilized = false;
    const maxChecks = 20; // Check for up to 20 seconds
    
    for (let checkCount = 0; checkCount < maxChecks && !contentStabilized; checkCount++) {
      const currentContent = await browserPage.evaluate(() => {
        const body = document.body;
        return {
          textLength: body ? body.innerText.trim().length : 0,
          hasImages: document.querySelectorAll('img').length,
          profileSections: document.querySelectorAll('.profile-section, .pv-profile-section, section').length
        };
      });
      
      if (currentContent.textLength !== previousTextLength) {
        console.log(`Content changing: ${previousTextLength} → ${currentContent.textLength} chars`);
        previousTextLength = currentContent.textLength;
        stableCount = 0;
      } else {
        stableCount++;
        
        // Wait for 3 seconds of stability and significant content
        if (stableCount === 3 && currentContent.textLength > 5000) {
          // Check for LinkedIn-specific completion indicators
          const profileComplete = await browserPage.evaluate(() => {
            const spinners = document.querySelectorAll('.spinner, .loading, [data-loading="true"], .artdeco-spinner').length;
            const hasExperience = document.querySelector('.experience-section, [data-section="experience"], #experience, .pv-profile-section__card-item-v2') !== null;
            const hasAbout = document.querySelector('.about-section, [data-section="summary"], #about, .pv-about-section') !== null;
            return { spinners, hasExperience, hasAbout };
          });
          
          if (profileComplete.spinners === 0) {
            contentStabilized = true;
            console.log('✅ Content stabilized! Profile fully loaded');
            console.log(`📏 Final content length: ${currentContent.textLength} chars`);
            console.log(`🖼️  Images: ${currentContent.hasImages}`);
            console.log(`📑 Sections: ${currentContent.profileSections}`);
          }
        }
      }
      
      // Wait 1 second before next check
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (!contentStabilized) {
      console.log('⚠️  Content monitoring timeout - proceeding with capture');
    }
    
    // Critical delay after stabilization - ensures content is fully rendered
    console.log('Waiting 1.5 seconds for final render...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Take screenshot for GPT analysis
    console.log('Capturing full page screenshot...');
    const screenshot = await browserPage.screenshot({ 
      type: 'jpeg', 
      quality: 80,
      fullPage: true
    });
    console.log('Screenshot captured, size:', screenshot.length, 'bytes');

    // Analyze with GPT-4 Vision
    if (!openai) {
      throw new Error('OpenAI client not configured');
    }

    console.log('Analyzing with GPT-4 Vision...');
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract professional information from this LinkedIn profile. Return as JSON with fields: name, currentPosition, currentCompany, previousCompanies, education, skills, summary.`
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
                detail: "high"
              }
            }
          ]
        }
      ],
      temperature: 0.3
    });

    try {
      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || [null, content];
      const jsonString = jsonMatch[1] || content;
      const parsed = JSON.parse(jsonString.trim());
      console.log('✅ Successfully extracted LinkedIn data');
      return parsed;
    } catch (e) {
      console.error('Failed to parse LinkedIn data:', e);
      throw new Error('Failed to parse LinkedIn data');
    }
  }

  async function generateContextualizedAnswers(subqueries, linkedInData) {
    if (!openai) {
      throw new Error('OpenAI client not configured');
    }

    const prompt = `
      You are a helpful assistant answering questions about a professional based on their LinkedIn profile.
      
      LinkedIn Profile Data:
      ${JSON.stringify(linkedInData, null, 2)}
      
      Please answer the following questions based on the LinkedIn data above:
      ${subqueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}
      
      Provide clear, concise answers using only the information available in the LinkedIn profile.
      If information is not available, say so clearly.
      Return as JSON array where each element has 'query' and 'answer' fields.
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3
    });

    try {
      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || [null, content];
      const jsonString = jsonMatch[1] || content;
      const answers = JSON.parse(jsonString.trim());
      
      // Return answers in the expected format
      return answers.map((item, i) => ({
        query: subqueries[i] || item.query,
        answer: item.answer
      }));
    } catch (e) {
      console.error('Error parsing GPT response:', e);
      // Fallback - return error for each query
      return subqueries.map(query => ({
        query: query,
        answer: 'Error generating answer for this query'
      }));
    }
  }


  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok',
      message: 'Mini Browser Server Running',
      timestamp: new Date().toISOString()
    });
  });

  // Contextualized endpoint - receives subqueries and answers them using LinkedIn data
  app.post('/api/contextualized', async (req, res) => {
    const { subqueries, linkedInUrl } = req.body;

    try {
      // Validate inputs
      if (!subqueries || !Array.isArray(subqueries) || subqueries.length === 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing or invalid subqueries array'
        });
      }

      // Get LinkedIn data from current page or navigate if URL provided
      let linkedInData;
      
      if (linkedInUrl) {
        // Navigate to LinkedIn URL using the existing browser session
        console.log('🔵 API CALL: /contextualized endpoint');
        console.log('📍 API: Navigating to LinkedIn URL using existing browser:', linkedInUrl);
        
        // Notify all WebSocket clients that API scanning is starting
        const connectedClients = Array.from(wss.clients).filter(client => client.readyState === client.OPEN);
        connectedClients.forEach(client => {
          client.send(JSON.stringify({
            type: 'apiScanStart',
            message: 'Analyzing LinkedIn Profile via API...'
          }));
        });
        
        // Navigate to the URL
        await page.goto(linkedInUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Wait for network idle
        try {
          await page.waitForLoadState('networkidle', { timeout: 5000 });
          console.log('🔵 API: Page reached network idle state');
        } catch (e) {
          console.log('🔵 API: Timeout waiting for network idle, continuing anyway');
        }
        
        // Wait for LinkedIn profile elements
        try {
          await page.waitForSelector('section.artdeco-card', { timeout: 5000 });
          console.log('🔵 API: LinkedIn profile sections loaded');
        } catch (e) {
          console.log('🔵 API: Could not find profile sections, continuing anyway');
        }
        
        // Quick scroll to trigger lazy-loaded content
        console.log('🔵 API: Quick scroll to trigger lazy content...');
        await page.evaluate(async () => {
          // Quickly scroll down and back up
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(resolve => setTimeout(resolve, 500));
          window.scrollTo(0, 0);
        });
        console.log('🔵 API: Quick scroll complete');
        
        // Monitor content changes and wait for stability (same logic as fetchLinkedInData)
        let previousTextLength = 0;
        let stableCount = 0;
        let contentStabilized = false;
        const maxChecks = 20; // Check for up to 20 seconds
        
        for (let checkCount = 0; checkCount < maxChecks && !contentStabilized; checkCount++) {
          const currentContent = await page.evaluate(() => {
            const body = document.body;
            return {
              textLength: body ? body.innerText.trim().length : 0,
              hasImages: document.querySelectorAll('img').length,
              profileSections: document.querySelectorAll('.profile-section, .pv-profile-section, section').length
            };
          });
          
          if (currentContent.textLength !== previousTextLength) {
            console.log(`🔵 API: Content changing: ${previousTextLength} → ${currentContent.textLength} chars`);
            previousTextLength = currentContent.textLength;
            stableCount = 0;
          } else {
            stableCount++;
            
            // Wait for 3 seconds of stability and significant content
            if (stableCount === 3 && currentContent.textLength > 5000) {
              // Check for LinkedIn-specific completion indicators
              const profileComplete = await page.evaluate(() => {
                const spinners = document.querySelectorAll('.spinner, .loading, [data-loading="true"], .artdeco-spinner').length;
                const hasExperience = document.querySelector('.experience-section, [data-section="experience"], #experience, .pv-profile-section__card-item-v2') !== null;
                const hasAbout = document.querySelector('.about-section, [data-section="summary"], #about, .pv-about-section') !== null;
                return { spinners, hasExperience, hasAbout };
              });
              
              if (profileComplete.spinners === 0) {
                contentStabilized = true;
                console.log('🔵 API: ✅ Content stabilized! Profile fully loaded');
                console.log(`🔵 API: 📏 Final content length: ${currentContent.textLength} chars`);
                console.log(`🖼️  Images: ${currentContent.hasImages}`);
                console.log(`📑 Sections: ${currentContent.profileSections}`);
              }
            }
          }
          
          // Wait 1 second before next check
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (!contentStabilized) {
          console.log('🔵 API: ⚠️  Content monitoring timeout - proceeding with capture');
        }
        
        // Critical delay after stabilization - ensures content is fully rendered
        console.log('🔵 API: Waiting 1.5 seconds for final render...');
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Take screenshot for GPT analysis
        console.log('🔵 API: Capturing full page screenshot...');
        const screenshot = await page.screenshot({ 
          type: 'jpeg', 
          quality: 80,
          fullPage: true
        });
        console.log('🔵 API: Screenshot captured, size:', screenshot.length, 'bytes');
        
        // Extract LinkedIn data from screenshot
        linkedInData = await extractLinkedInDataFromScreenshot(screenshot);
      } else {
        // Use current page if already on LinkedIn
        const currentUrl = page.url();
        if (currentUrl.includes('linkedin.com/in/')) {
          // Take screenshot of current page
          const screenshot = await page.screenshot({ 
            type: 'jpeg', 
            quality: 80,
            fullPage: true
          });
          
          // Extract data from current page
          linkedInData = await extractLinkedInDataFromScreenshot(screenshot);
        } else {
          return res.status(400).json({
            status: 'error',
            message: 'Not on a LinkedIn profile page and no linkedInUrl provided'
          });
        }
      }
      
      // Generate contextualized answers using LinkedIn data
      const answeredQueries = await generateContextualizedAnswers(
        subqueries,
        linkedInData
      );

      // Notify WebSocket clients that scanning is complete
      const connectedClients = Array.from(wss.clients).filter(client => client.readyState === client.OPEN);
      connectedClients.forEach(client => {
        client.send(JSON.stringify({
          type: 'apiScanComplete',
          linkedInData: linkedInData
        }));
      });
      
      res.json({
        status: 'success',
        answers: answeredQueries,
        linkedInData: linkedInData,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error in contextualized endpoint:', error);
      
      // Notify WebSocket clients that scanning failed
      const connectedClients = Array.from(wss.clients).filter(client => client.readyState === client.OPEN);
      connectedClients.forEach(client => {
        client.send(JSON.stringify({
          type: 'apiScanError',
          error: error.message || 'Failed to process LinkedIn data'
        }));
      });
      
      res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
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
                console.log('\n\n========================================');
                console.log('🌐🌐🌐 WEBSITE FULLY LOADED! 🌐🌐🌐');
                console.log('========================================');
                console.log(`URL: ${m.url}`);
                console.log(`Time: ${new Date().toISOString()}`);
                console.log('========================================\n\n');
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
              
              // Wait for network idle and log
              page.waitForLoadState('networkidle', { timeout: 5000 }).then(async () => {
                console.log('\n\n🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
                console.log('⚡⚡⚡ PAGE FULLY LOADED WITH NETWORK IDLE! ⚡⚡⚡');
                console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
                console.log(`🌐 URL: ${page.url()}`);
                console.log(`⏰ Time: ${new Date().toISOString()}`);
                console.log('✅ All network requests completed!');
                console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥\n\n');
                
                // Check for visible content
                const visibleContent = await page.evaluate(() => {
                  const body = document.body;
                  const hasVisibleText = body && body.innerText && body.innerText.trim().length > 100;
                  const mainElements = document.querySelectorAll('main, article, [role="main"], .profile-content, #main-content');
                  const hasMainContent = mainElements.length > 0;
                  return {
                    hasVisibleText,
                    textLength: body ? body.innerText.trim().length : 0,
                    hasMainContent,
                    mainElementCount: mainElements.length
                  };
                });
                console.log('📊 CONTENT CHECK:', visibleContent);
                
                // Monitor content changes and detect when stable
                let previousTextLength = visibleContent.textLength;
                let checkCount = 0;
                let stableCount = 0;
                let contentStabilized = false;
                
                const contentMonitor = setInterval(async () => {
                  checkCount++;
                  const currentContent = await page.evaluate(() => {
                    const body = document.body;
                    return {
                      textLength: body ? body.innerText.trim().length : 0,
                      hasImages: document.querySelectorAll('img').length,
                      profileSections: document.querySelectorAll('.profile-section, .pv-profile-section, section').length
                    };
                  });
                  
                  if (currentContent.textLength !== previousTextLength) {
                    console.log(`📈 CONTENT CHANGED! Text length: ${previousTextLength} → ${currentContent.textLength} | Images: ${currentContent.hasImages} | Sections: ${currentContent.profileSections}`);
                    previousTextLength = currentContent.textLength;
                    stableCount = 0; // Reset stability counter
                  } else {
                    stableCount++;
                    // Log stability progress
                    if (stableCount === 1) {
                      console.log('🟡 Content stable for 1 second...');
                    } else if (stableCount === 2) {
                      console.log('🟡 Content stable for 2 seconds...');
                    } else if (stableCount === 3) {
                      console.log('🟡 Content stable for 3 seconds...');
                    }
                    
                    // Wait for 4 seconds of stability and significant content
                    if (stableCount === 4 && !contentStabilized && currentContent.textLength > 5000) {
                      // Check for LinkedIn-specific completion indicators
                      const profileComplete = await page.evaluate(() => {
                        // Updated selectors for modern LinkedIn
                        const hasExperience = document.querySelector('.experience-section, [data-section="experience"], #experience, .pv-profile-section__card-item-v2') !== null;
                        const hasAbout = document.querySelector('.about-section, [data-section="summary"], #about, .pv-about-section') !== null;
                        const profileActions = document.querySelectorAll('.profile-actions, .pvs-profile-actions, .pv-top-card-v3--list').length > 0;
                        const spinners = document.querySelectorAll('.spinner, .loading, [data-loading="true"], .artdeco-spinner').length;
                        const profileName = document.querySelector('.pv-text-details__left-panel h1, .text-heading-xlarge')?.innerText || 'Not found';
                        const pageTitle = document.title;
                        return { hasExperience, hasAbout, profileActions, spinners, profileName, pageTitle };
                      });
                      
                      if (profileComplete.spinners === 0) {
                        contentStabilized = true;
                        console.log('\n💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚');
                        console.log('✨✨✨ CONTENT STABILIZED! READY FOR INTERACTION! ✨✨✨');
                        console.log(`📏 Final text length: ${currentContent.textLength}`);
                        console.log(`🖼️  Images loaded: ${currentContent.hasImages}`);
                        console.log(`📑 Profile sections: ${currentContent.profileSections}`);
                        console.log(`✅ Has Experience: ${profileComplete.hasExperience}`);
                        console.log(`✅ Has About: ${profileComplete.hasAbout}`);
                        console.log(`✅ No spinners/loading indicators`);
                        console.log(`👤 Profile Name: ${profileComplete.profileName}`);
                        console.log(`📄 Page Title: ${profileComplete.pageTitle}`);
                        console.log(`⏱️  Time: ${new Date().toISOString()}`);
                        console.log('💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚\n');
                        
                        // Auto-trigger profile scan if we're on a LinkedIn profile page
                        const currentUrl = page.url();
                        // TEMPORARILY DISABLED AUTO-SCAN FOR API TESTING
                        if (false && currentUrl.includes('linkedin.com/in/') && currentContent.textLength > 8000) {
                          console.log('🤖 AUTO-TRIGGERING PROFILE SCAN...');
                          console.log(`📊 Scanning profile: ${profileComplete.profileName}`);
                          console.log(`🔗 URL: ${currentUrl}`);
                          // Simulate the scanProfile command
                          setTimeout(async () => {
                            try {
                              console.log('Starting LinkedIn profile scan');
                              
                              // Send status updates so UI shows progress
                              ws.send(JSON.stringify({ type: 'scanStatus', status: 'scanning', message: 'Scanning profile...' }));
                              await new Promise(resolve => setTimeout(resolve, 1000)); // Let UI show scanning state
                              
                              // Capture full page screenshot
                              ws.send(JSON.stringify({ type: 'scanStatus', status: 'capturing', message: 'Capturing profile data...' }));
                              await new Promise(resolve => setTimeout(resolve, 500)); // Let UI update
                              const fullPageScreenshot = await page.screenshot({ 
                                type: 'jpeg', 
                                quality: 80,
                                fullPage: true
                              });
                              
                              console.log('Captured full page screenshot, size:', fullPageScreenshot.length, 'bytes');
                              
                              // Analyze with GPT-4 Vision if API key exists
                              if (openai && process.env.OPENAI_API_KEY) {
                                ws.send(JSON.stringify({ type: 'scanStatus', status: 'analyzing', message: 'Processing with AI...' }));
                                await new Promise(resolve => setTimeout(resolve, 300)); // Let UI show analyzing state
                                console.log('OpenAI client initialized:', !!openai);
                                console.log('API Key exists:', !!process.env.OPENAI_API_KEY);
                                console.log('Sending to GPT-4 Vision for analysis...');
                                
                                const response = await openai.chat.completions.create({
                                  model: "gpt-4o",
                                  messages: [
                                    {
                                      role: "user",
                                      content: [
                                        {
                                          type: "text",
                                          text: `You are helping analyze a professional profile page. Please extract the publicly visible professional information from this screenshot and return it in the following JSON format:
{
  "name": "Full name visible on the profile",
  "currentPosition": "Current job title if visible",
  "currentCompany": "Current company name if visible",
  "previousCompanies": ["List of any previous companies shown"],
  "education": "Educational background if visible",
  "skills": ["Any skills or expertise mentioned"],
  "summary": "A 2-3 sentence professional summary based on the visible information"
}

If any field is not visible in the screenshot, use "Not available" for that field. Only extract information that is clearly visible in the image.`
                                        },
                                        {
                                          type: "image_url",
                                          image_url: {
                                            url: `data:image/jpeg;base64,${fullPageScreenshot.toString('base64')}`,
                                            detail: "high"
                                          }
                                        }
                                      ]
                                    }
                                  ],
                                  max_tokens: 1000,
                                  temperature: 0.3
                                });
                                
                                const analysisResult = response.choices[0].message.content;
                                console.log('GPT Analysis:', analysisResult);
                                
                                // Parse the JSON from the GPT response
                                try {
                                  // Extract JSON from the response (it might be wrapped in ```json``` blocks)
                                  const jsonMatch = analysisResult.match(/```json\n?([\s\S]*?)\n?```/) || [null, analysisResult];
                                  const jsonString = jsonMatch[1] || analysisResult;
                                  const parsedAnalysis = JSON.parse(jsonString.trim());
                                  
                                  // Send the parsed analysis to the client
                                  ws.send(JSON.stringify({
                                    type: 'profileAnalysis',
                                    analysis: parsedAnalysis
                                  }));
                                  console.log('✅ Profile analysis sent to UI');
                                } catch (parseError) {
                                  console.error('Failed to parse GPT response:', parseError);
                                  ws.send(JSON.stringify({
                                    type: 'scanError',
                                    error: 'Failed to parse analysis results'
                                  }));
                                }
                              } else {
                                console.log('OpenAI client not configured, sending screenshot only');
                                ws.send(JSON.stringify({
                                  type: 'profileScreenshot',
                                  data: fullPageScreenshot.toString('base64')
                                }));
                              }
                            } catch (error) {
                              console.error('Auto profile scan error:', error);
                            }
                          }, 1500); // 1.5 second delay to ensure content is fully rendered
                        }
                      } else {
                        console.log(`🟠 Content stable but still loading (${profileComplete.spinners} spinners)`);
                        stableCount = 3; // Keep checking
                      }
                    }
                  }
                  
                  if (checkCount >= 20) { // Check for up to 20 seconds
                    clearInterval(contentMonitor);
                    if (!contentStabilized) {
                      console.log('⚠️  Content monitoring timeout - content may still be loading');
                      console.log(`⚠️  Final state: Text length: ${currentContent.textLength} | Stable for: ${stableCount} seconds`);
                    }
                  }
                }, 1000);
              }).catch(() => {
                console.log('⚠️  Network idle timeout - page may still be loading');
              });
            } catch (navError) {
              console.error('Navigation error:', navError.message);
              await sendScreenshot();
            }
            break;
            
          case 'search':
            console.log('Searching for:', m.query);
            try {
              // Check if we have SerpAPI key
              const serpApiKey = process.env.SERPAPI_KEY;
              if (!serpApiKey) {
                // If no API key, create mock results for demo
                const mockResults = [
                  {
                    title: 'Pratyush Chakraborty LinkedIn profile',
                    link: 'https://www.linkedin.com/in/pratyush-chakraborty',
                    snippet: 'Pratyush Chakraborty - Facebook, LinkedIn - Clay.earth',
                    source: 'linkedin',
                    favicon: null
                  },
                  {
                    title: 'orcid',
                    link: 'https://orcid.org/0000-0003-1326-7567',
                    snippet: '0000-0003-1326-7567 - ORCID',
                    source: 'orcid',
                    favicon: null
                  },
                  {
                    title: 'bits-pilani',
                    link: 'https://www.bits-pilani.ac.in/prof-pratyush-chakraborty',
                    snippet: 'Prof. Pratyush Chakraborty - BITS Pilani',
                    source: 'bits-pilani',
                    favicon: null
                  },
                  {
                    title: 'bestadsontv',
                    link: 'https://bestadsontv.com/profile/pratyush-chakraborty',
                    snippet: 'Pratyush Chakraborty - Best Ads on TV',
                    source: 'bestadsontv',
                    favicon: null
                  },
                  {
                    title: 'linkedin',
                    link: 'https://www.linkedin.com/posts/pratyush-chakraborty',
                    snippet: 'Pratyush Chakraborty, Ph.D.\'s Post - LinkedIn',
                    source: 'linkedin',
                    favicon: null
                  }
                ];
                
                ws.send(JSON.stringify({ 
                  type: 'searchResults', 
                  query: m.query,
                  results: mockResults 
                }));
              } else {
                // Use real SerpAPI
                const searchUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(m.query)}&api_key=${serpApiKey}`;
                const response = await axios.get(searchUrl);
                const organicResults = response.data.organic_results || [];
                
                const results = organicResults.slice(0, 5).map(result => ({
                  title: result.title,
                  link: result.link,
                  snippet: result.snippet,
                  source: new URL(result.link).hostname.replace('www.', ''),
                  favicon: result.favicon || null
                }));
                
                ws.send(JSON.stringify({ 
                  type: 'searchResults', 
                  query: m.query,
                  results 
                }));
              }
            } catch (error) {
              console.error('Search error:', error);
              // Send empty results on error
              ws.send(JSON.stringify({ 
                type: 'searchResults', 
                query: m.query,
                results: [] 
              }));
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
            
            // Check if we clicked on an input field and get cursor position
            const clickResult = await page.evaluate(({x, y}) => {
              const element = document.elementFromPoint(x, y);
              if (element) {
                // Check if it's an input field or contenteditable
                const isInput = element.tagName === 'INPUT' || 
                               element.tagName === 'TEXTAREA' || 
                               element.contentEditable === 'true' ||
                               element.closest('[contenteditable="true"]');
                
                if (isInput) {
                  element.focus();
                  
                  // Get the cursor position for input/textarea
                  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                    const rect = element.getBoundingClientRect();
                    const style = window.getComputedStyle(element);
                    const fontSize = parseFloat(style.fontSize);
                    const padding = parseFloat(style.paddingLeft);
                    
                    // Estimate cursor position based on text length
                    const text = element.value || '';
                    const textWidth = text.length * (fontSize * 0.6); // Rough estimate
                    
                    return {
                      isInput: true,
                      cursorX: rect.left + padding + textWidth,
                      cursorY: rect.top + rect.height / 2
                    };
                  }
                  
                  return { isInput: true, cursorX: x, cursorY: y };
                }
              }
              return { isInput: false };
            }, {x: m.x, y: m.y});
            
            // Send input field status to client
            ws.send(JSON.stringify({ 
              type: 'clickResult', 
              isInputField: clickResult.isInput
            }));
            
            // If it's an input field, get accurate cursor position after a short delay
            if (clickResult.isInput) {
              setTimeout(async () => {
                const cursorPos = await page.evaluate(() => {
                  const activeElement = document.activeElement;
                  if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                    // Get caret position
                    const selection = window.getSelection();
                    if (selection.rangeCount > 0) {
                      const range = selection.getRangeAt(0);
                      const rect = range.getBoundingClientRect();
                      if (rect.width === 0) {
                        // No selection, use input position
                        const inputRect = activeElement.getBoundingClientRect();
                        return {
                          x: inputRect.left + 5,
                          y: inputRect.top + inputRect.height / 2
                        };
                      }
                      return {
                        x: rect.left,
                        y: rect.top + rect.height / 2
                      };
                    }
                  }
                  return null;
                });
                
                if (cursorPos) {
                  ws.send(JSON.stringify({
                    type: 'cursorPosition',
                    x: cursorPos.x,
                    y: cursorPos.y
                  }));
                }
              }, 100);
            }
            
            // Rapid screenshots after click for smooth feedback
            await sendScreenshot();
            setTimeout(() => sendScreenshot(), 50);
            setTimeout(() => sendScreenshot(), 150);
            setTimeout(() => sendScreenshot(), 300);
            
            // Check if click triggered navigation
            try {
              // For auth pages, wait longer and don't block
              if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
                setTimeout(async () => {
                  await sendScreenshot();
                  sendUrlUpdate();
                }, 1000);
                setTimeout(() => sendScreenshot(), 2000);
              } else {
                await page.waitForLoadState('domcontentloaded', { timeout: 500 });
                // Navigation detected
                sendUrlUpdate();
                await sendScreenshot();
                setTimeout(() => sendScreenshot(), 200);
                setTimeout(() => sendScreenshot(), 400);
              }
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
              
              // Update cursor position after typing
              const cursorPos = await page.evaluate(() => {
                const activeElement = document.activeElement;
                if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                  const inputRect = activeElement.getBoundingClientRect();
                  const style = window.getComputedStyle(activeElement);
                  const fontSize = parseFloat(style.fontSize);
                  const paddingLeft = parseFloat(style.paddingLeft);
                  
                  // Create a temporary span to measure text width
                  const span = document.createElement('span');
                  span.style.font = style.font;
                  span.style.visibility = 'hidden';
                  span.style.position = 'absolute';
                  span.textContent = activeElement.value || '';
                  document.body.appendChild(span);
                  const textWidth = span.getBoundingClientRect().width;
                  document.body.removeChild(span);
                  
                  return {
                    x: inputRect.left + paddingLeft + Math.min(textWidth, inputRect.width - paddingLeft * 2),
                    y: inputRect.top + inputRect.height / 2
                  };
                }
                return null;
              });
              
              if (cursorPos) {
                ws.send(JSON.stringify({
                  type: 'cursorPosition',
                  x: cursorPos.x,
                  y: cursorPos.y
                }));
              }
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
            
          case 'scanProfile':
            console.log('Starting LinkedIn profile scan');
            try {
              const currentUrl = page.url();
              
              // Only proceed if we're on a LinkedIn profile
              if (!currentUrl.includes('linkedin.com/in/')) {
                ws.send(JSON.stringify({ 
                  type: 'scanError', 
                  error: 'Not on a LinkedIn profile page' 
                }));
                break;
              }
              
              // Visual scanning effect - quick scroll down then up
              ws.send(JSON.stringify({ type: 'scanStatus', status: 'scanning', message: 'Analyzing profile...' }));
              
              // Get page height
              const pageHeight = await page.evaluate(() => document.body.scrollHeight);
              
              // Quick scan down (visual effect)
              const scanSteps = 8;
              for (let i = 1; i <= scanSteps; i++) {
                const scrollTo = (pageHeight / scanSteps) * i;
                await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'auto' }), scrollTo);
                await page.waitForTimeout(100); // Increased delay for better visual effect
                await sendScreenshot(); // Show the scrolling to user
              }
              
              // Quick scan back up
              for (let i = scanSteps - 1; i >= 0; i--) {
                const scrollTo = (pageHeight / scanSteps) * i;
                await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'auto' }), scrollTo);
                await page.waitForTimeout(80); // Increased delay
                await sendScreenshot();
              }
              
              // Small delay before capturing to ensure UI updates
              await new Promise(resolve => setTimeout(resolve, 200));
              
              // Now take the full page screenshot
              ws.send(JSON.stringify({ type: 'scanStatus', status: 'capturing', message: 'Capturing profile data...' }));
              await sendScreenshot(); // Send one more frame to show we're at capturing stage
              await new Promise(resolve => setTimeout(resolve, 500)); // Delay to show capturing status
              
              const fullPageScreenshot = await page.screenshot({ 
                type: 'jpeg', 
                quality: 80,
                fullPage: true
              });
              
              console.log('Captured full page screenshot, size:', fullPageScreenshot.length, 'bytes');
              
              // Update status to analyzing
              ws.send(JSON.stringify({ type: 'scanStatus', status: 'analyzing', message: 'Processing with AI...' }));
              await sendScreenshot(); // Update UI
              await new Promise(resolve => setTimeout(resolve, 500)); // Show analyzing status
              
              // Analyze with GPT-4 Vision if API key exists
              if (openai && process.env.OPENAI_API_KEY) {
                try {
                  console.log('OpenAI client initialized:', !!openai);
                  console.log('API Key exists:', !!process.env.OPENAI_API_KEY);
                  console.log('Sending to GPT-4 Vision for analysis...');
                  
                  // Custom prompt - you can modify this
                  const prompt = m.prompt || `Analyze this LinkedIn profile and extract the following information in JSON format:
{
  "name": "Full name",
  "currentPosition": "Current job title",
  "currentCompany": "Current company name",
  "previousCompanies": ["List of previous companies"],
  "education": "Education details",
  "skills": ["List of top skills"],
  "summary": "Brief 2-3 sentence summary of their background and expertise"
}

Be accurate and only include information you can see in the profile.`;
                  
                  const response = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [
                      {
                        role: "user",
                        content: [
                          {
                            type: "text",
                            text: prompt
                          },
                          {
                            type: "image_url",
                            image_url: {
                              url: `data:image/jpeg;base64,${fullPageScreenshot.toString('base64')}`,
                              detail: "high" // Use high detail for better accuracy
                            }
                          }
                        ]
                      }
                    ],
                    max_tokens: 1000,
                    temperature: 0.3 // Lower temperature for more consistent extraction
                  });
                  
                  const analysisText = response.choices[0].message.content;
                  console.log('GPT Analysis:', analysisText);
                  
                  // Try to parse as JSON, fallback to text if not valid JSON
                  let analysis;
                  try {
                    analysis = JSON.parse(analysisText);
                  } catch (e) {
                    // If not valid JSON, create a simple object with the text
                    analysis = {
                      name: "Analysis Complete",
                      currentPosition: "See summary",
                      currentCompany: "See summary",
                      previousCompanies: [],
                      education: "See summary",
                      skills: [],
                      summary: analysisText
                    };
                  }
                  
                  ws.send(JSON.stringify({ 
                    type: 'profileAnalysis', 
                    analysis: analysis,
                    scanComplete: true
                  }));
                  
                } catch (error) {
                  console.error('GPT analysis error:', error);
                  console.error('Error details:', error.message, error.response?.data);
                  // Fallback to mock data on error
                  ws.send(JSON.stringify({ 
                    type: 'profileAnalysis', 
                    analysis: {
                      name: "Analysis Failed",
                      currentPosition: "Error",
                      currentCompany: "Error",
                      previousCompanies: [],
                      education: "Error",
                      skills: [],
                      summary: `GPT analysis failed: ${error.message}`
                    },
                    scanComplete: true
                  }));
                }
              } else {
                // No API key, use mock data
                console.log('No OpenAI API key found, using mock data');
                const mockAnalysis = {
                  name: "Pratyush Chakraborty",
                  currentPosition: "Software Engineer",
                  currentCompany: "Meta/Facebook",
                  previousCompanies: ["Google", "Microsoft"],
                  education: "BITS Pilani",
                  skills: ["JavaScript", "React", "Node.js", "Python"],
                  summary: "Experienced software engineer with background in full-stack development. (This is mock data - add OPENAI_API_KEY to .env for real analysis)"
                };
                
                ws.send(JSON.stringify({ 
                  type: 'profileAnalysis', 
                  analysis: mockAnalysis,
                  scanComplete: true
                }));
              }
              
              // Stay at top of page
              await sendScreenshot();
              
            } catch (error) {
              console.error('Profile scan error:', error);
              ws.send(JSON.stringify({ 
                type: 'scanError', 
                error: error.message 
              }));
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