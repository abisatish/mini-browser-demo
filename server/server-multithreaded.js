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

// Configuration optimized for Railway (8 vCPUs, 8GB RAM) - 2-3 users SMOOTH performance
const CONFIG = {
  MAX_CONCURRENT_USERS: parseInt(process.env.MAX_USERS) || 3,
  BROWSER_WORKERS: parseInt(process.env.BROWSER_WORKERS) || 2, // 2 workers optimal for 3 users
  BROWSERS_PER_WORKER: parseInt(process.env.BROWSERS_PER_WORKER) || 2, // 2 browsers per worker
  SCREENSHOT_QUALITY: parseInt(process.env.SCREENSHOT_QUALITY) || 80, // Balance quality/performance
  TARGET_FPS: parseInt(process.env.TARGET_FPS) || 15, // 15 FPS smooth on Railway
  REQUEST_QUEUE_SIZE: parseInt(process.env.REQUEST_QUEUE_SIZE) || 50,
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
        errors: 0
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
    await new Promise(resolve => setTimeout(resolve, 3000));
    
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
          // Mark worker as ready if it's sending stats
          if (state.status !== 'ready') {
            state.status = 'ready';
            console.log(`✅ Worker ${workerId} is now ready (via stats)`);
          }
        }
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
    console.log(`🔄 Restarting worker ${workerId}...`);
    
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
    
    // Wait before restarting
    await new Promise(resolve => setTimeout(resolve, CONFIG.WORKER_RESTART_DELAY));
    
    // Create new worker
    await this.createWorker(workerId);
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
    // Find worker with lowest load
    let selectedWorker = null;
    let minLoad = Infinity;
    
    for (const [workerId, state] of this.workerStates) {
      if (state.status === 'ready' && state.load < minLoad) {
        minLoad = state.load;
        selectedWorker = workerId;
      }
    }
    
    if (selectedWorker === null) {
      throw new Error('No available workers');
    }
    
    // Create browser on selected worker
    const response = await this.sendToWorker(selectedWorker, {
      cmd: 'createBrowser',
      sessionId
    });
    
    return {
      workerId: selectedWorker,
      browserId: response.browserId
    };
  }

  async sendCommand(browserId, command) {
    const workerId = this.browserAssignments.get(browserId);
    if (workerId === undefined) {
      throw new Error(`Browser ${browserId} not found`);
    }
    
    return await this.sendToWorker(workerId, {
      cmd: 'browserCommand',
      browserId,
      command
    });
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
  const wss = new WebSocketServer({ noServer: true });
  
  // Initialize managers
  const sessionManager = new SessionManager();
  const browserPool = new BrowserWorkerPool();
  const screenshotWorker = new ScreenshotWorker();
  const requestQueue = new RequestQueue();
  
  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../client/dist')));
  
  // Health check with detailed stats
  app.get('/api/health', (req, res) => {
    const stats = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      },
      sessions: {
        active: sessionManager.getSessionCount(),
        max: CONFIG.MAX_CONCURRENT_USERS
      },
      workers: browserPool.getStats(),
      queues: {
        requests: requestQueue.size(),
        screenshots: screenshotWorker.getQueueSize()
      }
    };
    
    res.json(stats);
  });
  
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
        
        // Process queue
        processRequestQueue();
        
      } catch (error) {
        console.error('Message handling error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message
        }));
      }
    });
    
    // Process request queue
    async function processRequestQueue() {
      while (requestQueue.size() > 0) {
        const request = requestQueue.getNext();
        if (!request) break;
        
        const session = sessionManager.getSession(request.sessionId);
        if (!session) continue;
        
        // Check if session is already processing
        if (requestQueue.isProcessing(request.sessionId)) {
          // Re-queue the request
          requestQueue.add(request);
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }
        
        requestQueue.setProcessing(request.sessionId, true);
        
        try {
          // Send command to browser worker
          const response = await browserPool.sendCommand(
            session.browserId,
            request.command
          );
          
          // Handle screenshot responses with priority mode
          if (response.screenshot) {
            if (CONFIG.SCREENSHOT_COMPRESSION) {
              // Use worker for compression
              screenshotWorker.addToQueue({
                sessionId: session.id,
                screenshot: response.screenshot,
                timestamp: Date.now(),
                skipCompression: false
              });
            } else {
              // Direct send for minimal latency (2-3 users mode)
              if (session.ws.readyState === ws.OPEN) {
                session.ws.send(response.screenshot, { binary: true });
              }
            }
            session.stats.screenshots++;
          }
          
          // Send response to client
          if (request.callback) {
            await request.callback(response);
          }
          
        } catch (error) {
          console.error('Command execution error:', error);
          session.stats.errors++;
          if (request.callback) {
            await request.callback({
              type: 'error',
              message: error.message
            });
          }
        } finally {
          requestQueue.setProcessing(request.sessionId, false);
        }
      }
    }
    
    // Screenshot worker listener
    screenshotWorker.on('screenshot', (data) => {
      const session = sessionManager.getSession(data.sessionId);
      if (session && session.ws.readyState === ws.OPEN) {
        session.ws.send(data.processed, { binary: true });
      }
    });
    
    // Regular screenshot updates for smooth experience
    const screenshotInterval = setInterval(async () => {
      if (ws.readyState !== ws.OPEN) {
        clearInterval(screenshotInterval);
        return;
      }
      
      const session = sessionManager.getSession(ws.sessionId);
      if (session && session.browserId) {
        try {
          const response = await browserPool.sendCommand(session.browserId, {
            cmd: 'requestScreenshot'
          });
          
          if (response.screenshot && ws.readyState === ws.OPEN) {
            ws.send(response.screenshot, { binary: true });
          }
        } catch (error) {
          // Silent fail for screenshot updates
        }
      }
    }, 1000 / CONFIG.TARGET_FPS);
    
    // Cleanup on disconnect
    ws.on('close', async () => {
      console.log(`🔌 WebSocket disconnected for session ${ws.sessionId}`);
      clearInterval(screenshotInterval);
      
      const session = sessionManager.getSession(ws.sessionId);
      if (session && session.browserId) {
        await browserPool.closeBrowser(session.browserId);
      }
      
      sessionManager.removeSession(ws.sessionId);
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clearInterval(screenshotInterval);
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