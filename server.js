const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();

// WAJIB: Biar bisa baca IPv4 & IPv6 dari Nginx
app.set('trust proxy', true); 
app.use(express.json());

// --- DATABASE INTERNAL ---
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

// --- HELPER DETEKSI IP (IPv4 & IPv6) ---
const getIP = (req) => {
    let ip = req.ip;
    if (ip.includes('::ffff:')) ip = ip.split(':').pop();
    return ip;
};

// --- KEAMANAN & BAN SYSTEM ---
const checkBan = (req, res, next) => {
    const db = getDB();
    const ip = getIP(req);
    if (db.bans.includes(ip)) {
        return res.status(403).send(`<body style="background:#0b0f1a;color:#ff4d4d;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><h1>IP LU DIBLOKIR: ${ip}</h1></body>`);
    }
    next();
};

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    handler: (req, res) => {
        const db = getDB();
        const ip = getIP(req);
        if (!db.bans.includes(ip)) db.bans.push(ip);
        saveDB(db);
        res.status(429).json({ error: 'Spam detected. IP Banned: ' + ip });
    }
});

app.use(checkBan);

// --- AUTH MIDDLEWARE (PLTA STYLE) ---
const auth = (perm) => (req, res, next) => {
    const key = req.headers['x-api-key'];
    const db = getDB();
    if (key === db.config.master_key) return next();
    const k = db.keys[key];
    if (k && !k.revoked && k.perms.includes(perm)) return next();
    res.status(403).json({ error: 'Akses Ditolak. Butuh ijin: ' + perm });
};

// ==========================================
// 🚀 SEMUA JALUR (ROUTES)
// ==========================================

// --- UI PAGES ---
const UI_ASSETS = `
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Plus Jakarta Sans', sans-serif; background: #0b0f1a; color: #e2e8f0; }
        .glass { background: rgba(22, 27, 44, 0.6); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.05); }
    </style>
`;

app.get('/', (req, res) => {
    const db = getDB();
    res.send(`<html><head>${UI_ASSETS}<title>DezzDB</title></head><body class="p-6">
        <div class="max-w-4xl mx-auto">
            <nav class="flex justify-between items-center mb-10 glass p-5 rounded-3xl">
                <h1 class="text-2xl font-800 tracking-tighter text-white">DEZZ<span class="text-blue-500">DB.</span></h1>
                <div class="flex gap-4">
                    <a href="/docs" class="text-sm text-gray-500 hover:text-white pt-2">Docs</a>
                    <a href="/admin" class="text-sm text-gray-500 hover:text-white pt-2">Admin</a>
                    <button onclick="requestKey()" class="bg-blue-600 px-5 py-2 rounded-2xl font-bold text-sm shadow-lg shadow-blue-600/20">Get Key</button>
                </div>
            </nav>
            <div class="glass p-12 rounded-[3rem] text-center border-t border-white/10 shadow-2xl">
                <h2 class="text-6xl font-800 text-white mb-6 leading-tight">Functional <br>JSON Engine.</h2>
                <p class="text-gray-500 mb-10 text-lg max-w-lg mx-auto">Database PLTA dengan deteksi IPv4/v6. Bangun project lu tanpa ribet setup database berat.</p>
                <div class="flex justify-center gap-6">
                    <div class="bg-white/5 p-6 rounded-3xl border border-white/5 w-40">
                        <p class="text-[10px] text-gray-500 uppercase font-bold mb-1">IP LU</p>
                        <p class="text-xs font-800 text-blue-400 truncate">${getIP(req)}</p>
                    </div>
                </div>
            </div>
        </div>
        <script>
            async function requestKey() {
                const res = await fetch('/api/key/request', { method: 'POST' });
                const d = await res.json();
                if(d.key) Swal.fire({ title: 'Key Publik Dibuat', text: d.key, icon: 'success', background: '#161b2c', color: '#fff' });
            }
        </script>
    </body></html>`);
});

app.get('/docs', (req, res) => {
    res.send(`<html><head>${UI_ASSETS}<title>Docs</title></head><body class="p-8">
        <div class="max-w-3xl mx-auto">
            <h1 class="text-4xl font-800 mb-8 text-white">Interactive Docs</h1>
            <div class="space-y-4">
                <div class="glass p-6 rounded-3xl">
                    <span class="text-emerald-400 font-bold">GET</span> /api/db/:name
                    <p class="text-xs text-gray-500 mt-2">Ambil data JSON. Header: x-api-key</p>
                </div>
                <div class="glass p-6 rounded-3xl">
                    <span class="text-blue-400 font-bold">POST</span> /api/db/:name
                    <p class="text-xs text-gray-500 mt-2">Kirim data JSON di body request.</p>
                </div>
            </div>
        </div>
    </body></html>`);
});

