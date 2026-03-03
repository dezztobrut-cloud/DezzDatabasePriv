const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', true);
app.use(express.json());

// --- DATABASE CONFIG ---
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(__dirname, 'internal_db.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ 
        keys: {}, 
        bans: [], 
        config: { master_key: 'admin_dezz_123' } 
    }));
}

const getDB = () => JSON.parse(fs.readFileSync(DB_FILE));
const saveDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const getIP = (req) => {
    let ip = req.headers['x-forwarded-for'] || req.ip;
    if (ip.includes('::ffff:')) ip = ip.split(':').pop();
    return ip;
};

// --- SECURITY ---
app.use((req, res, next) => {
    const db = getDB();
    if (db.bans.includes(getIP(req))) return res.status(403).send('<h1>IP BANNED</h1>');
    next();
});

const getNamespace = (key) => crypto.createHash('md5').update(key).digest('hex').substring(0, 10);

// --- AUTH MIDDLEWARE ---
const auth = (perm) => (req, res, next) => {
    const key = req.headers['x-api-key'] || req.query.key;
    const db = getDB();
    if (key === db.config.master_key) { req.is_admin = true; return next(); }
    const k = db.keys[key];
    if (k && !k.revoked && k.perms.includes(perm)) {
        req.namespace = getNamespace(key);
        req.key_name = k.name;
        return next();
    }
    res.status(403).json({ error: 'Unauthorized' });
};

// ==========================================
// 🚀 API ENDPOINTS
// ==========================================

// List Files in User's Namespace
app.get('/api/projects/list', auth('READ'), (req, res) => {
    const userDir = path.join(DATA_DIR, req.namespace);
    if (!fs.existsSync(userDir)) return res.json([]);
    const files = fs.readdirSync(userDir).filter(f => f.endsWith('.json')).map(f => ({
        name: f.replace('.json', ''),
        size: (fs.statSync(path.join(userDir, f)).size / 1024).toFixed(2) + ' KB'
    }));
    res.json(files);
});

// Admin: List All Users & All Projects
app.get('/api/admin/all', auth('READ'), (req, res) => {
    if (!req.is_admin) return res.status(403).send('No');
    const db = getDB();
    const stats = { users: Object.keys(db.keys).length, bans: db.bans.length, projects: [] };
    
    // Scan all folders
    const dirs = fs.readdirSync(DATA_DIR);
    dirs.forEach(d => {
        const p = path.join(DATA_DIR, d);
        if (fs.lstatSync(p).isDirectory()) {
            stats.projects.push({ ns: d, files: fs.readdirSync(p) });
        }
    });
    res.json(stats);
});

// Create/Edit JSON File
app.post('/api/db/save', auth('WRITE'), (req, res) => {
    const { filename, content } = req.body;
    const userDir = path.join(DATA_DIR, req.namespace);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    
    try {
        const jsonContent = typeof content === 'string' ? JSON.parse(content) : content;
        fs.writeFileSync(path.join(userDir, `${filename}.json`), JSON.stringify(jsonContent, null, 2));
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: 'Invalid JSON format' }); }
});

// Delete JSON File
app.delete('/api/db/:name', auth('DELETE'), (req, res) => {
    const filePath = path.join(DATA_DIR, req.namespace, `${req.params.name}.json`);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true });
    } else res.status(404).json({ error: 'File not found' });
});

// Public Key Generation
app.post('/api/key/create', rateLimit({ windowMs: 60*60*1000, max: 5 }), (req, res) => {
    const { name } = req.body;
    const db = getDB();
    const newKey = `dezz_plta_${crypto.randomBytes(12).toString('hex')}`;
    db.keys[newKey] = { name: name || 'Unnamed', perms: ['READ', 'WRITE', 'DELETE'], revoked: false, ip: getIP(req) };
    saveDB(db);
    res.json({ success: true, key: newKey });
});

// ==========================================
// 🎨 UI PAGES (Integrated)
// ==========================================
const UI_COMMON = `
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Plus Jakarta Sans', sans-serif; background: #05070a; color: #94a3b8; }
        .glass { background: rgba(15, 23, 42, 0.8); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.05); }
        .btn-pro { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); transition: all 0.3s; }
        .btn-pro:hover { transform: translateY(-2px); box-shadow: 0 10px 20px -10px #3b82f6; }
    </style>
`;

