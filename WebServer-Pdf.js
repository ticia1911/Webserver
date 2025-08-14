// server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS for all origins (so your Flutter web can fetch)
app.use(cors());

// Path to your JSON structure
const JSON_PATH = path.join(__dirname, 'directory.json');

// Helper: read JSON
async function readDirectoryJSON() {
  const data = await fs.readFile(JSON_PATH, 'utf8');
  return JSON.parse(data);
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

    // Remove full URL if accidentally sent
    pathParam = pathParam.replace(/^https?:\/\/[^/]+\/webapp\/MobileApp\//, '');

    const tree = await readDirectoryJSON();
    const node = getNodeAtPath(tree, pathParam);

    if (!node) return res.status(404).json({ error: 'Path not found' });

    const items = [];

    // Add folders
    for (const key in node) {
      if (key !== 'files') {
        items.push({
          name: key,
          isFolder: true,
          path: pathParam ? `${pathParam}/${key}` : key,
        });
      }
    }

    // Add files
    if (node.files && Array.isArray(node.files)) {
      for (const file of node.files) {
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

// API: optional health check
app.get('/', (req, res) => res.send('Server running 🎉'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
