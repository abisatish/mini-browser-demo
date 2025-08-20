import express from 'express';
import { WebSocketServer } from 'ws';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs/promises';
import fsSync from 'fs';
import { cpus } from 'os';
import { EventEmitter } from 'events';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration optimized for m7a.2xlarge (8 vCPUs, 32GB RAM) - 10-12 users
const CONFIG = {
  MAX_CONCURRENT_USERS: parseInt(process.env.MAX_USERS) || 10,  // Increased from 3 to 10
  BROWSER_WORKERS: parseInt(process.env.BROWSER_WORKERS) || 6,  // Increased from 3 to 6
  BROWSERS_PER_WORKER: parseInt(process.env.BROWSERS_PER_WORKER) || 2, // Increased from 1 to 2
  SCREENSHOT_QUALITY: parseInt(process.env.SCREENSHOT_QUALITY) || 75,  // 75 is sweet spot for JPEG
  TARGET_FPS: parseInt(process.env.TARGET_FPS) || 12, // 12 FPS is smoother with less CPU
  REQUEST_QUEUE_SIZE: parseInt(process.env.REQUEST_QUEUE_SIZE) || 100, // Increased from 50 to 100
  SESSION_TIMEOUT: parseInt(process.env.SESSION_TIMEOUT) || 30 * 60 * 1000,
  WORKER_RESTART_DELAY: parseInt(process.env.WORKER_RESTART_DELAY) || 3000,
  MAX_RETRIES: 3,
  SCREENSHOT_COMPRESSION: process.env.SCREENSHOT_COMPRESSION === 'true', // Default false
  PRIORITY_MODE: process.env.PRIORITY_MODE !== 'false' // Default true
};

console.log('🚀 Multi-threaded server configuration:', CONFIG);

// Session Manager - tracks all active user sessions
class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
    this.browserAssignments = new Map(); // ws -> browserId
    this.sessionActivity = new Map(); // sessionId -> lastActivity
    
    // Clean up inactive sessions every 5 minutes
    setInterval(() => this.cleanupInactiveSessions(), 5 * 60 * 1000);
  }

  createSession(ws) {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const session = {
      id: sessionId,
      ws,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      browserId: null,
      pendingRequests: [],
      stats: {
        commands: 0,
        screenshots: 0,
        errors: 0,
        droppedFrames: 0
      },
      // Adaptive FPS tracking
      adaptiveFPS: {
        current: CONFIG.TARGET_FPS,
        min: 2,  // Lower minimum for idle
        max: CONFIG.TARGET_FPS,
        lastAdjust: Date.now(),
        backpressureCount: 0,
        lastActivity: Date.now(),
        idleTimeout: 3000,  // 3 seconds to idle
        isIdle: false
      }
    };
    
    this.sessions.set(sessionId, session);
    this.sessionActivity.set(sessionId, Date.now());
    ws.sessionId = sessionId;
    
    console.log(`📝 Created session ${sessionId}`);
    return session;
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      this.sessionActivity.set(sessionId, Date.now());
    }
    return session;
  }

  removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      this.sessionActivity.delete(sessionId);
      this.browserAssignments.delete(session.ws);
      console.log(`🗑️ Removed session ${sessionId}`);
      this.emit('sessionRemoved', session);
    }
  }

  cleanupInactiveSessions() {
    const now = Date.now();
    for (const [sessionId, lastActivity] of this.sessionActivity) {
      if (now - lastActivity > CONFIG.SESSION_TIMEOUT) {
        console.log(`⏰ Session ${sessionId} timed out`);
        this.removeSession(sessionId);
      }
    }
  }

  getActiveSessions() {
    return Array.from(this.sessions.values());
  }

  getSessionCount() {
    return this.sessions.size;
  }
}

// Browser Worker Pool - manages browser worker threads
class BrowserWorkerPool extends EventEmitter {
  constructor() {
    super();
    this.workers = [];
    this.workerStates = new Map();
    this.browserAssignments = new Map(); // browserId -> workerId
    this.requestQueue = [];
    this.nextWorkerId = 0;
    this.workerRestartCooldowns = new Map(); // workerId -> lastRestartTime
    this.workerRestartCounts = new Map(); // workerId -> restart count
    
    this.initializeWorkers();
  }