// INDEX PAGE
app.get('/', (req, res) => {
    res.send(`<html><head>${UI_COMMON}<title>DezzDB - High Performance JSON</title></head>
    <body class="p-4 md:p-10">
        <div class="max-w-6xl mx-auto">
            <nav class="flex justify-between items-center mb-16">
                <h1 class="text-2xl font-bold text-white tracking-tighter italic">DEZZ<span class="text-blue-500">DB</span></h1>
                <div class="flex gap-6 text-sm font-semibold">
                    <a href="/docs" class="hover:text-white transition">Docs</a>
                    <button onclick="login()" class="text-blue-500">Dashboard</button>
                </div>
            </nav>

            <div id="hero" class="text-center py-20">
                <h2 class="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">Reliable JSON <br>Storage for Devs.</h2>
                <p class="text-gray-500 max-w-xl mx-auto mb-10 text-lg">Platform database PLTA dengan isolasi folder pribadi. Aman, cepat, dan gampang dikelola via API atau Web.</p>
                <button onclick="createProject()" class="btn-pro text-white px-10 py-4 rounded-2xl font-bold shadow-2xl">Get Started Free</button>
            </div>

            <div id="dashboard" class="hidden">
                <div class="flex justify-between items-end mb-8">
                    <div>
                        <h3 class="text-white text-2xl font-bold">My Projects</h3>
                        <p class="text-xs text-gray-500 font-mono" id="currentKeyDisp"></p>
                    </div>
                    <button onclick="openEditor()" class="bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-xl text-xs border border-white/10">New JSON</button>
                </div>
                <div id="projectList" class="grid grid-cols-1 md:grid-cols-3 gap-4"></div>
            </div>
        </div>

        <script>
            let MY_KEY = localStorage.getItem('dezz_key');
            
            function login() {
                Swal.fire({
                    title: 'Access Dashboard',
                    input: 'password',
                    inputPlaceholder: 'Paste your API Key here...',
                    background: '#0f172a', color: '#fff',
                    confirmButtonText: 'Enter'
                }).then(r => { if(r.value) { localStorage.setItem('dezz_key', r.value); location.reload(); }});
            }

            if(MY_KEY) {
                document.getElementById('hero').classList.add('hidden');
                document.getElementById('dashboard').classList.remove('hidden');
                document.getElementById('currentKeyDisp').innerText = "NS: " + MY_KEY.substring(0,15) + "...";
                loadProjects();
            }

            async function loadProjects() {
                const res = await fetch('/api/projects/list', { headers: {'x-api-key': MY_KEY} });
                const files = await res.json();
                const container = document.getElementById('projectList');
                container.innerHTML = files.map(f => \`
                    <div class="glass p-6 rounded-3xl hover:border-blue-500/50 transition-all group">
                        <h4 class="text-white font-bold mb-1 italic">\${f.name}.json</h4>
                        <p class="text-[10px] text-gray-500 mb-4">\${f.size}</p>
                        <div class="flex gap-2">
                            <button onclick="openEditor('\${f.name}')" class="text-[10px] bg-blue-500/10 text-blue-400 px-3 py-1 rounded-lg">Edit</button>
                            <button onclick="deleteFile('\${f.name}')" class="text-[10px] bg-red-500/10 text-red-400 px-3 py-1 rounded-lg">Delete</button>
                        </div>
                    </div>
                \`).join('');
            }

            async function openEditor(name = '') {
                let initialContent = "{}";
                if(name) {
                    const res = await fetch('/api/db/'+name, { headers: {'x-api-key': MY_KEY} });
                    const data = await res.json();
                    initialContent = JSON.stringify(data, null, 2);
                }

                const { value: formValues } = await Swal.fire({
                    title: name ? 'Edit JSON' : 'New JSON File',
                    background: '#0f172a', color: '#fff',
                    html: \`
                        <input id="swal-name" class="swal2-input bg-black/40 text-white border-white/10" placeholder="Filename" value="\${name}">
                        <textarea id="swal-content" class="swal2-textarea bg-black/40 text-blue-400 font-mono text-xs h-64" placeholder="JSON Content...">\${initialContent}</textarea>
                    \`,
                    focusConfirm: false,
                    preConfirm: () => [ document.getElementById('swal-name').value, document.getElementById('swal-content').value ]
                });

                if (formValues) {
                    const res = await fetch('/api/db/save', {
                        method: 'POST',
                        headers: {'Content-Type':'application/json', 'x-api-key': MY_KEY},
                        body: JSON.stringify({ filename: formValues[0], content: formValues[1] })
                    });
                    if(res.ok) { Swal.fire('Saved!', '', 'success'); loadProjects(); }
                    else { Swal.fire('Error', 'Invalid JSON', 'error'); }
                }
            }

            async function createProject() {
                const { value: name } = await Swal.fire({
                    title: 'Project Name', input: 'text', background: '#0f172a', color: '#fff'
                });
                if(name) {
                    const res = await fetch('/api/key/create', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
                    const d = await res.json();
                    localStorage.setItem('dezz_key', d.key);
                    Swal.fire('Key Created!', 'Store this safely: ' + d.key, 'success').then(() => location.reload());
                }
            }

            async function deleteFile(name) {
                if(confirm('Delete ' + name + '?')) {
                    await fetch('/api/db/' + name, { method: 'DELETE', headers: {'x-api-key': MY_KEY} });
                    loadProjects();
                }
            }
        </script>
    </body></html>`);
});

