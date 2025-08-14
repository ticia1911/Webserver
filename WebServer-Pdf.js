const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 10000;

// Enhanced CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range']
}));

// Serve static files
app.use('/public', express.static('public'));

// Constants
const JSON_URL = 'https://najuzi.com/webapp/MobileApp/directory.json';
const BASE_FILE_URL = 'https://najuzi.com/webapp/MobileApp/';

// Helper functions
async function fetchDirectoryJSON() {
  const res = await fetch(JSON_URL);
  if (!res.ok) throw new Error('Failed to fetch directory.json');
  return res.json();
}

function getNodeAtPath(tree, pathParam) {
  if (!pathParam) return tree;
  const segments = pathParam.split('/').filter(s => s.trim() !== '');
  let node = tree;
  for (const seg of segments) {
    if (!node[seg]) return null;
    node = node[seg];
  }
  return node;
}

// API endpoints
app.get('/list', async (req, res) => {
  try {
    let pathParam = req.query.path || '';
    pathParam = pathParam.replace(/^https?:\/\/[^/]+\/webapp\/MobileApp\//, '');
    const tree = await fetchDirectoryJSON();
    const node = getNodeAtPath(tree, pathParam);

    if (!node) return res.status(404).json({ error: 'Path not found' });

    const items = [];
    for (const key in node) {
      if (key !== 'files') {
        items.push({
          name: key,
          isFolder: true,
          path: pathParam ? `${pathParam}/${key}` : key,
        });
      }
    }
    
    if (node.files && Array.isArray(node.files)) {
      node.files.forEach(file => {
        if (!file.startsWith('~$')) {
          items.push({
            name: file,
            isFolder: false,
            path: pathParam ? `${pathParam}/${file}` : file,
          });
        }
      });
    }

    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/file', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('No file path provided');

    const url = `${BASE_FILE_URL}${filePath}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      return res.status(response.status).send('File not found');
    }

    // Set proper headers
    res.setHeader('Content-Type', getContentType(filePath) || 'application/octet-stream');
    res.setHeader('Content-Length', response.headers.get('content-length'));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Stream the file
    response.body.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

function getContentType(filePath) {
  const extension = filePath.split('.').pop().toLowerCase();
  const types = {
    'pdf': 'application/pdf',
    'pdf.enc': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  return types[extension] || null;
}

// Health check
app.get('/', (req, res) => res.send('Server running 🎉'));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`PDF viewer available at: http://localhost:${PORT}/public/pdfjs/web/viewer.html`);
});
