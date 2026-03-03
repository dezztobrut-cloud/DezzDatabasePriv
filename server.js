const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const app = express();
app.use(express.json());

// --- KONFIGURASI ---
const API_KEY = 'kunci-rahasia-vps-gua'; // GANTI INI NANTI
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// --- MIDDLEWARE API KEY ---
const cekApiKey = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (key === API_KEY) {
        next();
    } else {
        res.status(401).json({ error: 'Akses Ditolak! API Key salah.' });
    }
};

// --- ENDPOINT API ---
// Simpan/Update Data JSON (POST)
app.post('/api/db/:nama_db', cekApiKey, (req, res) => {
    const dbName = req.params.nama_db;
    const filePath = path.join(DATA_DIR, `${dbName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2));
    res.json({ success: true, message: `Database '${dbName}' tersimpan!` });
});

// Ambil Data JSON (GET)
app.get('/api/db/:nama_db', cekApiKey, (req, res) => {
    const dbName = req.params.nama_db;
    const filePath = path.join(DATA_DIR, `${dbName}.json`);
    if (fs.existsSync(filePath)) {
        res.json(JSON.parse(fs.readFileSync(filePath)));
    } else {
        res.status(404).json({ error: 'Database tidak ditemukan!' });
    }
});

// --- WEB DASHBOARD & BACKUP ---
app.get('/', (req, res) => {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    let html = `
        <div style="font-family: sans-serif; padding: 20px;">
            <h1>📊 Dashboard Database Lokal</h1>
            <p>Total Database JSON: <b>${files.length}</b></p>
            <ul>${files.map(f => `<li>${f}</li>`).join('')}</ul>
            <br>
            <a href="/backup" style="padding: 10px; background: #007bff; color: white; text-decoration: none; border-radius: 5px;">📦 Download Backup (.zip)</a>
        </div>
    `;
    res.send(html);
});

app.get('/backup', (req, res) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    res.attachment(`backup-database-${Date.now()}.zip`);
    archive.pipe(res);
    archive.directory(DATA_DIR, false);
    archive.finalize();
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`✅ Server nyala di port ${PORT}`);
});
