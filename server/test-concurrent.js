import WebSocket from 'ws';
import { performance } from 'perf_hooks';

// Test configuration
const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3001';
const NUM_USERS = parseInt(process.env.TEST_USERS) || 5;
const TEST_DURATION = parseInt(process.env.TEST_DURATION) || 30000; // 30 seconds

console.log('🧪 Concurrent User Test');
console.log(`📍 Server: ${SERVER_URL}`);
console.log(`👥 Users: ${NUM_USERS}`);
console.log(`⏱️  Duration: ${TEST_DURATION}ms`);
console.log('');

// Test results
const results = {
  connections: { success: 0, failed: 0 },
  commands: { sent: 0, acknowledged: 0 },
  screenshots: { received: 0, totalBytes: 0 },
  errors: [],
  latencies: [],
  startTime: performance.now()
};

// Simulate a user session
async function simulateUser(userId) {
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER_URL);
    const userStats = {
      id: userId,
      connected: false,
      commands: 0,
      screenshots: 0,
      errors: 0,
      startTime: performance.now()
    };
    
    ws.on('open', () => {
      console.log(`✅ User ${userId} connected`);
      userStats.connected = true;
      results.connections.success++;
      
      // Send initial navigation
      ws.send(JSON.stringify({
        cmd: 'nav',
        url: 'https://www.google.com'
      }));
      results.commands.sent++;
      userStats.commands++;
      
      // Simulate user actions
      const actions = [
        () => {
          ws.send(JSON.stringify({
            cmd: 'type',
            text: `test user ${userId}`
          }));
          results.commands.sent++;
          userStats.commands++;
        },
        () => {
          ws.send(JSON.stringify({
            cmd: 'click',
            x: Math.random() * 1280,
            y: Math.random() * 720
          }));
          results.commands.sent++;
          userStats.commands++;
        },
        () => {
          ws.send(JSON.stringify({
            cmd: 'scroll',
            dy: Math.random() * 200 - 100
          }));
          results.commands.sent++;
          userStats.commands++;
        },
        () => {
          ws.send(JSON.stringify({
            cmd: 'requestScreenshot'
          }));
          results.commands.sent++;
          userStats.commands++;
        }
      ];
      
      // Random actions every 2-5 seconds
      const actionInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const action = actions[Math.floor(Math.random() * actions.length)];
          const commandStart = performance.now();
          action();
          
          // Measure latency for next response
          const responseHandler = (data) => {
            if (!Buffer.isBuffer(data)) {
              const latency = performance.now() - commandStart;
              results.latencies.push(latency);
              ws.off('message', responseHandler);
            }
          };
          ws.once('message', responseHandler);
        }
      }, 2000 + Math.random() * 3000);
      
      // Stop after test duration
      setTimeout(() => {
        clearInterval(actionInterval);
        ws.close();
      }, TEST_DURATION);
    });
    
    ws.on('message', (data) => {
      if (Buffer.isBuffer(data)) {
        // Screenshot received
        results.screenshots.received++;
        results.screenshots.totalBytes += data.length;
        userStats.screenshots++;
      } else {
        // Command response
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'response' || msg.type === 'connected') {
            results.commands.acknowledged++;
          } else if (msg.type === 'error') {
            results.errors.push(`User ${userId}: ${msg.message}`);
            userStats.errors++;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    });
    
    ws.on('error', (error) => {
      console.error(`❌ User ${userId} error:`, error.message);
      results.connections.failed++;
      userStats.errors++;
      results.errors.push(`User ${userId}: ${error.message}`);
    });
    
    ws.on('close', () => {
      const duration = performance.now() - userStats.startTime;
      console.log(`👋 User ${userId} disconnected after ${(duration/1000).toFixed(1)}s`);
      console.log(`   Commands: ${userStats.commands}, Screenshots: ${userStats.screenshots}, Errors: ${userStats.errors}`);
      resolve(userStats);
    });
  });
}

// Run the test
async function runTest() {
  console.log('\n🚀 Starting test...\n');
  
  // Create all users with slight delay
  const userPromises = [];
  for (let i = 0; i < NUM_USERS; i++) {
    userPromises.push(simulateUser(i + 1));
    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms between connections
  }
  
  // Wait for all users to complete
  const userResults = await Promise.all(userPromises);
  
  // Calculate statistics
  const testDuration = performance.now() - results.startTime;
  const avgLatency = results.latencies.length > 0 
    ? results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length 
    : 0;
  const p95Latency = results.latencies.length > 0
    ? results.latencies.sort((a, b) => a - b)[Math.floor(results.latencies.length * 0.95)]
    : 0;
  
  // Print results
  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST RESULTS');
  console.log('='.repeat(50));
  
  console.log('\n🔌 Connections:');
  console.log(`   ✅ Successful: ${results.connections.success}/${NUM_USERS}`);
  console.log(`   ❌ Failed: ${results.connections.failed}`);
  
  console.log('\n📨 Commands:');
  console.log(`   Sent: ${results.commands.sent}`);
  console.log(`   Acknowledged: ${results.commands.acknowledged}`);
  console.log(`   Success Rate: ${((results.commands.acknowledged/results.commands.sent)*100).toFixed(1)}%`);
  
  console.log('\n📸 Screenshots:');
  console.log(`   Received: ${results.screenshots.received}`);
  console.log(`   Total Data: ${(results.screenshots.totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Avg Size: ${(results.screenshots.totalBytes / results.screenshots.received / 1024).toFixed(1)} KB`);
  
  console.log('\n⚡ Performance:');
  console.log(`   Test Duration: ${(testDuration/1000).toFixed(1)}s`);
  console.log(`   Avg Latency: ${avgLatency.toFixed(1)}ms`);
  console.log(`   P95 Latency: ${p95Latency.toFixed(1)}ms`);
  console.log(`   Screenshots/sec: ${(results.screenshots.received/(testDuration/1000)).toFixed(1)}`);
  
  if (results.errors.length > 0) {
    console.log('\n⚠️  Errors:');
    results.errors.slice(0, 5).forEach(error => {
      console.log(`   - ${error}`);
    });
    if (results.errors.length > 5) {
      console.log(`   ... and ${results.errors.length - 5} more`);
    }
  }
  
  console.log('\n' + '='.repeat(50));
  
  // Overall verdict
  const successRate = (results.connections.success / NUM_USERS) * 100;
  if (successRate === 100 && results.errors.length === 0) {
    console.log('✅ TEST PASSED - All users handled successfully!');
  } else if (successRate >= 80) {
    console.log('⚠️  TEST PASSED WITH WARNINGS - Most users handled successfully');
  } else {
    console.log('❌ TEST FAILED - Server struggled with concurrent users');
  }
  
  console.log('='.repeat(50));
  
  process.exit(0);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

// Run test
runTest().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});