  async initializeWorkers() {
    console.log(`🔧 Initializing ${CONFIG.BROWSER_WORKERS} browser workers...`);
    console.log(`Current working directory: ${process.cwd()}`);
    console.log(`__dirname: ${__dirname}`);
    
    for (let i = 0; i < CONFIG.BROWSER_WORKERS; i++) {
      try {
        await this.createWorker(i);
      } catch (error) {
        console.error(`Failed to create worker ${i}:`, error);
      }
    }
    
    // Wait a bit for workers to send their first stats
    console.log('⏳ Waiting for workers to become ready...');
    await new Promise(resolve => setTimeout(resolve, 5000));  // Increased timeout for Railway
    
    // Check if any workers were created
    const readyWorkers = Array.from(this.workerStates.values()).filter(w => w.status === 'ready').length;
    console.log(`✅ Browser worker pool initialized with ${readyWorkers} ready workers`);
    
    if (readyWorkers === 0) {
      console.error('⚠️ WARNING: No workers are ready! Connections will fail.');
    }
  }

  async createWorker(workerId) {
    // Try multiple paths for Docker compatibility
    const possiblePaths = [
      path.join(process.cwd(), 'workers', 'browser-worker.js'),
      path.join(__dirname, 'workers', 'browser-worker.js'),
      './workers/browser-worker.js',
      path.resolve('workers/browser-worker.js')
    ];
    
    let workerPath = null;
    
    for (const testPath of possiblePaths) {
      if (fsSync.existsSync(testPath)) {
        workerPath = testPath;
        console.log(`Found worker at: ${workerPath}`);
        break;
      }
    }
    
    if (!workerPath) {
      throw new Error(`Worker file not found. Tried paths: ${possiblePaths.join(', ')}`);
    }
    
    console.log(`Creating worker ${workerId} from path: ${workerPath}`);
    
    const worker = new Worker(workerPath, {
      workerData: {
        workerId,
        maxBrowsers: CONFIG.BROWSERS_PER_WORKER,
        headless: true
      },
      // Give workers more heap space (3GB each for 32GB RAM system)
      resourceLimits: {
        maxOldGenerationSizeMb: 3072,  // Increased from 1GB to 3GB
        maxYoungGenerationSizeMb: 512  // Increased from 256MB to 512MB
      }
    });

    // Add error handler immediately
    worker.on('error', (err) => {
      console.error(`❌ Worker ${workerId} error during creation:`, err);
      console.error(`Error stack:`, err.stack);
      this.handleWorkerError(workerId, err);
    });
    
    worker.on('exit', (code) => {
      console.log(`Worker ${workerId} exited during creation with code ${code}`);
      this.handleWorkerExit(workerId, code);
    });
    
    worker.on('message', (msg) => {
      console.log(`Worker ${workerId} message:`, msg.type || msg);
      this.handleWorkerMessage(workerId, msg);
    });

    this.workers[workerId] = worker;
    this.workerStates.set(workerId, {
      id: workerId,
      status: 'initializing',
      browsers: new Set(),
      load: 0,
      lastHealthCheck: Date.now()
    });

    // Initialize the worker with better error handling
    try {
      console.log(`Waiting for worker ${workerId} to start...`);
      
      // Give worker time to start up and check if it's still alive
      await new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (!this.workers[workerId]) {
            clearInterval(checkInterval);
            reject(new Error(`Worker ${workerId} died during startup`));
          }
        }, 100);
        
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 2000);
      });
      
      // Check if worker is still there
      if (!this.workers[workerId]) {
        throw new Error(`Worker ${workerId} failed to start`);
      }
      
      // Mark as ready
      this.workerStates.get(workerId).status = 'ready';
      console.log(`✅ Worker ${workerId} marked as ready`);
      
      // Send init command
      worker.postMessage({ cmd: 'init', messageId: 'init_' + workerId });
      
    } catch (error) {
      console.error(`❌ Failed to initialize worker ${workerId}:`, error);
      this.workerStates.get(workerId).status = 'error';
      throw error;
    }
  }

  handleWorkerMessage(workerId, msg) {
    switch (msg.type) {
      case 'browserCreated':
        this.browserAssignments.set(msg.browserId, workerId);
        this.workerStates.get(workerId).browsers.add(msg.browserId);
        console.log(`🌐 Browser ${msg.browserId} created on worker ${workerId}`);
        break;
        
      case 'browserClosed':
        this.browserAssignments.delete(msg.browserId);
        this.workerStates.get(workerId).browsers.delete(msg.browserId);
        console.log(`🔒 Browser ${msg.browserId} closed on worker ${workerId}`);
        break;
        
      case 'workerStats':
        const state = this.workerStates.get(workerId);
        if (state) {
          state.load = msg.stats?.load || msg.load || 0;
          state.lastHealthCheck = Date.now();
          state.memory = msg.stats?.memory;
          // Mark worker as ready if it's sending stats
          if (state.status !== 'ready') {
            state.status = 'ready';
            console.log(`✅ Worker ${workerId} is now ready (via stats)`);
          }
        }
        break;
        
      case 'browserRecovered':
        console.log(`✅ Browser ${msg.browserId} recovered on worker ${workerId}`);
        break;
        
      case 'response':
        // Forward response to appropriate session
        this.emit('workerResponse', msg);
        break;
        
      case 'error':
        console.error(`Worker ${workerId} error:`, msg.error);
        this.emit('workerError', { workerId, error: msg.error });
        break;
    }
  }

  handleWorkerError(workerId, error) {
    console.error(`❌ Worker ${workerId} error:`, error);
    this.restartWorker(workerId);
  }

  handleWorkerExit(workerId, code) {
    console.log(`Worker ${workerId} exited with code ${code}`);
    if (code !== 0) {
      this.restartWorker(workerId);
    }
  }

  async restartWorker(workerId) {
    // ChatGPT optimization: Safer worker restarts with cooldown
    const now = Date.now();
    const lastRestart = this.workerRestartCooldowns.get(workerId) || 0;
    const restartCount = this.workerRestartCounts.get(workerId) || 0;
    
    // Exponential backoff for repeated restarts
    const cooldownMs = Math.min(CONFIG.WORKER_RESTART_DELAY * Math.pow(2, restartCount), 30000);
    
    if (now - lastRestart < cooldownMs) {
      console.log(`⚠️ Worker ${workerId} restart cooldown active (${cooldownMs}ms), skipping...`);
      return;
    }
    
    console.log(`🔄 Restarting worker ${workerId} (attempt ${restartCount + 1})...`);
    
    // Update restart tracking
    this.workerRestartCooldowns.set(workerId, now);
    this.workerRestartCounts.set(workerId, restartCount + 1);
    
    // Clean up old worker
    const oldWorker = this.workers[workerId];
    if (oldWorker) {
      oldWorker.terminate();
    }
    
    // Remove browser assignments for this worker
    for (const [browserId, wId] of this.browserAssignments) {
      if (wId === workerId) {
        this.browserAssignments.delete(browserId);
      }
    }
    
    // Wait with exponential backoff
    await new Promise(resolve => setTimeout(resolve, cooldownMs));
    
    try {
      // Create new worker
      await this.createWorker(workerId);
      
      // Reset restart count on successful restart
      this.workerRestartCounts.set(workerId, 0);
      console.log(`✅ Worker ${workerId} restarted successfully`);
    } catch (error) {
      console.error(`❌ Failed to restart worker ${workerId}:`, error);
      
      // If too many failures, mark worker as permanently failed
      if (restartCount >= 5) {
        console.error(`🚫 Worker ${workerId} failed too many times, marking as dead`);
        this.workerStates.set(workerId, { status: 'dead' });
      }
    }
  }

  async sendToWorker(workerId, message) {
    return new Promise((resolve, reject) => {
      const worker = this.workers[workerId];
      if (!worker) {
        reject(new Error(`Worker ${workerId} not found`));
        return;
      }
      
      const messageId = `msg_${Date.now()}_${Math.random()}`;
      message.messageId = messageId;
      
      const timeout = setTimeout(() => {
        reject(new Error(`Worker ${workerId} timeout`));
      }, 10000);
      
      const handler = (msg) => {
        if (msg.messageId === messageId) {
          clearTimeout(timeout);
          worker.off('message', handler);
          resolve(msg);
        }
      };
      
      worker.on('message', handler);
      worker.postMessage(message);
    });
  }

  async assignBrowser(sessionId) {
    // Find worker with NO browsers first (true isolation)
    let selectedWorker = null;
    
    // First pass: find completely empty worker
    for (const [workerId, state] of this.workerStates) {
      if (state.status === 'ready' && state.browsers.size === 0) {
        selectedWorker = workerId;
        console.log(`📎 Assigning session ${sessionId} to empty worker ${workerId}`);
        break;
      }
    }
    
    // Second pass: find worker with lowest load if no empty workers
    if (selectedWorker === null) {
      let minLoad = Infinity;
      for (const [workerId, state] of this.workerStates) {
        if (state.status === 'ready' && state.load < minLoad) {
          minLoad = state.load;
          selectedWorker = workerId;
        }
      }
    }
    
    if (selectedWorker === null) {
      throw new Error('No available workers');
    }
    
    // Create browser on selected worker
    console.log(`Creating browser on worker ${selectedWorker} for session ${sessionId}`);
    
    try {
      const response = await this.sendToWorker(selectedWorker, {
        cmd: 'createBrowser',
        sessionId
      });
      
      if (!response.browserId) {
        throw new Error('No browserId in response');
      }
      
      // Register the browser immediately
      this.browserAssignments.set(response.browserId, selectedWorker);
      this.workerStates.get(selectedWorker).browsers.add(response.browserId);
      console.log(`✅ Browser ${response.browserId} registered on worker ${selectedWorker}`);
      
      return {
        workerId: selectedWorker,
        browserId: response.browserId
      };
    } catch (error) {
      console.error(`Failed to create browser on worker ${selectedWorker}:`, error);
      throw error;
    }
  }

  async sendCommand(browserId, command) {
    const workerId = this.browserAssignments.get(browserId);
    if (workerId === undefined) {
      throw new Error(`Browser ${browserId} not found`);
    }
    
    try {
      return await this.sendToWorker(workerId, {
        cmd: 'browserCommand',
        browserId,
        command
      });
    } catch (error) {
      // If command fails, browser might have crashed
      console.error(`Command failed for browser ${browserId}:`, error.message);
      
      // Remove the crashed browser from tracking
      this.browserAssignments.delete(browserId);
      const workerState = this.workerStates.get(workerId);
      if (workerState) {
        workerState.browsers.delete(browserId);
      }
      
      throw error;
    }
  }

  async closeBrowser(browserId) {
    const workerId = this.browserAssignments.get(browserId);
    if (workerId !== undefined) {
      await this.sendToWorker(workerId, {
        cmd: 'closeBrowser',
        browserId
      });
    }
  }

  getStats() {
    const stats = {
      workers: [],
      totalBrowsers: 0,
      averageLoad: 0
    };
    
    for (const [workerId, state] of this.workerStates) {
      stats.workers.push({
        id: workerId,
        status: state.status,
        browsers: state.browsers.size,
        load: state.load
      });
      stats.totalBrowsers += state.browsers.size;
      stats.averageLoad += state.load;
    }
    
    stats.averageLoad /= this.workerStates.size || 1;
    return stats;
  }
}

