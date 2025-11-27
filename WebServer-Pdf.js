const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 10000;

// 🔐 Encryption setup
const SECRET_KEY = 'najuzi0702518998';
const IV = Buffer.alloc(16, 0); // AES-256-CTR IV

// Base URLs
const JSON_URL = 'https://najuzi.com/webapp/MobileApp/directory.json';
const BASE_FILE_URL = 'https://najuzi.com/webapp/MobileApp/';

// CORS setup
app.use(cors({
    origin: '*',
    methods: ['GET', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Range'],
    exposedHeaders: ['Content-Length', 'Content-Range']
}));

// Serve static files
app.use('/public', express.static('public'));

// ================= HELPERS ===================

// Fetch the directory JSON
async function fetchDirectoryJSON() {
    const res = await fetch(JSON_URL);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return res.json();
    else if (contentType.includes('text/html')) {
        const text = await res.text();
        console.warn('Warning: Received HTML instead of JSON from directory URL');
        return { html: text };
    } else throw new Error('Unsupported content type: ' + contentType);
}

// Traverse the tree to get a node at a given path
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

// Clean path from full URL to relative path
function cleanPath(inputPath) {
    if (!inputPath) return '';
    if (inputPath.includes('onrender.com')) {
        const url = new URL(inputPath);
        return cleanPath(url.searchParams.get('path'));
    }
    return inputPath.replace(/^https?:\/\/[^/]+\/webapp\/MobileApp\//, '');
}

// Allowed file types
function isAllowedFile(fileName) {
    const lower = fileName.toLowerCase();
    return lower.endsWith('.pdf') || lower.endsWith('.pdf.enc') || lower.endsWith('.mp4');
}

// Recursive search helper
function searchFiles(node, path, keyword) {
    let results = [];
    if (node.files && Array.isArray(node.files)) {
        node.files.forEach(file => {
            if (!file.startsWith('~$') && isAllowedFile(file)) {
                if (file.toLowerCase().includes(keyword.toLowerCase())) {
                    results.push({
                        name: file,
                        isFolder: false,
                        path: path ? `${path}/${file}` : file
                    });
                }
            }
        });
    }
    for (const key in node) {
        if (key !== 'files') {
            const subNode = node[key];
            const subPath = path ? `${path}/${key}` : key;
            results = results.concat(searchFiles(subNode, subPath, keyword));
        }
    }
    return results;
}

// AES-256-CTR key
function getKey() {
    return crypto.createHash('sha256').update(SECRET_KEY).digest();
}

// ================== APIs ====================

// List folders/files or search
app.get('/list', async (req, res) => {
    try {
        let pathParam = req.query.path || '';
        pathParam = cleanPath(pathParam);
        const searchKeyword = req.query.search || '';
        const tree = await fetchDirectoryJSON();
        if (tree.html) return res.status(500).send(tree.html);

        const node = getNodeAtPath(tree, pathParam);
        if (!node) return res.status(404).json({ error: 'Path not found' });

        if (searchKeyword.trim() !== '') {
            const files = searchFiles(node, pathParam, searchKeyword);
            return res.json(files);
        }

        const folders = [];
        const files = [];
        for (const key in node) {
            if (key !== 'files') {
                folders.push({ name: key, isFolder: true, path: pathParam ? `${pathParam}/${key}` : key });
            }
        }
        if (folders.length === 0 && node.files && Array.isArray(node.files)) {
            node.files.forEach(file => {
                if (!file.startsWith('~$') && isAllowedFile(file)) {
                    files.push({ name: file, isFolder: false, path: pathParam ? `${pathParam}/${file}` : file });
                }
            });
        }
        res.json(folders.length > 0 ? folders : files);
    } catch (err) {
        console.error('List error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ================= FILE / VIDEO STREAM =================

// Stream encrypted PDF or normal PDF
async function streamPDF(filePath, req, res) {
    const url = `${BASE_FILE_URL}${filePath}`;
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).send('File not found');

    const lower = filePath.toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'none');
    res.setHeader('Content-Disposition', 'inline');

    if (lower.endsWith('.pdf.enc')) {
        const key = getKey();
        const decipher = crypto.createDecipheriv('aes-256-ctr', key, IV);
        return response.body.pipe(decipher).pipe(res);
    } else {
        return response.body.pipe(res);
    }
}

// Stream MP4 (with range support)
async function streamVideo(filePath, req, res) {
    const url = `${BASE_FILE_URL}${filePath}`;
    const range = req.headers.range;

    if (!range) {
        const fullResp = await fetch(url);
        if (!fullResp.ok) return res.status(fullResp.status).send('Video not found');
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Content-Length': fullResp.headers.get('content-length'),
            'Accept-Ranges': 'bytes'
        });
        return fullResp.body.pipe(res);
    }

    const videoResp = await fetch(url, { headers: { Range: range } });
    if (!videoResp.ok) return res.status(videoResp.status).send('Video not found');
    const headers = {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': videoResp.headers.get('content-length') || undefined
    };
    if (videoResp.headers.get('content-range')) headers['Content-Range'] = videoResp.headers.get('content-range');
    res.writeHead(videoResp.headers.get('content-range') ? 206 : 200, headers);
    return videoResp.body.pipe(res);
}

// Serve PDF or MP4
app.get('/file', async (req, res) => {
    try {
        let filePath = req.query.path;
        if (!filePath) return res.status(400).send('No file path provided');
        filePath = cleanPath(filePath);

        const lower = filePath.toLowerCase();
        if (!isAllowedFile(filePath)) return res.status(400).send('Only PDF and MP4 allowed');

        if (lower.endsWith('.pdf') || lower.endsWith('.pdf.enc')) return streamPDF(filePath, req, res);
        if (lower.endsWith('.mp4')) return streamVideo(filePath, req, res);

        return res.status(415).send('Unsupported file type');
    } catch (err) {
        console.error('File proxy error:', err);
        res.status(500).send('Server error');
    }
});

// /video alias
app.get('/video', async (req, res) => {
    try {
        let filePath = req.query.path;
        if (!filePath) return res.status(400).send('No file path provided');
        filePath = cleanPath(filePath);

        if (!filePath.toLowerCase().endsWith('.mp4')) return res.status(400).send('Only MP4 supported');
        return streamVideo(filePath, req, res);
    } catch (err) {
        console.error('Video proxy error:', err);
        res.status(500).send('Server error');
    }
});

// ================= HEALTH =================
app.get('/', (req, res) => res.send('✅ Secure Encrypted Media Server Running...'));

// ================= START SERVER =================
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`PDF viewer example: http://localhost:${PORT}/public/pdfjs/web/viewer.html`);
});
