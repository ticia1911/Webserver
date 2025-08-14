const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS
app.use(cors());

// Serve static files from 'public' folder at /public
app.use('/public', express.static('public'));

// URL to your directory.json on Namecheap
const JSON_URL = 'https://najuzi.com/webapp/MobileApp/directory.json';

// Helper: fetch JSON remotely
async function fetchDirectoryJSON() {
  const res = await fetch(JSON_URL);
  if (!res.ok) throw new Error('Failed to fetch directory.json');
  return res.json();
}

// Helper: traverse JSON by path segments
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

// API: list folders/files
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
      for (const file of node.files) {
        if (file.startsWith('~$')) continue;
        items.push({
          name: file,
          isFolder: false,
          path: pathParam ? `${pathParam}/${file}` : file,
        });
      }
    }

    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Proxy route: fetch PDFs from Namecheap
app.get('/pdf', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('No file path provided');

    // Construct the full Namecheap URL
    const url = `https://najuzi.com/webapp/MobileApp/${filePath}`;

    const response = await fetch(url);
    if (!response.ok) return res.status(404).send('File not found');

    // Set PDF headers
    res.setHeader('Content-Type', 'application/pdf');

    // Stream the file to the client
    response.body.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Health check
app.get('/', (req, res) => res.send('Server running 🎉'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
