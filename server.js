const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// --- KONFIGURASI ---
const MASTER_KEY = 'dezz-admin-rahasia'; // GANTI INI!
const DATA_DIR = path.join(__dirname, 'data');
const KEYS_FILE = path.join(__dirname, 'keys.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, JSON.stringify({}));

// --- DATABASE HELPER ---
const getKeys = () => JSON.parse(fs.readFileSync(KEYS_FILE));
const saveKeys = (keys) => fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));

// --- SECURITY & LIMITER ---
const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { error: 'Terlalu banyak request. Coba lagi nanti.' }
});

const auth = (req, res, next) => {
    const userKey = req.headers['x-api-key'];
    const keys = getKeys();
    if (userKey === MASTER_KEY) return next();
    if (keys[userKey] && !keys[userKey].revoked) return next();
    res.status(401).json({ error: 'API Key Ilegal atau sudah di-Revoke!' });
};

// --- API ENDPOINTS ---
app.post('/api/key/generate', publicLimiter, (req, res) => {
    const newKey = `dezz_${crypto.randomBytes(8).toString('hex')}`;
    const keys = getKeys();
    keys[newKey] = {
        ip: req.ip,
        createdAt: new Date().toISOString(),
        revoked: false
    };
    saveKeys(keys);
    res.json({ success: true, key: newKey });
});

app.post('/api/key/revoke', (req, res) => {
    if (req.headers['x-api-key'] !== MASTER_KEY) return res.status(403).send('Forbidden');
    const { targetKey } = req.body;
    const keys = getKeys();
    if (keys[targetKey]) {
        keys[targetKey].revoked = true;
        saveKeys(keys);
        res.json({ success: true, message: `Key ${targetKey} dicabut!` });
    } else {
        res.status(404).json({ error: 'Key gak ketemu.' });
    }
});

app.post('/api/db/:nama', auth, (req, res) => {
    fs.writeFileSync(path.join(DATA_DIR, `${req.params.nama}.json`), JSON.stringify(req.body, null, 2));
    res.json({ success: true });
});

app.get('/api/db/:nama', auth, (req, res) => {
    const p = path.join(DATA_DIR, `${req.params.nama}.json`);
    if (fs.existsSync(p)) res.json(JSON.parse(fs.readFileSync(p)));
    else res.status(404).json({ error: 'Data kosong.' });
});

// --- UI JOKO-STYLE ---
app.get('/', (req, res) => {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dezz DB | JokoUI</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
        <style>body { font-family: 'Plus Jakarta Sans', sans-serif; background: #0b0f1a; }</style>
    </head>
    <body class="text-gray-200 p-6">
        <div class="max-w-5xl mx-auto">
            <nav class="flex justify-between items-center mb-12 bg-[#161b2c] p-5 rounded-2xl border border-gray-800 shadow-2xl">
                <h1 class="text-xl font-800 tracking-tighter text-white">DEZZ<span class="text-blue-500">DB.</span></h1>
                <div class="flex gap-4">
                    <button onclick="generateKey()" class="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-blue-500/20">Get API Key</button>
                </div>
            </nav>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div class="lg:col-span-2 space-y-8">
                    <div class="bg-gradient-to-br from-blue-600/20 to-purple-600/10 p-10 rounded-[2rem] border border-blue-500/20 shadow-inner">
                        <h2 class="text-4xl font-800 text-white mb-4 leading-tight">Build faster <br>with JSON storage.</h2>
                        <p class="text-gray-400 mb-8 max-w-md">Database minimalis untuk project lu. Support Per-IP Key, Auto Backup, dan tampilan JokoUI.</p>
                        <div class="bg-black/60 p-5 rounded-2xl font-mono text-sm text-blue-400 border border-white/5 shadow-2xl">
                            <span class="text-gray-500">// Simpan data</span><br>
                            POST /api/db/project-gua<br>
                            x-api-key: YOUR_KEY
                        </div>
                    </div>

                    <div class="bg-[#161b2c] p-8 rounded-[2rem] border border-gray-800">
                        <h3 class="text-lg font-bold mb-6 text-white flex items-center gap-2">
                            <span class="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
                            Interactive Docs
                        </h3>
                        <div class="space-y-6">
                            <div class="group border-l-2 border-blue-500/30 hover:border-blue-500 pl-6 transition-all">
                                <p class="text-sm font-bold text-blue-400 uppercase tracking-widest">Generate Key</p>
                                <p class="text-xs text-gray-500 mt-1 italic">POST /api/key/generate (No Auth)</p>
                            </div>
                            <div class="group border-l-2 border-emerald-500/30 hover:border-emerald-500 pl-6 transition-all">
                                <p class="text-sm font-bold text-emerald-400 uppercase tracking-widest">Store Data</p>
                                <p class="text-xs text-gray-500 mt-1 italic">POST /api/db/:name (Need Auth)</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="space-y-6">
                    <div class="bg-[#161b2c] p-8 rounded-[2rem] border border-gray-800 shadow-xl">
                        <h3 class="text-xs font-bold text-gray-500 uppercase tracking-[0.2em] mb-6 text-center">Active Storage</h3>
                        <div class="space-y-3">
                            ${files.length > 0 ? files.map(f => `
                                <div class="flex justify-between items-center bg-black/40 p-4 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-all">
                                    <span class="text-sm text-gray-300 font-mono font-semibold">${f.replace('.json', '')}</span>
                                    <span class="text-[10px] bg-blue-500/20 text-blue-400 px-3 py-1 rounded-full font-bold">JSON</span>
                                </div>
                            `).join('') : '<p class="text-center text-gray-600 text-sm py-4 italic">No data yet.</p>'}
                        </div>
                        <a href="/backup" class="block text-center mt-8 text-xs text-gray-500 hover:text-blue-400 underline underline-offset-4">Download All Backup (.zip)</a>
                    </div>
                </div>
            </div>
        </div>

        <script>
            async function generateKey() {
                const res = await fetch('/api/key/generate', { method: 'POST' });
                const data = await res.json();
                if(data.key) {
                    prompt('COPY & SIMPAN KEY INI BRO (Jangan sampe ilang):', data.key);
                } else {
                    alert('Limit tercapai. Coba beberapa menit lagi.');
                }
            }
        </script>
    </body>
    </html>
    `);
});

app.get('/backup', (req, res) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    res.attachment(`backup-${Date.now()}.zip`);
    archive.pipe(res);
    archive.directory(DATA_DIR, false);
    archive.finalize();
});

const PORT = 3000;
app.listen(PORT, () => console.log(`✅ Serverless DB ready on port ${PORT}`));