// DOCS PAGE
app.get('/docs', (req, res) => {
    res.send(`<html><head>${UI_COMMON}<title>Docs - DezzDB</title></head>
    <body class="p-8 md:p-20">
        <div class="max-w-4xl mx-auto">
            <a href="/" class="text-blue-500 mb-10 inline-block font-bold">← Back Home</a>
            <h1 class="text-5xl font-bold text-white mb-10">API Documentation</h1>
            
            <section class="mb-12">
                <h2 class="text-2xl text-white mb-4 italic">1. WhatsApp Bot Example (Node.js)</h2>
                <div class="glass p-6 rounded-3xl font-mono text-xs text-blue-300">
                    const axios = require('axios'); <br><br>
                    // Ambil config bot dari database <br>
                    async function getBotConfig() { <br>
                    &nbsp;&nbsp;const res = await axios.get('https://domain-lu.com/api/db/config', { <br>
                    &nbsp;&nbsp;&nbsp;&nbsp;headers: { 'x-api-key': 'YOUR_PLTA_KEY' } <br>
                    &nbsp;&nbsp;}); <br>
                    &nbsp;&nbsp;console.log(res.data); <br>
                    }
                </div>
            </section>

            <section class="mb-12">
                <h2 class="text-2xl text-white mb-4 italic">2. Store Data (cURL)</h2>
                <div class="glass p-6 rounded-3xl font-mono text-xs text-emerald-400">
                    curl -X POST https://domain-lu.com/api/db/users \\ <br>
                    -H "x-api-key: YOUR_KEY" \\ <br>
                    -H "Content-Type: application/json" \\ <br>
                    -d '{"name": "Dezz", "role": "Admin"}'
                </div>
            </section>
        </div>
    </body></html>`);
});

// ADMIN PAGE
app.get('/admin', (req, res) => {
    res.send(`<html><head>${UI_COMMON}<title>Master Admin</title></head>
    <body class="p-8">
        <div class="max-w-5xl mx-auto">
            <h1 class="text-3xl font-bold text-white mb-10">Global Controller</h1>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="glass p-8 rounded-[2rem]">
                    <h3 class="text-red-500 font-bold mb-4 italic">Banned IP List</h3>
                    <div id="banList" class="space-y-2 text-xs font-mono"></div>
                </div>
                <div class="glass p-8 rounded-[2rem]">
                    <h3 class="text-blue-500 font-bold mb-4 italic">Total Projects Monitor</h3>
                    <div id="projStats" class="space-y-2 text-xs font-mono"></div>
                </div>
            </div>
        </div>
        <script>
            const mk = localStorage.getItem('master_key') || prompt('Master Key:');
            async function loadAdmin() {
                const res = await fetch('/api/admin/all', { headers: {'x-api-key': mk} });
                const d = await res.json();
                localStorage.setItem('master_key', mk);
                document.getElementById('projStats').innerHTML = d.projects.map(p => \`<div>NS: \${p.ns} (\${p.files.length} Files)</div>\`).join('');
            }
            loadAdmin();
        </script>
    </body></html>`);
});

const PORT = 3000;
app.listen(PORT, () => console.log('🚀 DezzDB Professional Edition V5 Ready.'));
