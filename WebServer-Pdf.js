const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 10000;
const ROOT_URL = 'https://najuzi.com/webapp/MobileApp';

// HTTPS agent for secure connections
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  timeout: 10000
});

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET']
}));

// Root endpoint
app.get('/', (req, res) => {
  res.send('Najuzi PDF Server - Direct PDF Access');
});

// Folder listing endpoint
app.get('/folder-tree', async (req, res) => {
  try {
    const folderPath = req.query.folder || '';
    const safePath = folderPath.replace(/[^a-zA-Z0-9_\-/]/g, '');
    const targetUrl = `${ROOT_URL}/${safePath}/`.replace(/\/+/g, '/');

    const response = await fetch(targetUrl, { agent: httpsAgent });
    const html = await response.text();

    // Parse directory listing
    const items = [];
    const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
      const href = match[1];
      const name = match[2].trim();

      if (name === 'Parent Directory' || href === '../') continue;

      const isFolder = href.endsWith('/');
      const fullUrl = `${ROOT_URL}/${safePath}/${href}`.replace(/\/+/g, '/');

      if (isFolder) {
        items.push({
          type: 'folder',
          name: name,
          path: fullUrl
        });
      } else if (name.endsWith('.pdf')) {
        items.push({
          type: 'file',
          name: name,
          path: fullUrl,
          url: `/pdf?path=${encodeURIComponent(fullUrl)}`
        });
      }
    }

    res.json(items);
  } catch (err) {
    console.error('Folder error:', err);
    res.status(500).json({ error: 'Failed to fetch folder' });
  }
});

// Simplified PDF endpoint
app.get('/pdf', async (req, res) => {
  try {
    const pdfUrl = decodeURIComponent(req.query.path);
    
    if (!pdfUrl.startsWith(ROOT_URL)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const response = await fetch(pdfUrl, { agent: httpsAgent });
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Failed to fetch PDF' 
      });
    }

    // Stream the PDF directly to the client
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    
    const pdfStream = response.body;
    pdfStream.pipe(res);
    
  } catch (err) {
    console.error('PDF error:', err);
    res.status(500).json({ error: 'Failed to load PDF' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 Access at: https://webserver-zpgc.onrender.com`);
});
