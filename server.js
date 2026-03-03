const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// --- DATABASE MOCKING (Persist ke File) ---
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(__dirname, 'internal_db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ 
        keys: {}, 
        bans: [], 
        config: { master_key: 'dezz_admin_pro' } 
    }));
}

const getDB = () => JSON.parse(fs.readFileSync(DB_FILE));
const saveDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// --- SPAM PROTECTION & BAN SYSTEM ---
const checkBan = (req, res, next) => {
    const db = getDB();
    if (db.bans.includes(req.ip)) {
        return res.status(403).send(`
            <body style="background:#0b0f1a;color:#ff4d4d;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;">
                <h1>IP LU KENA BAN!</h1>
                <p>Terdeteksi Spam Berlebihan. Hubungi Admin buat Unban.</p>
                <a href="https://t.me/your_telegram" style="color:white">Minta Unban</a>
            </body>
        `);
    }
    next();
};

const apiLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 50,
    handler: (req, res) => {
        const db = getDB();
        // Logikanya: Kalo kena limit, catat. Kalo sering, ban.
        if (!db.bans.includes(req.ip)) db.bans.push(req.ip);
        saveDB(db);
        res.status(429).json({ error: 'Spam terdeteksi! IP lu otomatis diblokir.' });
    }
});

app.use(checkBan);

// --- AUTH MIDDLEWARE ---
const authorize = (permission) => {
    return (req, res, next) => {
        const key = req.headers['x-api-key'];
        const db = getDB();
        
        if (key === db.config.master_key) return next();
        
        const keyData = db.keys[key];
        if (keyData && !keyData.revoked && keyData.perms.includes(permission)) {
            return next();
        }
        res.status(403).json({ error: `Gak punya akses: ${permission}` });
    };
};

// ==========================================
// 🚀 API ROUTES
// ==========================================

// Create Key (Admin Only or Master)
app.post('/api/admin/create-key', (req, res) => {
    const { master, name, perms } = req.body; // perms: ['READ', 'WRITE']
    const db = getDB();
    if (master !== db.config.master_key) return res.status(401).send('Unauthorized');

    const newKey = `plta_${crypto.randomBytes(12).toString('hex')}`;
    db.keys[newKey] = { name, perms, revoked: false, ip: req.ip };
    saveDB(db);
    res.json({ success: true, key: newKey });
});

// Unban IP (Admin Only)
app.post('/api/admin/unban', (req, res) => {
    const { master, ip } = req.body;
    const db = getDB();
    if (master !== db.config.master_key) return res.status(401).send('Unauthorized');
    db.bans = db.bans.filter(b => b !== ip);
    saveDB(db);
    res.json({ success: true });
});

// CRUD Data with Granular Perms
app.get('/api/db/:name', authorize('READ'), (req, res) => {
    const p = path.join(DATA_DIR, `${req.params.name}.json`);
    if (fs.existsSync(p)) res.json(JSON.parse(fs.readFileSync(p)));
    else res.status(404).json({ error: 'Not Found' });
});

app.post('/api/db/:name', authorize('WRITE'), (req, res) => {
    fs.writeFileSync(path.join(DATA_DIR, `${req.params.name}.json`), JSON.stringify(req.body, null, 2));
    res.json({ success: true });
});

app.delete('/api/db/:name', authorize('DELETE'), (req, res) => {
    const p = path.join(DATA_DIR, `${req.params.name}.json`);
    if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        res.json({ success: true });
    } else res.status(404).send('Not Found');
});

// ==========================================
// 🎨 UI (JOKO-UI V2)
// ==========================================

const UI_HEADER = `
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Plus Jakarta Sans', sans-serif; background: #0b0f1a; color: #e2e8f0; }
        .glass { background: rgba(22, 27, 44, 0.8); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.05); }
    </style>
`;