app.get('/admin', (req, res) => {
    const db = getDB();
    res.send(`<html><head>${UI_ASSETS}<title>Admin</title></head><body class="p-8">
        <div class="max-w-5xl mx-auto">
            <h1 class="text-3xl font-800 mb-8">Admin Center</h1>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="glass p-8 rounded-[2.5rem]">
                    <h3 class="font-bold mb-6 text-white">Create Key</h3>
                    <input id="n" placeholder="Project Name" class="w-full bg-black/40 p-4 rounded-2xl mb-4 border border-white/10 text-sm">
                    <div class="flex gap-4 mb-6 text-[10px] font-bold text-gray-500">
                        <label><input type="checkbox" class="p" value="READ" checked> READ</label>
                        <label><input type="checkbox" class="p" value="WRITE"> WRITE</label>
                        <label><input type="checkbox" class="p" value="DELETE"> DELETE</label>
                    </div>
                    <button onclick="gen()" class="w-full bg-blue-600 p-4 rounded-2xl font-800">GENERATE KEY</button>
                </div>
                <div class="glass p-8 rounded-[2.5rem]">
                    <h3 class="font-bold mb-4 text-red-500">Banned IPs</h3>
                    <div class="space-y-2 font-mono text-xs">
                        ${db.bans.map(ip => `<div class="flex justify-between p-3 bg-red-500/5 rounded-xl border border-red-500/10"><span>${ip}</span><button onclick="unb('${ip}')" class="text-red-400 underline">Unban</button></div>`).join('') || 'Kosong'}
                    </div>
                </div>
            </div>
        </div>
        <script>
            const mk = () => localStorage.getItem('mk') || prompt('Master Key:');
            async function gen() {
                const n = document.getElementById('n').value;
                const p = Array.from(document.querySelectorAll('.p:checked')).map(el => el.value);
                const res = await fetch('/api/admin/create-key', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ master: mk(), name: n, perms: p })
                });
                const d = await res.json();
                if(d.key) { localStorage.setItem('mk', mk()); Swal.fire({ title: 'Key Created', text: d.key, icon: 'success', background: '#161b2c', color: '#fff' }); }
            }
            async function unb(ip) {
                await fetch('/api/admin/unban', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ master: mk(), ip })
                });
                location.reload();
            }
        </script>
    </body></html>`);
});

// --- API ROUTES ---
app.post('/api/key/request', apiLimiter, (req, res) => {
    const db = getDB();
    const key = 'pub_' + crypto.randomBytes(6).toString('hex');
    db.keys[key] = { name: 'Public', perms: ['READ'], revoked: false, ip: getIP(req) };
    saveDB(db);
    res.json({ success: true, key });
});

app.post('/api/admin/create-key', (req, res) => {
    const { master, name, perms } = req.body;
    const db = getDB();
    if (master !== db.config.master_key) return res.status(401).json({ error: 'Salah Key' });
    const key = 'plta_' + crypto.randomBytes(10).toString('hex');
    db.keys[key] = { name, perms, revoked: false, ip: 'Admin' };
    saveDB(db);
    res.json({ success: true, key });
});

app.post('/api/admin/unban', (req, res) => {
    const { master, ip } = req.body;
    const db = getDB();
    if (master !== db.config.master_key) return res.status(401).send('No');
    db.bans = db.bans.filter(b => b !== ip);
    saveDB(db);
    res.json({ success: true });
});

app.get('/api/db/:name', auth('READ'), (req, res) => {
    const p = path.join(DATA_DIR, req.params.name + '.json');
    if (fs.existsSync(p)) res.json(JSON.parse(fs.readFileSync(p)));
    else res.status(404).json({ error: 'Gada' });
});

app.post('/api/db/:name', auth('WRITE'), (req, res) => {
    fs.writeFileSync(path.join(DATA_DIR, req.params.name + '.json'), JSON.stringify(req.body, null, 2));
    res.json({ success: true });
});

app.get('/backup', (req, res) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    res.attachment('backup-' + Date.now() + '.zip');
    archive.pipe(res);
    archive.directory(DATA_DIR, false);
    archive.finalize();
});

const PORT = 3000;
app.listen(PORT, () => console.log('🚀 Serverless DB Fungsional di Port ' + PORT));
