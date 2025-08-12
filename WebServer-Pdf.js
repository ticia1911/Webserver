const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

// Modern fetch import
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 10000;
const ROOT_URL = 'https://najuzi.com/webapp/MobileApp';

// Enhanced encryption config
const ENCRYPTION_CONFIG = {
  algorithm: 'aes-256-cbc',
  key: crypto.createHash('sha256').update('najuzi0702518998').digest(),
  iv: Buffer.alloc(16, 0),
  authTagLength: 16 // For GCM mode would use 16
};

// Robust HTTPS agent
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  timeout: 15000
});

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'OPTIONS']
}));
app.use(express.json({ limit: '50mb' }));

// Health endpoint
app.get('/ping', (req, res) => res.status(200).send('pong'));

// Enhanced file endpoint
app.get('/file', async (req, res) => {
  try {
    // Validate input
    if (!req.query.path) {
      return res.status(400).json({ error: 'Missing path parameter' });
    }

    let fileUrl;
    try {
      fileUrl = new URL(decodeURIComponent(req.query.path.trim()));
    } catch (err) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Security check
    if (!fileUrl.href.startsWith(ROOT_URL)) {
      return res.status(403).json({ error: 'Access to this domain not allowed' });
    }

    console.log(`Processing file: ${fileUrl.href}`);

    // Fetch file with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let response;
    try {
      response = await fetch(fileUrl.href, {
        agent: httpsAgent,
        signal: controller.signal,
        headers: { 'User-Agent': 'NajuziResourceLoader/1.0' }
      });
    } catch (err) {
      console.error(`Fetch error: ${err.message}`);
      return res.status(502).json({ 
        error: 'Could not retrieve file',
        details: err.message
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`Remote error: ${response.status} - ${errorText}`);
      return res.status(response.status).json({
        error: 'Remote server error',
        status: response.status,
        details: errorText
      });
    }

    // Process file content
    const fileBuffer = await response.buffer();
    const isEncrypted = fileUrl.pathname.endsWith('.enc');

    if (isEncrypted) {
      try {
        const decrypted = await decryptFile(fileBuffer);
        const filename = fileUrl.pathname.split('/').pop().replace('.enc', '');
        
        res.setHeader('Content-Type', getContentType(filename));
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        return res.send(decrypted);
      } catch (decryptErr) {
        console.error('Decryption failed:', decryptErr);
        
        // Debugging aid - save the encrypted file for analysis
        if (process.env.NODE_ENV === 'development') {
          const fs = require('fs');
          fs.writeFileSync('debug_encrypted.bin', fileBuffer);
          console.log('Saved encrypted file to debug_encrypted.bin');
        }
        
        return res.status(500).json({
          error: 'Decryption failed',
          details: 'The file could not be decrypted. Please verify the encryption key and method.'
        });
      }
    } else {
      const filename = fileUrl.pathname.split('/').pop();
      res.setHeader('Content-Type', getContentType(filename));
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.send(fileBuffer);
    }
  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Enhanced decryption function
async function decryptFile(encryptedBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const decipher = crypto.createDecipheriv(
        ENCRYPTION_CONFIG.algorithm,
        ENCRYPTION_CONFIG.key,
        ENCRYPTION_CONFIG.iv
      );
      
      let decrypted = Buffer.concat([
        decipher.update(encryptedBuffer),
        decipher.final()
      ]);
      
      resolve(decrypted);
    } catch (err) {
      // Additional debug info
      console.error('Decryption error details:', {
        inputLength: encryptedBuffer.length,
        algorithm: ENCRYPTION_CONFIG.algorithm,
        keyLength: ENCRYPTION_CONFIG.key.length,
        ivLength: ENCRYPTION_CONFIG.iv.length,
        error: err.message
      });
      reject(new Error('Decryption failed: ' + err.message));
    }
  });
}

// Helper function
function getContentType(filename) {
  const extension = filename.split('.').pop().toLowerCase();
  const types = {
    pdf: 'application/pdf',
    mp4: 'video/mp4'
  };
  return types[extension] || 'application/octet-stream';
}

// Server start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server ready on port ${PORT}`);
  
});