// Dashboard Public
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>${UI_HEADER}<title>DezzDB Dashboard</title></head>
    <body class="p-6">
        <div class="max-w-4xl mx-auto">
            <nav class="flex justify-between items-center mb-10 glass p-5 rounded-2xl">
                <h1 class="text-2xl font-800 tracking-tighter text-white italic">DEZZ<span class="text-blue-500">DB</span></h1>
                <div class="flex gap-4">
                    <a href="/docs" class="text-sm text-gray-400 mt-2">Docs</a>
                    <button onclick="reqKey()" class="bg-blue-600 px-4 py-2 rounded-xl font-bold text-sm">Request Access</button>
                </div>
            </nav>
            <div class="glass p-10 rounded-[2.5rem] border-t border-white/10 text-center">
                <h2 class="text-5xl font-800 text-white mb-4">JSON Storage <br>For High-Performers.</h2>
                <p class="text-gray-500 mb-8 text-lg">Kelola data JSON lu dengan akses PLTA granular. Aman, Cepat, Terstruktur.</p>
                <div class="flex justify-center gap-4">
                    <div class="bg-black/40 p-4 rounded-2xl border border-white/5 w-40">
                        <p class="text-xs text-gray-500 uppercase">Uptime</p>
                        <p class="text-xl font-bold text-emerald-400">99.9%</p>
                    </div>
                    <div class="bg-black/40 p-4 rounded-2xl border border-white/5 w-40">
                        <p class="text-xs text-gray-500 uppercase">Type</p>
                        <p class="text-xl font-bold text-blue-400">PLTA Auth</p>
                    </div>
                </div>
            </div>
        </div>
        <script>
            function reqKey() {
                Swal.fire({
                    title: 'Request API Key',
                    text: 'Key publik terbatas. Hubungi Admin buat full access (Read/Write/Delete).',
                    icon: 'info',
                    background: '#161b2c',
                    color: '#fff',
                    confirmButtonColor: '#2563eb'
                });
            }
        </script>
    </body>
    </html>
    `);
});

// Admin Page
app.get('/admin', (req, res) => {
    const db = getDB();
    const bannedIps = db.bans.map(ip => `
        <div class="flex justify-between p-3 bg-red-500/10 border border-red-500/20 rounded-xl mb-2">
            <span class="font-mono text-red-400">${ip}</span>
            <button onclick="unban('${ip}')" class="text-xs bg-red-600 px-2 py-1 rounded-lg">Unban</button>
        </div>
    `).join('');

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>${UI_HEADER}<title>Admin Panel</title></head>
    <body class="p-8">
        <div class="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
            <div class="md:col-span-2 space-y-6">
                <h1 class="text-3xl font-800">Admin Control</h1>
                <div class="glass p-6 rounded-3xl">
                    <h3 class="mb-4 font-bold">Generate New Key (PLTA)</h3>
                    <div class="space-y-4">
                        <input id="keyName" placeholder="Nama Project" class="w-full bg-black/20 p-3 rounded-xl border border-white/10">
                        <div class="flex gap-2">
                            <label><input type="checkbox" class="perm" value="READ" checked> READ</label>
                            <label><input type="checkbox" class="perm" value="WRITE"> WRITE</label>
                            <label><input type="checkbox" class="perm" value="DELETE"> DELETE</label>
                        </div>
                        <button onclick="createKey()" class="w-full bg-emerald-600 p-3 rounded-xl font-bold">Generate Key</button>
                    </div>
                </div>
            </div>
            <div class="glass p-6 rounded-3xl">
                <h3 class="font-bold mb-4 text-red-500">Banned IPs (${db.bans.length})</h3>
                ${bannedIps || '<p class="text-gray-600">Gak ada IP diblokir.</p>'}
            </div>
        </div>
        <script>
            const mKey = () => localStorage.getItem('master_key') || prompt('Masukkan Master Key:');
            
            async function createKey() {
                const name = document.getElementById('keyName').value;
                const perms = Array.from(document.querySelectorAll('.perm:checked')).map(el => el.value);
                const res = await fetch('/api/admin/create-key', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ master: mKey(), name, perms })
                });
                const data = await res.json();
                if(data.key) {
                    localStorage.setItem('master_key', mKey());
                    Swal.fire({ title: 'Key Created!', text: data.key, icon: 'success', background: '#161b2c', color: '#fff' });
                }
            }

            async function unban(ip) {
                await fetch('/api/admin/unban', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ master: mKey(), ip })
                });
                location.reload();
            }
        </script>
    </body>
    </html>
    `);
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 DB Serverless God Mode on port ${PORT}`));