// Screenshot Worker - dedicated thread for screenshot processing
class ScreenshotWorker extends EventEmitter {
  constructor() {
    super();
    this.worker = null;
    this.queue = [];
    this.processing = false;
    this.initializeWorker();
  }

  initializeWorker() {
    const workerPath = path.join(process.cwd(), 'workers', 'screenshot-worker.js');
    console.log(`Creating screenshot worker from path: ${workerPath}`);
    
    this.worker = new Worker(workerPath, {
      workerData: {
        quality: CONFIG.SCREENSHOT_QUALITY
      }
    });

    this.worker.on('message', (msg) => {
      this.emit('screenshot', msg);
      this.processing = false;
      this.processQueue();
    });

    this.worker.on('error', (err) => {
      console.error('Screenshot worker error:', err);
      this.processing = false;
      this.processQueue();
    });

    console.log('📸 Screenshot worker initialized');
  }

  addToQueue(data) {
    this.queue.push(data);
    if (!this.processing) {
      this.processQueue();
    }
  }

  processQueue() {
    if (this.queue.length === 0 || this.processing) {
      return;
    }
    
    this.processing = true;
    const data = this.queue.shift();
    this.worker.postMessage(data);
  }

  getQueueSize() {
    return this.queue.length;
  }
}

// Request Queue - manages and prioritizes incoming requests
class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = new Set();
  }

  add(request) {
    // Priority based on command type
    const priority = this.getPriority(request.command.cmd);
    request.priority = priority;
    request.timestamp = Date.now();
    
    // Insert in priority order
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority < priority) {
        this.queue.splice(i, 0, request);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      this.queue.push(request);
    }
    
    // Limit queue size
    if (this.queue.length > CONFIG.REQUEST_QUEUE_SIZE) {
      this.queue.pop();
    }
  }

  getPriority(cmd) {
    // Higher priority for user interactions in smooth mode
    const priorities = {
      'click': 10,      // Highest - immediate user feedback
      'type': 10,       // Highest - typing should be instant
      'nav': 9,         // Very high
      'scroll': 8,      // High - smooth scrolling
      'goBack': 8,      // High
      'goForward': 8,   // High
      'scanProfile': 6,
      'search': 6,
      'requestScreenshot': 4  // Lower - handled by regular interval
    };
    return priorities[cmd] || 5;
  }

  getNext() {
    return this.queue.shift();
  }

  size() {
    return this.queue.length;
  }

  isProcessing(sessionId) {
    return this.processing.has(sessionId);
  }

  setProcessing(sessionId, isProcessing) {
    if (isProcessing) {
      this.processing.add(sessionId);
    } else {
      this.processing.delete(sessionId);
    }
  }
}

