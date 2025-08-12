import { parentPort, workerData } from 'worker_threads';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

// Initialize AI clients
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
}) : null;

console.log('[AI Worker] Starting...');
console.log('[AI Worker] OpenAI available:', !!openai);
console.log('[AI Worker] Anthropic available:', !!anthropic);

// Performance tracking
let requestsProcessed = 0;
let totalProcessingTime = 0;
let cacheHits = 0;

// Simple cache for recent analyses (LRU-style)
const analysisCache = new Map();
const CACHE_SIZE = 50;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Add to cache with TTL
function addToCache(key, value) {
  // Remove oldest if cache is full
  if (analysisCache.size >= CACHE_SIZE) {
    const firstKey = analysisCache.keys().next().value;
    analysisCache.delete(firstKey);
  }
  
  analysisCache.set(key, {
    value,
    timestamp: Date.now()
  });
}

// Get from cache if valid
function getFromCache(key) {
  const cached = analysisCache.get(key);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    cacheHits++;
    return cached.value;
  }
  analysisCache.delete(key);
  return null;
}

// Process LinkedIn profile analysis
async function analyzeLinkedInProfile(screenshot, prompt) {
  const cacheKey = `profile_${Buffer.from(screenshot).slice(0, 100).toString('base64')}`;
  
  // Check cache first
  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log('[AI Worker] Cache hit for LinkedIn profile');
    return cached;
  }
  
  let result;
  
  // Try Claude first (better for structured extraction)
  if (anthropic) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1000,
        temperature: 0.3,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: prompt || `Extract LinkedIn profile information and return as JSON with fields: name, currentPosition, currentCompany, previousCompanies, education, skills, summary.`
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
      
      result = response.content[0].text;
      
    } catch (error) {
      console.error('[AI Worker] Claude error:', error.message);
      
      // Fallback to OpenAI
      if (openai) {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{
            role: "user",
            content: [
              {
                type: "text",
                text: prompt || `Extract LinkedIn profile information and return as JSON.`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
                  detail: "high"
                }
              }
            ]
          }],
          max_tokens: 1000,
          temperature: 0.3
        });
        
        result = response.choices[0].message.content;
      } else {
        throw error;
      }
    }
  } else if (openai) {
    // Use OpenAI if Claude not available
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: prompt || `Extract LinkedIn profile information and return as JSON.`
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
              detail: "high"
            }
          }
        ]
      }],
      max_tokens: 1000,
      temperature: 0.3
    });
    
    result = response.choices[0].message.content;
  } else {
    throw new Error('No AI client configured');
  }
  
  // Parse JSON from response
  try {
    const jsonMatch = result.match(/```json\n?([\s\S]*?)\n?```/) || [null, result];
    const jsonString = jsonMatch[1] || result;
    const parsed = JSON.parse(jsonString.trim());
    
    // Add to cache
    addToCache(cacheKey, parsed);
    
    return parsed;
  } catch (e) {
    console.error('[AI Worker] Failed to parse AI response:', e);
    throw new Error('Failed to parse AI response');
  }
}

// Process contextualized Q&A
async function processContextualizedQA(linkedInData, subqueries) {
  const prompt = `
    Based on this LinkedIn profile data:
    ${JSON.stringify(linkedInData, null, 2)}
    
    Answer these questions:
    ${subqueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}
    
    Return as JSON array with 'query' and 'answer' fields.
  `;
  
  let result;
  
  // Use cheaper model for Q&A
  if (anthropic) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",  // Cheaper, faster model
        max_tokens: 800,
        temperature: 0.3,
        messages: [{
          role: "user",
          content: prompt
        }]
      });
      
      result = response.content[0].text;
      
    } catch (error) {
      // Fallback to OpenAI
      if (openai) {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",  // Cheaper model
          messages: [{
            role: "user",
            content: prompt
          }],
          temperature: 0.3
        });
        
        result = response.choices[0].message.content;
      } else {
        throw error;
      }
    }
  } else if (openai) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: prompt
      }],
      temperature: 0.3
    });
    
    result = response.choices[0].message.content;
  } else {
    throw new Error('No AI client configured');
  }
  
  // Parse response
  try {
    const jsonMatch = result.match(/```json\n?([\s\S]*?)\n?```/) || [null, result];
    const jsonString = jsonMatch[1] || result;
    return JSON.parse(jsonString.trim());
  } catch (e) {
    console.error('[AI Worker] Failed to parse Q&A response:', e);
    return subqueries.map(q => ({
      query: q,
      answer: 'Failed to generate answer'
    }));
  }
}

// Message handler
parentPort.on('message', async (msg) => {
  const { messageId, task } = msg;
  const startTime = Date.now();
  
  try {
    let result;
    
    switch (task.type) {
      case 'analyzeProfile':
        result = await analyzeLinkedInProfile(
          Buffer.from(task.screenshot, 'base64'),
          task.prompt
        );
        break;
        
      case 'contextualizedQA':
        result = await processContextualizedQA(
          task.linkedInData,
          task.subqueries
        );
        break;
        
      case 'getStats':
        result = {
          requestsProcessed,
          averageProcessingTime: requestsProcessed > 0 ? 
            (totalProcessingTime / requestsProcessed).toFixed(2) : 0,
          cacheHits,
          cacheSize: analysisCache.size
        };
        break;
        
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
    
    const processingTime = Date.now() - startTime;
    requestsProcessed++;
    totalProcessingTime += processingTime;
    
    // Log performance occasionally
    if (requestsProcessed % 10 === 0) {
      console.log(`[AI Worker] Processed ${requestsProcessed} requests, avg time: ${(totalProcessingTime / requestsProcessed).toFixed(2)}ms, cache hits: ${cacheHits}`);
    }
    
    parentPort.postMessage({
      messageId,
      success: true,
      result,
      processingTime
    });
    
  } catch (error) {
    console.error('[AI Worker] Error:', error);
    parentPort.postMessage({
      messageId,
      success: false,
      error: error.message
    });
  }
});

// Cleanup
process.on('exit', () => {
  console.log(`[AI Worker] Shutting down. Processed ${requestsProcessed} requests`);
});

console.log('[AI Worker] Ready');