import { parentPort, workerData } from 'worker_threads';
import sharp from 'sharp';

// Worker configuration
const { quality } = workerData;

console.log(`[Screenshot Worker] Starting with quality ${quality}...`);

// Performance tracking
let processedCount = 0;
let totalProcessingTime = 0;

// Message handler for screenshot processing
parentPort.on('message', async (data) => {
  const startTime = Date.now();
  
  try {
    const { sessionId, screenshot, timestamp, skipCompression } = data;
    
    // For 2-3 users, skip compression for lower latency
    let processed;
    if (skipCompression) {
      // Direct passthrough for minimal latency
      processed = screenshot;
    } else {
      // Light optimization only
      processed = await sharp(screenshot)
        .jpeg({
          quality: quality || 85,
          progressive: false,  // Faster without progressive
          mozjpeg: false  // Skip advanced compression
        })
        .toBuffer();
    }
    
    const processingTime = Date.now() - startTime;
    processedCount++;
    totalProcessingTime += processingTime;
    
    // Log stats occasionally
    if (processedCount % 100 === 0) {
      console.log(`[Screenshot Worker] Processed ${processedCount} screenshots, avg time: ${(totalProcessingTime / processedCount).toFixed(2)}ms`);
    }
    
    // Send processed screenshot back
    parentPort.postMessage({
      sessionId,
      processed,
      timestamp,
      processingTime,
      originalSize: screenshot.length,
      processedSize: processed.length,
      compressionRatio: ((1 - processed.length / screenshot.length) * 100).toFixed(1)
    });
    
  } catch (error) {
    console.error('[Screenshot Worker] Processing error:', error);
    parentPort.postMessage({
      error: error.message,
      sessionId: data.sessionId
    });
  }
});

// Cleanup
process.on('exit', () => {
  console.log(`[Screenshot Worker] Shutting down. Processed ${processedCount} screenshots`);
});

console.log('[Screenshot Worker] Ready');