// Main server initialization
async function startServer() {
  console.log('🚀 Starting multi-threaded mini-browser server...');
  
  const app = express();
  // OPTIMIZATION #2: Turn off WebSocket compression for images
  const wss = new WebSocketServer({ 
    noServer: true,
    perMessageDeflate: false  // Don't recompress already-compressed JPEG
  });
  
  // Initialize managers
  const sessionManager = new SessionManager();
  const browserPool = new BrowserWorkerPool();
  const screenshotWorker = new ScreenshotWorker();
  const requestQueue = new RequestQueue();
  
  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../client/dist')));
  
  // Lead Scanner API endpoint
  app.post('/api/scan-leads', async (req, res) => {
    const { screenshot } = req.body;
    
    if (!screenshot) {
      return res.status(400).json({ error: 'Screenshot is required' });
    }

    try {
      // Import Anthropic
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      
      // Check if API key exists
      if (!process.env.ANTHROPIC_API_KEY) {
        console.log('Using mock data - no Anthropic API key configured');
        // Return mock data for testing
        return res.json({
          leads: [
            { name: 'Evan Rama', title: 'Founder & CEO', company: 'Austin, Texas, United States' },
            { name: 'Alexander Janssendéez', title: 'Summer Analyst', company: 'Philadelphia, Pennsylvania, United States' },
            { name: 'Aishwarya Sridhar', title: 'Software Development Intern', company: 'Georgia, United States' }
          ]
        });
      }

      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      });

      // Process the screenshot - handle both data URL and raw base64
      console.log('Received screenshot type:', typeof screenshot);
      console.log('Screenshot starts with:', screenshot.substring(0, 50));
      console.log('Screenshot length:', screenshot.length);
      
      let base64Data;
      if (screenshot.startsWith('data:')) {
        // It's a data URL, extract the base64 part
        const matches = screenshot.match(/^data:image\/[a-z]+;base64,(.+)$/);
        if (!matches || !matches[1]) {
          console.error('Failed to match data URL pattern');
          throw new Error('Invalid screenshot data URL format');
        }
        base64Data = matches[1];
      } else if (screenshot.startsWith('/9j/') || screenshot.startsWith('iVBOR')) {
        // Already base64 (JPEG starts with /9j/, PNG with iVBOR)
        base64Data = screenshot;
      } else {
        // Unknown format
        console.error('Unknown screenshot format, first 100 chars:', screenshot.substring(0, 100));
        throw new Error('Screenshot is not in a recognized format');
      }

      // Validate base64
      if (!base64Data || base64Data.length < 100) {
        console.error('Base64 data too short:', base64Data ? base64Data.length : 'null');
        throw new Error('Screenshot data is too short or invalid');
      }

      console.log(`Processing screenshot: ${base64Data.length} chars of base64 data`);

      // Send screenshot to Claude for analysis
      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Data
              }
            },
            {
              type: 'text',
              text: `Look at this LinkedIn Sales Navigator screenshot. Extract information for ALL visible leads/people shown in the list.

For each person/lead visible, extract:
- name: Their full name
- title: Their job title/position
- company: Their company name (may be shown as part of location or separately)
- location: City, State/Country if shown
- dateAdded: The date added if visible (like "8/20/2025")

Important: 
- Look for the table/list of people with profile pictures
- Each row is a different lead
- Extract ALL visible leads, not just the first one

Return ONLY a valid JSON array. Example format:
[{"name": "Evan Rama", "title": "Founder & CEO", "company": "Company Name", "location": "Austin, Texas", "dateAdded": "8/20/2025"}]

If you cannot see any leads, return: []`
            }
          ]
        }]
      });

      // Parse Claude's response
      const content = response.content[0].type === 'text' ? response.content[0].text : '';
      
      // Extract JSON from the response
      let leads = [];
      try {
        // Try to find JSON array in the response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          leads = JSON.parse(jsonMatch[0]);
          console.log(`Successfully extracted ${leads.length} leads from Sales Navigator`);
        } else {
          console.log('No JSON array found in Claude response:', content);
        }
      } catch (parseError) {
        console.error('Failed to parse Claude response:', parseError);
        console.log('Claude response:', content);
      }

      res.json({ leads, debug: { responseLength: content.length } });
      
    } catch (error) {
      console.error('Error scanning leads:', error);
      res.status(500).json({ 
        error: 'Failed to scan leads',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Health check with detailed stats and resource guardrails
  app.get('/api/health', (_req, res) => {
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    const workerStats = browserPool.getStats();
    
    // ChatGPT optimization: Resource guardrails
    const healthSignals = {
      memory: heapUsedPercent < 80 ? 'healthy' : heapUsedPercent < 90 ? 'warning' : 'critical',
      workers: workerStats.workers.filter(w => w.status === 'ready').length > 0 ? 'healthy' : 'critical',
      sessions: sessionManager.getSessionCount() < CONFIG.MAX_CONCURRENT_USERS ? 'healthy' : 'at_capacity',
      requestQueue: requestQueue.size() < CONFIG.REQUEST_QUEUE_SIZE * 0.8 ? 'healthy' : 'congested'
    };
    
    // Determine overall health
    const criticalCount = Object.values(healthSignals).filter(s => s === 'critical').length;
    const overallHealth = criticalCount > 0 ? 'unhealthy' : 
                          Object.values(healthSignals).some(s => s === 'warning') ? 'degraded' : 'healthy';
    
    const stats = {
      status: overallHealth,
      timestamp: new Date().toISOString(),
      server: {
        uptime: process.uptime(),
        memory: {
          ...memUsage,
          heapUsedPercent: heapUsedPercent.toFixed(2)
        },
        cpu: process.cpuUsage()
      },
      sessions: {
        active: sessionManager.getSessionCount(),
        max: CONFIG.MAX_CONCURRENT_USERS,
        health: healthSignals.sessions
      },
      workers: {
        ...workerStats,
        health: healthSignals.workers
      },
      queues: {
        requests: requestQueue.size(),
        screenshots: screenshotWorker.getQueueSize(),
        health: healthSignals.requestQueue
      },
      healthSignals,
      recommendation: criticalCount > 0 ? 'System under stress - consider reducing load' : 
                      overallHealth === 'degraded' ? 'Monitor system closely' : 'System operating normally'
    };
    
    res.status(overallHealth === 'unhealthy' ? 503 : 200).json(stats);
  });
  
  // ChatGPT optimization: Single global request queue pump
  let globalPumpRunning = false;
  async function globalRequestQueuePump() {
    if (globalPumpRunning) return;
    globalPumpRunning = true;
    
    while (requestQueue.size() > 0) {
      const request = requestQueue.getNext();
      if (!request) break;
      
      const session = sessionManager.getSession(request.sessionId);
      if (!session) continue;
      
      // Check if session is already processing
      if (requestQueue.isProcessing(request.sessionId)) {
        // Re-queue the request
        requestQueue.add(request);
        await new Promise(resolve => setTimeout(resolve, 20));
        continue;
      }
      
      requestQueue.setProcessing(request.sessionId, true);
      
      // Process request asynchronously without blocking pump
      (async () => {
        try {
          // Check if browser exists, recreate if needed
          if (!session.browserId || !browserPool.browserAssignments.has(session.browserId)) {
            console.log(`Browser missing for session ${session.id}, creating new one...`);
            try {
              const { browserId } = await browserPool.assignBrowser(session.id);
              session.browserId = browserId;
              console.log(`New browser ${browserId} assigned to session ${session.id}`);
            } catch (assignError) {
              console.error(`Failed to recreate browser:`, assignError);
              throw assignError;
            }
          }
          
          // Send command to browser worker
          const response = await browserPool.sendCommand(
            session.browserId,
            request.command
          );
          
          // Handle screenshot responses - always send
          if (response.screenshot && response.compressed) {
            if (session.ws.readyState === session.ws.OPEN) {
              // Direct send - already compressed by browser worker
              session.ws.send(response.screenshot, { binary: true, compress: false });
              session.stats.screenshots++;
            }
          }
          
          // Send loading states immediately for navigation
          if (response.loading !== undefined || response.message) {
            if (session.ws.readyState === session.ws.OPEN) {
              session.ws.send(JSON.stringify({
                type: 'navigation',
                loading: response.loading,
                message: response.message,
                url: response.url
              }));
            }
          }
          
          // Send response to client
          if (request.callback) {
            await request.callback(response);
          }
        } catch (error) {
          console.error('Command execution error:', error);
          session.stats.errors++;
          
          // If browser not found, mark session for browser recreation
          if (error.message.includes('Browser') && error.message.includes('not found')) {
            console.log(`Browser crashed for session ${session.id}, will recreate on next command`);
            session.browserId = null;
          }
          
          if (request.callback) {
            await request.callback({
              type: 'error',
              message: error.message,
              recoverable: error.message.includes('not found')
            });
          }
        } finally {
          requestQueue.setProcessing(request.sessionId, false);
        }
      })();
      
      // Small delay between processing to prevent CPU saturation
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    
    globalPumpRunning = false;
  }
  
  // ChatGPT optimization: Single global screenshot timer
  const screenshotSessions = new Map(); // sessionId -> interval data
  
  async function globalScreenshotPump() {
    for (const session of sessionManager.getActiveSessions()) {
      if (!session.browserId || !session.ws || session.ws.readyState !== session.ws.OPEN) {
        continue;
      }
      
      // Get or create session screenshot data
      let ssData = screenshotSessions.get(session.id);
      if (!ssData) {
        ssData = {
          lastShot: 0,
          inProgress: false,
          frameInterval: 1000 / session.adaptiveFPS.current
        };
        screenshotSessions.set(session.id, ssData);
      }
      
      const now = Date.now();
      
      // Check if session is idle
      const timeSinceActivity = now - session.adaptiveFPS.lastActivity;
      if (timeSinceActivity > session.adaptiveFPS.idleTimeout && !session.adaptiveFPS.isIdle) {
        session.adaptiveFPS.isIdle = true;
        // Drop to minimum FPS when idle
        session.adaptiveFPS.current = session.adaptiveFPS.min;
        console.log(`😴 Session ${session.id} idle - FPS reduced to ${session.adaptiveFPS.current}`);
      }
      
      // Update frame interval based on adaptive FPS
      ssData.frameInterval = 1000 / session.adaptiveFPS.current;
      
      // Skip if not time for next frame or still processing
      if (now - ssData.lastShot < ssData.frameInterval || ssData.inProgress) {
        continue;
      }
      
      // Only adjust FPS based on network backpressure, not memory/load
      const bufferedAmount = session.ws.bufferedAmount || 0;
      
      // Only throttle if network is actually backed up
      if (bufferedAmount > 512 * 1024) {  // 512KB buffer
        const newFPS = Math.max(session.adaptiveFPS.min, session.adaptiveFPS.current - 2);
        if (newFPS !== session.adaptiveFPS.current) {
          session.adaptiveFPS.current = newFPS;
          console.log(`📉 Network backpressure - FPS to ${newFPS} for session ${session.id} (buffer: ${(bufferedAmount/1024).toFixed(0)}KB)`);
        }
        session.adaptiveFPS.lastAdjust = now;
      }
      
      // Increase FPS when network is clear and not idle
      if (bufferedAmount < 128 * 1024 && !session.adaptiveFPS.isIdle) {
        if (now - session.adaptiveFPS.lastAdjust > 3000) {
          const newFPS = Math.min(session.adaptiveFPS.max, session.adaptiveFPS.current + 1);
          if (newFPS !== session.adaptiveFPS.current) {
            session.adaptiveFPS.current = newFPS;
            console.log(`📈 Network clear - FPS to ${newFPS} for session ${session.id}`);
          }
          session.adaptiveFPS.lastAdjust = now;
        }
      }
      
      // Take screenshot asynchronously
      ssData.inProgress = true;
      ssData.lastShot = now;
      
      (async () => {
        try {
          const response = await browserPool.sendCommand(session.browserId, {
            cmd: 'requestScreenshot',
            quality: CONFIG.SCREENSHOT_QUALITY,
            isIdle: session.adaptiveFPS.isIdle
          });
          
          if (response.screenshot && session.ws.readyState === session.ws.OPEN) {
            // Always send screenshots
            session.ws.send(response.screenshot, { binary: true, compress: false });
          } else if (response.skipped && session.ws.readyState === session.ws.OPEN) {
            session.ws.send(JSON.stringify({
              type: 'status',
              loading: true,
              reason: response.reason,
              message: response.reason === 'page_navigating' ? 'Page is loading...' :
                      response.reason === 'page_not_ready' ? 'Waiting for page...' :
                      'Processing...'
            }));
          }
        } catch (error) {
          // Silent fail
        } finally {
          ssData.inProgress = false;
        }
      })();
    }
  }
  
  // Start global screenshot pump - no memory checks, just run it
  setInterval(() => {
    globalScreenshotPump();
  }, 20); // Run at 50Hz to check all sessions
  
  // WebSocket connection handler
  wss.on('connection', async (ws) => {
    console.log('🔌 New WebSocket connection');
    
    // Check concurrent user limit
    if (sessionManager.getSessionCount() >= CONFIG.MAX_CONCURRENT_USERS) {
      console.log('❌ Max users reached, rejecting connection');
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Server at capacity. Please try again later.'
      }));
      ws.close();
      return;
    }
    
    // Create session
    const session = sessionManager.createSession(ws);
    
    try {
      // Assign a browser from the pool
      const { workerId, browserId } = await browserPool.assignBrowser(session.id);
      session.browserId = browserId;
      session.workerId = workerId;
      
      console.log(`✅ Session ${session.id} assigned browser ${browserId} on worker ${workerId}`);
      
      // Send initial status
      ws.send(JSON.stringify({
        type: 'connected',
        sessionId: session.id,
        browserId: browserId
      }));
      
    } catch (error) {
      console.error('Failed to assign browser:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to create browser session'
      }));
      ws.close();
      return;
    }
    
    // Handle incoming messages
    ws.on('message', async (msg) => {
      try {
        const message = JSON.parse(msg.toString());
        const session = sessionManager.getSession(ws.sessionId);
        
        if (!session) {
          console.error('Session not found');
          return;
        }
        
        session.stats.commands++;
        
        // Mark session as active (boost FPS)
        if (message.cmd === 'click' || message.cmd === 'type' || message.cmd === 'scroll' || message.cmd === 'nav') {
          session.adaptiveFPS.lastActivity = Date.now();
          if (session.adaptiveFPS.isIdle) {
            session.adaptiveFPS.isIdle = false;
            // Boost FPS back to normal when user interacts
            session.adaptiveFPS.current = Math.min(session.adaptiveFPS.max, 10);
            console.log(`🚀 Session ${session.id} active - FPS boosted to ${session.adaptiveFPS.current}`);
          }
        }
        
        // Add to request queue
        requestQueue.add({
          sessionId: session.id,
          command: message,
          callback: async (response) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify(response));
            }
          }
        });
        
        // Trigger global pump
        globalRequestQueuePump();
        
      } catch (error) {
        console.error('Message handling error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message
        }));
      }
    });
    
    // Clean up screenshot session data on disconnect
    
    // Cleanup on disconnect
    ws.on('close', async () => {
      console.log(`🔌 WebSocket disconnected for session ${ws.sessionId}`);
      
      // Clean up screenshot session data
      screenshotSessions.delete(ws.sessionId);
      
      const session = sessionManager.getSession(ws.sessionId);
      if (session && session.browserId) {
        await browserPool.closeBrowser(session.browserId);
      }
      
      sessionManager.removeSession(ws.sessionId);
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      screenshotSessions.delete(ws.sessionId);
    });
  });
  
  // Session cleanup listener
  sessionManager.on('sessionRemoved', async (session) => {
    if (session.browserId) {
      await browserPool.closeBrowser(session.browserId);
    }
  });
  
  // Serve React app
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
  
  // Start server
  const port = process.env.PORT || 3001;
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Multi-threaded server running on port ${port}`);
    console.log(`📊 Max concurrent users: ${CONFIG.MAX_CONCURRENT_USERS}`);
    console.log(`🔧 Browser workers: ${CONFIG.BROWSER_WORKERS}`);
    console.log(`🌐 Browsers per worker: ${CONFIG.BROWSERS_PER_WORKER}`);
    console.log(`📸 Target FPS: ${CONFIG.TARGET_FPS}`);
  });
  
  // Handle WebSocket upgrade
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('📛 SIGTERM received, shutting down gracefully...');
    
    // Close all sessions
    for (const session of sessionManager.getActiveSessions()) {
      if (session.browserId) {
        await browserPool.closeBrowser(session.browserId);
      }
    }
    
    server.close(() => {
      console.log('HTTP server closed');
    });
    
    process.exit(0);
  });
}

// Start the server
startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});