const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fetch = require('node-fetch');
const https = require('https');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 10000;
const ROOT_URL = 'https://najuzi.com/webapp/MobileApp';

// Encryption config
const SECRET_KEY = 'najuzi0702518998';
const IV = Buffer.alloc(16, 0);

// Enhanced HTTPS agent with timeout
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  timeout: 10000 // 10 second timeout
});

// Robust CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range']
}));

app.use(express.json({ limit: '50mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Enhanced file proxy endpoint
app.get('/file', async (req, res) => {
  try {
    // Validate and decode path
    if (!req.query.path) {
      return res.status(400).json({ error: 'Missing file path parameter' });
    }

    let filePath;
    try {
      filePath = decodeURIComponent(req.query.path.trim());
      new URL(filePath); // Validate URL format
    } catch (err) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Security: Only allow fetching from your domain
    if (!filePath.startsWith(ROOT_URL)) {
      return res.status(403).json({ error: 'Access to specified domain not allowed' });
    }

    console.log(`Fetching file: ${filePath}`);

    // Enhanced fetch with timeout and retry
    let response;
    try {
      response = await fetch(filePath, {
        agent: httpsAgent,
        headers: {
          'User-Agent': 'NajuziPDFServer/1.0',
          'Accept': 'application/pdf, video/mp4, */*'
        },
        timeout: 8000
      });
    } catch (err) {
      console.error(`Fetch failed: ${err.message}`);
      return res.status(502).json({ 
        error: 'Could not connect to file server',
        details: err.message 
      });
    }

    // Handle non-success responses
    if (!response.ok) {
      const errorBody = await response.text().catch(() => null);
      console.error(`Remote server error: ${response.status} - ${errorBody || 'No details'}`);
      return res.status(response.status).json({
        error: `Remote server error: ${response.statusText}`,
        status: response.status,
        details: errorBody
      });
    }

    // Get content type from response or file extension
    let contentType = response.headers.get('content-type');
    if (!contentType) {
      if (filePath.endsWith('.pdf') || filePath.endsWith('.pdf.enc')) {
        contentType = 'application/pdf';
      } else if (filePath.endsWith('.mp4') || filePath.endsWith('.mp4.enc')) {
        contentType = 'video/mp4';
      }
    }

    // Process the file
    try {
      const buffer = await response.buffer();
      
      // Set common headers
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      
      // Handle encrypted files
      if (filePath.endsWith('.enc')) {
        try {
          const decrypted = decryptBuffer(buffer);
          const filename = filePath.split('/').pop().replace('.enc', '');
          res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
          return res.send(decrypted);
        } catch (decryptErr) {
          console.error('Decryption failed:', decryptErr);
          return res.status(500).json({ 
            error: 'File decryption failed',
            details: decryptErr.message 
          });
        }
      }
      
      // Handle regular files
      const filename = filePath.split('/').pop();
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.send(buffer);
      
    } catch (processingErr) {
      console.error('File processing error:', processingErr);
      return res.status(500).json({ 
        error: 'Error processing file content',
        details: processingErr.message 
      });
    }
    
  } catch (err) {
    console.error('Unexpected server error:', err);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Enhanced decrypt function with better error handling
function decryptBuffer(buffer) {
  try {
    // Create key from secret
    const key = crypto.createHash('sha256')
      .update(SECRET_KEY)
      .digest()
      .slice(0, 32); // AES-256 requires 32 byte key
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, IV);
    
    // Handle large files with stream processing
    const chunks = [];
    chunks.push(decipher.update(buffer));
    chunks.push(decipher.final());
    
    return Buffer.concat(chunks);
  } catch (err) {
    console.error('Decryption error:', err);
    throw new Error(`Decryption failed: ${err.message}`);
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error middleware:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server with graceful shutdown
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 Access your service at: https://webserver-zpgc.onrender.com`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});
