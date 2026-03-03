const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));

// ==========================================
// DATABASE & HELPERS
// ==========================================
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE  = path.join(__dirname, 'internal_db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let _isFirstRun = false;
if (!fs.existsSync(DB_FILE)) {
    _isFirstRun = true;
    const masterKey = 'mk_' + crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(DB_FILE, JSON.stringify({
        keys:   {},
        bans:   [],
        frozen: {},
        config: { master_key: masterKey }
    }, null, 2));
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║           DEZZDB — FIRST RUN SETUP                       ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  Master Key: ' + masterKey + '  ║');
    console.log('║  Buka /admin dan masukkan key di atas                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
}

const getDB  = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const saveDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

const getIP = (req) => {
    const raw = (req.headers['x-forwarded-for'] || req.ip || '127.0.0.1').split(',')[0].trim();
    return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
};

const getNS = (key) => crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);

const sanitizeFilename = (name) => {
    if (!name || typeof name !== 'string') return null;
    const clean = name.replace(/[^a-zA-Z0-9_\-]/g, '').substring(0, 64);
    return clean.length ? clean : null;
};

// ==========================================
// SMART RATE LIMITER
// 0-10 req/s   → OK
// 10-100 req/s → Frozen 10 menit
// >100 req/s   → Banned permanen
// ==========================================
const reqLog = new Map(); // ip → [timestamps]

const smartRateLimit = (req, res, next) => {
    const ip = getIP(req);
    const now = Date.now();
    const skip = ['/', '/docs', '/admin', '/api/setup/info'].includes(req.path);
    if (skip) return next();

    const db = getDB();

    if (db.bans.includes(ip)) return res.status(403).json({ error: 'BANNED' });

    const frozenUntil = db.frozen[ip];
    if (frozenUntil) {
        if (now < frozenUntil) {
            return res.status(429).json({
                error: 'Account frozen',
                reason: 'Rate limit exceeded',
                retry_after_seconds: Math.ceil((frozenUntil - now) / 1000)
            });
        }
        delete db.frozen[ip];
        saveDB(db);
    }

    if (!reqLog.has(ip)) reqLog.set(ip, []);
    const log = reqLog.get(ip);
    const windowStart = now - 1000;
    while (log.length && log[0] < windowStart) log.shift();
    log.push(now);
    const rps = log.length;

    if (rps > 100) {
        if (!db.bans.includes(ip)) { db.bans.push(ip); saveDB(db); }
        reqLog.delete(ip);
        return res.status(403).json({ error: 'BANNED', reason: 'Extreme rate abuse (>100 req/s)' });
    }

    if (rps > 10) {
        db.frozen[ip] = now + 10 * 60 * 1000;
        saveDB(db);
        reqLog.delete(ip);
        return res.status(429).json({
            error: 'Account frozen',
            reason: 'Too many requests (>10 req/s)',
            retry_after_seconds: 600
        });
    }

    next();
};

app.use(smartRateLimit);

// Ban check middleware
app.use((req, res, next) => {
    if (['/', '/docs', '/admin'].includes(req.path)) return next();
    const db = getDB();
    const ip = getIP(req);
    if (db.bans.includes(ip)) return res.status(403).json({ error: 'BANNED' });
    next();
});

// ==========================================
// AUTH MIDDLEWARE
// ==========================================
const auth = (perm) => (req, res, next) => {
    const key = req.headers['x-api-key'] || req.query.key;
    if (!key) return res.status(401).json({ error: 'No API key provided' });
    const db = getDB();

    if (key === db.config.master_key) {
        req.is_admin = true;
        req.namespace = '__admin__';
        return next();
    }

    const k = db.keys[key];
    if (k && !k.revoked && k.perms.includes(perm)) {
        const frozenUntil = db.frozen[k.ip];
        if (frozenUntil && Date.now() < frozenUntil) {
            return res.status(429).json({ error: 'Account frozen', retry_after_seconds: Math.ceil((frozenUntil - Date.now()) / 1000) });
        }
        req.namespace = getNS(key);
        req.key_info = k;
        return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
};

// ==========================================
// API
// ==========================================

// IP auto-login: 1 IP = 1 key
app.post('/api/auth/ip-login', (req, res) => {
    const ip = getIP(req);
    const db = getDB();
    const existing = Object.entries(db.keys).find(([, v]) => v.ip === ip && !v.revoked);
    if (existing) {
        return res.json({ success: true, key: existing[0], name: existing[1].name, is_existing: true });
    }
    const key = 'dapd_' + crypto.randomBytes(5).toString('hex');
    db.keys[key] = { name: 'Project-' + ip.split('.').pop(), perms: ['READ','WRITE','DELETE'], revoked: false, ip, created_at: new Date().toISOString() };
    saveDB(db);
    res.json({ success: true, key, name: db.keys[key].name, is_existing: false });
});

// Create key manual (1 per IP)
app.post('/api/key/create', (req, res) => {
    const ip = getIP(req);
    const db = getDB();
    const existing = Object.entries(db.keys).find(([, v]) => v.ip === ip && !v.revoked);
    if (existing) return res.status(409).json({ error: 'IP ini sudah punya key aktif.' });
    const { name } = req.body;
    const cleanName = (name || 'Project').replace(/[<>"&]/g, '').substring(0, 32);
    const key = 'dapd_' + crypto.randomBytes(5).toString('hex');
    db.keys[key] = { name: cleanName, perms: ['READ','WRITE','DELETE'], revoked: false, ip, created_at: new Date().toISOString() };
    saveDB(db);
    res.json({ success: true, key });
});

app.get('/api/files', auth('READ'), (req, res) => {
    const dir = path.join(DATA_DIR, req.namespace);
    if (!fs.existsSync(dir)) return res.json([]);
    res.json(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
        const stat = fs.statSync(path.join(dir, f));
        return { name: f.replace('.json',''), size: (stat.size/1024).toFixed(2)+' KB', updated: stat.mtime.toISOString() };
    }));
});

app.get('/api/raw/:name', auth('READ'), (req, res) => {
    const safeName = sanitizeFilename(req.params.name);
    if (!safeName) return res.status(400).json({ error: 'Invalid filename' });
    const p = path.join(DATA_DIR, req.namespace, safeName + '.json');
    fs.existsSync(p) ? res.sendFile(p) : res.status(404).json({ error: 'Not Found' });
});

app.post('/api/save', auth('WRITE'), (req, res) => {
    const { filename, content } = req.body;
    const safeName = sanitizeFilename(filename);
    if (!safeName) return res.status(400).json({ error: 'Invalid filename. Use only a-z A-Z 0-9 - _' });
    const dir = path.join(DATA_DIR, req.namespace);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
        const out = JSON.stringify(parsed, null, 2);
        if (Buffer.byteLength(out) > 1024*1024) return res.status(413).json({ error: 'File terlalu besar (max 1MB)' });
        fs.writeFileSync(path.join(dir, safeName+'.json'), out);
        res.json({ success: true });
    } catch(e) { res.status(400).json({ error: 'Invalid JSON format' }); }
});

app.delete('/api/delete/:name', auth('DELETE'), (req, res) => {
    const safeName = sanitizeFilename(req.params.name);
    if (!safeName) return res.status(400).json({ error: 'Invalid filename' });
    const p = path.join(DATA_DIR, req.namespace, safeName+'.json');
    fs.existsSync(p) ? (fs.unlinkSync(p), res.json({ success: true })) : res.status(404).json({ error: 'Not Found' });
});

app.get('/api/admin/stats', auth('READ'), (req, res) => {
    if (!req.is_admin) return res.sendStatus(403);
    const db = getDB();
    const now = Date.now();
    res.json({
        total_keys: Object.keys(db.keys).length,
        active: Object.values(db.keys).filter(k=>!k.revoked).length,
        frozen_count: Object.values(db.frozen).filter(ts=>ts>now).length,
        keys: Object.entries(db.keys).map(([k,v]) => ({
            key_preview: k.substring(0,12)+'...',
            name: v.name, revoked: v.revoked, ip: v.ip, created_at: v.created_at,
            frozen_until: db.frozen[v.ip]&&db.frozen[v.ip]>now ? new Date(db.frozen[v.ip]).toISOString() : null
        })),
        bans: db.bans,
        frozen: Object.fromEntries(Object.entries(db.frozen).filter(([,ts])=>ts>now))
    });
});

app.post('/api/admin/ban', auth('READ'), (req, res) => {
    if (!req.is_admin) return res.sendStatus(403);
    const { ip } = req.body;
    if (!ip || !/^[\d.:a-fA-F]+$/.test(ip)) return res.status(400).json({ error: 'Invalid IP' });
    const db = getDB();
    if (!db.bans.includes(ip)) db.bans.push(ip);
    saveDB(db); res.json({ success: true });
});

app.post('/api/admin/unban', auth('READ'), (req, res) => {
    if (!req.is_admin) return res.sendStatus(403);
    const db = getDB();
    db.bans = db.bans.filter(b => b !== req.body.ip);
    saveDB(db); res.json({ success: true });
});

app.post('/api/admin/unfreeze', auth('READ'), (req, res) => {
    if (!req.is_admin) return res.sendStatus(403);
    const db = getDB();
    delete db.frozen[req.body.ip];
    saveDB(db); res.json({ success: true });
});

app.post('/api/admin/revoke', auth('READ'), (req, res) => {
    if (!req.is_admin) return res.sendStatus(403);
    const db = getDB();
    if (db.keys[req.body.key]) { db.keys[req.body.key].revoked = true; saveDB(db); }
    res.json({ success: true });
});

// ==========================================
// UI TEMPLATE
// ==========================================
const UI = (body, title = 'DezzDB') => `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.2/ace.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#07070a;--s1:#0e0e14;--s2:#141419;--b1:#1c1c26;--b2:#262636;
  --tx:#ddddef;--mu:#52526e;--ac:#7c6dfa;--ac2:#a594ff;
  --gr:#1bf8a0;--rd:#ff4d6d;--yw:#ffbe0b;
  --r:13px;--rL:20px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{font-family:'Syne',sans-serif;background:var(--bg);color:var(--tx);min-height:100vh;-webkit-tap-highlight-color:transparent;overflow-x:hidden}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-thumb{background:var(--b2);border-radius:9px}
.c{max-width:1020px;margin:0 auto;padding:0 16px}
a{color:var(--ac);text-decoration:none}

/* NAV */
nav{position:sticky;top:0;z-index:90;background:rgba(7,7,10,.88);backdrop-filter:blur(16px);border-bottom:1px solid var(--b1)}
.nav-i{display:flex;justify-content:space-between;align-items:center;padding:14px 0}
.logo{font-size:18px;font-weight:800;letter-spacing:-.5px;color:#fff}
.logo span{color:var(--ac)}
.logo sub{font-size:9px;font-weight:700;letter-spacing:2px;color:var(--mu);text-transform:uppercase;vertical-align:middle;margin-left:5px}
.nav-r{display:flex;gap:8px;align-items:center}

/* BUTTONS */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 18px;border-radius:10px;font-family:'Syne',sans-serif;font-size:12px;font-weight:700;cursor:pointer;border:none;transition:all .15s;outline:none;white-space:nowrap}
.btn:active{transform:scale(.96)}
.btn-p{background:var(--ac);color:#fff}
.btn-p:hover{background:var(--ac2);box-shadow:0 0 22px rgba(124,109,250,.32)}
.btn-g{background:transparent;color:var(--tx);border:1px solid var(--b2)}
.btn-g:hover{border-color:var(--ac);color:var(--ac)}
.btn-d{background:rgba(255,77,109,.08);color:var(--rd);border:1px solid rgba(255,77,109,.18)}
.btn-d:hover{background:rgba(255,77,109,.16)}
.btn-sm{padding:6px 12px;font-size:11px;border-radius:8px}
.btn-xs{padding:4px 9px;font-size:10px;border-radius:7px}
.btn-full{width:100%}
.btn-pill{border-radius:99px;padding:13px 30px;font-size:13px}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none!important}

/* INPUTS */
.inp{background:var(--s2);border:1px solid var(--b2);color:var(--tx);border-radius:10px;padding:10px 13px;font-family:'Syne',sans-serif;font-size:13px;width:100%;outline:none;transition:border .15s}
.inp:focus{border-color:var(--ac)}
.inp::placeholder{color:var(--mu)}
.inp.mono{font-family:'JetBrains Mono',monospace;font-size:12px}
.fl{display:block;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--mu);margin-bottom:6px}
.fg{margin-bottom:16px}
.hint{font-size:10px;color:var(--mu);margin-top:5px;line-height:1.6}

/* MODAL */
.ov{position:fixed;inset:0;background:rgba(0,0,0,.78);backdrop-filter:blur(12px);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;pointer-events:none;transition:opacity .2s}
.ov.show{opacity:1;pointer-events:all}
.modal{background:var(--s1);border:1px solid var(--b2);border-radius:var(--rL);width:100%;max-width:560px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;transform:translateY(18px) scale(.98);transition:transform .22s cubic-bezier(.34,1.4,.64,1)}
.ov.show .modal{transform:translateY(0) scale(1)}
.mh{padding:18px 22px;border-bottom:1px solid var(--b1);display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
.mh-t{font-size:14px;font-weight:800;color:#fff}
.mb{padding:20px 22px;overflow-y:auto;flex:1}
.mf{padding:14px 22px;border-top:1px solid var(--b1);display:flex;gap:8px;justify-content:flex-end;flex-shrink:0}
.xb{background:none;border:none;color:var(--mu);cursor:pointer;font-size:18px;line-height:1;padding:3px 7px;border-radius:6px}
.xb:hover{color:var(--tx);background:var(--b1)}

/* CARDS */
.card{background:var(--s1);border:1px solid var(--b1);border-radius:var(--r)}
.card2{background:var(--s2);border:1px solid var(--b2);border-radius:var(--r)}

/* HERO */
.hero{text-align:center;padding:68px 12px 52px;display:flex;flex-direction:column;align-items:center;gap:22px}
.badge{display:inline-flex;align-items:center;gap:7px;background:var(--s2);border:1px solid var(--b2);border-radius:99px;padding:6px 14px;font-size:10px;font-weight:700;color:var(--mu);letter-spacing:1.5px;text-transform:uppercase}
.dot{width:6px;height:6px;border-radius:50%;background:var(--gr);box-shadow:0 0 8px var(--gr);flex-shrink:0;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.disp{font-size:clamp(36px,7.5vw,68px);font-weight:800;letter-spacing:-3px;line-height:1.02;color:#fff}
.disp em{font-style:normal;color:var(--ac)}
.lead{font-size:clamp(13px,2.4vw,15px);color:var(--mu);line-height:1.75;max-width:440px}
.hero-btns{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}

/* IP BANNER */
.ip-banner{background:linear-gradient(135deg,rgba(27,248,160,.05),rgba(124,109,250,.05));border:1px solid rgba(124,109,250,.18);border-radius:14px;padding:13px 17px;display:flex;align-items:center;gap:12px;margin-bottom:18px}
.ipb-i{font-size:22px;flex-shrink:0}
.ipb-t{flex:1;min-width:0}
.ipb-t strong{font-size:13px;color:#fff;display:block;margin-bottom:1px}
.ipb-t span{font-size:10px;color:var(--mu)}

/* DASHBOARD */
.dh{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap}
.dh-l h2{font-size:20px;font-weight:800;color:#fff;letter-spacing:-.5px}
.dh-l p{font-size:10px;color:var(--mu);margin-top:2px}
.dh-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.kchip{display:flex;align-items:center;gap:7px;background:var(--s2);border:1px solid var(--b2);border-radius:9px;padding:7px 11px;cursor:pointer;max-width:240px;min-width:0;transition:border .15s}
.kchip:hover{border-color:var(--ac)}
.kchip code{font-size:10px;font-family:'JetBrains Mono',monospace;color:var(--mu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}

/* STATS */
.srow{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:9px;margin-bottom:18px}
.sc{padding:13px 15px;border-radius:12px;background:var(--s1);border:1px solid var(--b1)}
.sn{font-size:26px;font-weight:800;color:#fff;letter-spacing:-1px}
.sl{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--mu);margin-top:2px}

/* FILE GRID */
.fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.fc{padding:15px 17px;border-radius:14px;background:var(--s1);border:1px solid var(--b1);transition:all .15s}
.fc:hover{border-color:var(--b2);transform:translateY(-2px)}
.fcn{font-size:12px;font-weight:700;color:#fff;font-family:'JetBrains Mono',monospace;word-break:break-all;margin-bottom:3px}
.fcm{font-size:9px;color:var(--mu);margin-bottom:11px}
.fca{display:flex;gap:5px}

/* EMPTY */
.empty{text-align:center;padding:52px 16px;color:var(--mu)}
.empty-i{font-size:34px;margin-bottom:10px;opacity:.3}
.empty h3{font-size:14px;font-weight:700;margin-bottom:4px}
.empty p{font-size:11px;opacity:.6}

/* TOAST */
.tc{position:fixed;bottom:20px;right:20px;z-index:999;display:flex;flex-direction:column;gap:6px;pointer-events:none;max-width:270px}
.toast{background:var(--s2);border:1px solid var(--b2);border-radius:11px;padding:9px 13px;font-size:11px;font-weight:700;display:flex;align-items:center;gap:8px;transform:translateX(calc(100% + 28px));transition:transform .3s cubic-bezier(.34,1.56,.64,1);pointer-events:all}
.toast.show{transform:translateX(0)}
.tok{border-left:3px solid var(--gr)}
.ter{border-left:3px solid var(--rd)}
.tin{border-left:3px solid var(--ac)}
.twn{border-left:3px solid var(--yw)}

/* ACE */
#ace-ed{height:260px;width:100%;border-radius:10px;overflow:hidden;border:1px solid var(--b2)}

/* TAGS */
.tag{display:inline-flex;align-items:center;font-size:9px;font-weight:700;padding:3px 8px;border-radius:99px;letter-spacing:1px;text-transform:uppercase}
.tg{background:rgba(27,248,160,.1);color:var(--gr);border:1px solid rgba(27,248,160,.2)}
.tr{background:rgba(255,77,109,.1);color:var(--rd);border:1px solid rgba(255,77,109,.2)}
.tp{background:rgba(124,109,250,.1);color:var(--ac);border:1px solid rgba(124,109,250,.2)}
.ty{background:rgba(255,190,11,.1);color:var(--yw);border:1px solid rgba(255,190,11,.2)}

/* CODE BLOCK */
.cb{background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:14px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#a5b4fc;line-height:1.9;overflow-x:auto;white-space:pre;tab-size:2}
.cb .cm{color:var(--mu)}
.hr{border:none;border-top:1px solid var(--b1);margin:28px 0}

/* IP item */
.ii{display:flex;justify-content:space-between;align-items:center;padding:9px 11px;background:var(--s2);border:1px solid var(--b1);border-radius:9px;font-size:10px;font-family:'JetBrains Mono',monospace;gap:8px}

/* RESPONSIVE */
@media(max-width:580px){
  .dh{flex-direction:column;align-items:stretch}
  .dh-r{justify-content:space-between}
  .kchip{max-width:100%;flex:1}
  .tc{left:16px;right:16px;bottom:16px;max-width:unset}
  .fgrid{grid-template-columns:1fr 1fr}
}
@media(max-width:360px){.fgrid{grid-template-columns:1fr}}
</style>
</head>
<body>
${body}
<div class="tc" id="TC"></div>
<script>
function toast(msg,type='in',dur=3200){
  const el=document.createElement('div');
  el.className='toast t'+type;
  el.innerHTML='<span>'+(type==='ok'?'✓':type==='er'?'✕':type==='wn'?'⚠':'i')+'</span><span>'+msg+'</span>';
  document.getElementById('TC').appendChild(el);
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('show')));
  setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),400)},dur);
}
function copy(t,l='Copied!'){navigator.clipboard.writeText(t).then(()=>toast(l,'ok')).catch(()=>toast('Copy failed','er'))}
function om(id){document.getElementById(id).classList.add('show')}
function cm(id){document.getElementById(id).classList.remove('show')}
document.addEventListener('click',e=>{if(e.target.classList.contains('ov'))cm(e.target.id)})
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
</script>
</body>
</html>`;

// ==========================================
// PAGES
// ==========================================
app.get('/', (req, res) => {
    res.send(UI(`
<nav><div class="c"><div class="nav-i">
  <div class="logo">Dezz<span>DB</span><sub>Pro</sub></div>
  <div class="nav-r">
    <a href="/docs" class="btn btn-g btn-sm">Docs</a>
    <button class="btn btn-p btn-sm" onclick="om('enterModal')">Dashboard</button>
  </div>
</div></div></nav>
<main class="c">
  <div id="vLanding">
    <section class="hero">
      <div class="badge"><div class="dot"></div>Online &amp; Ready</div>
      <h1 class="disp">JSON Storage<br><em>Serius.</em></h1>
      <p class="lead">Namespace otomatis, REST API penuh, isolasi per key. Login 1-klik via IP — 1 IP, 1 key, ga bisa spam.</p>
      <div class="hero-btns">
        <button onclick="tryAutoLogin()" class="btn btn-p btn-pill" id="btnAuto">⚡ Auto Login via IP</button>
        <a href="/docs" class="btn btn-g btn-pill">Docs</a>
      </div>
    </section>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:10px;margin-bottom:48px">
      ${[['🔐','Namespace Isolation','Tiap key = namespace sendiri. Data kamu aman.'],['⚡','IP Auto Login','1 IP = 1 key otomatis. Cegah spam account.'],['🛡️','Smart Rate Limit','≤10 ok · 10-100 frozen 10m · >100 banned.'],['📝','JSON Editor','Edit langsung dari browser dengan syntax highlight.']]
      .map(([ic,ti,de])=>`<div class="card" style="padding:17px;cursor:default"><div style="font-size:19px;margin-bottom:9px">${ic}</div><div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:4px">${ti}</div><div style="font-size:11px;color:var(--mu);line-height:1.55">${de}</div></div>`).join('')}
    </div>
  </div>

  <div id="vDash" style="display:none;padding-top:18px">
    <div id="ipBanner" class="ip-banner" style="display:none">
      <div class="ipb-i">⚡</div>
      <div class="ipb-t"><strong id="ipBMsg">Auto-logged in!</strong><span id="ipBSub"></span></div>
      <button class="btn btn-g btn-sm" onclick="doLogout()">Logout</button>
    </div>
    <div class="dh">
      <div class="dh-l"><h2 id="dName">Files</h2><p id="dSub">—</p></div>
      <div class="dh-r">
        <div class="kchip" onclick="copy(window._K,'API key copied!')">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          <code id="kPrev">—</code>
          <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </div>
        <button onclick="openNew()" class="btn btn-p btn-sm">+ New</button>
        <button onclick="doLogout()" class="btn btn-g btn-sm" id="logBtn">Logout</button>
      </div>
    </div>
    <div id="fgrid" class="fgrid"><div class="empty"><div class="empty-i">⏳</div><h3>Loading...</h3></div></div>
  </div>
</main>

<!-- Enter key modal -->
<div class="ov" id="enterModal">
  <div class="modal">
    <div class="mh"><span class="mh-t">Masukkan API Key</span><button class="xb" onclick="cm('enterModal')">✕</button></div>
    <div class="mb">
      <div class="fg"><label class="fl">API Key</label><input type="password" id="inpKey" class="inp mono" placeholder="dapd_..." autocomplete="off" onkeydown="if(event.key==='Enter')doEnter()"></div>
      <p class="hint">Atau <a href="#" onclick="cm('enterModal');tryAutoLogin();return false">login otomatis via IP</a></p>
    </div>
    <div class="mf"><button class="btn btn-g" onclick="cm('enterModal')">Batal</button><button class="btn btn-p" onclick="doEnter()">Masuk →</button></div>
  </div>
</div>

<!-- Key result modal -->
<div class="ov" id="krModal">
  <div class="modal">
    <div class="mh"><span class="mh-t">🎉 Key Dibuat!</span></div>
    <div class="mb">
      <p class="hint" style="margin-bottom:11px">Simpan key ini — <strong style="color:var(--rd)">tidak bisa dilihat lagi!</strong></p>
      <div class="card2" style="padding:13px;margin-bottom:11px"><code id="nkTxt" style="font-size:12px;color:var(--ac);font-family:'JetBrains Mono',monospace;word-break:break-all">—</code></div>
      <button onclick="copy(document.getElementById('nkTxt').innerText,'Key copied!')" class="btn btn-g btn-full btn-sm">⎘ Copy Key</button>
    </div>
    <div class="mf"><button class="btn btn-p" onclick="afterCreate()">Buka Dashboard →</button></div>
  </div>
</div>

<!-- File editor modal -->
<div class="ov" id="fModal">
  <div class="modal" style="max-width:680px">
    <div class="mh"><span class="mh-t" id="fmT">New File</span><button class="xb" onclick="cm('fModal')">✕</button></div>
    <div class="mb">
      <div class="fg">
        <label class="fl">Filename</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input type="text" id="fmNm" class="inp mono" placeholder="users" maxlength="64" style="flex:1">
          <span style="font-size:11px;color:var(--mu);font-family:'JetBrains Mono',monospace;flex-shrink:0">.json</span>
        </div>
        <p class="hint">a-z A-Z 0-9 - _ saja · max 64 char</p>
      </div>
      <div class="fg" style="margin-bottom:0"><label class="fl">Content (JSON)</label><div id="ace-ed"></div></div>
    </div>
    <div class="mf"><button class="btn btn-g" onclick="cm('fModal')">Batal</button><button class="btn btn-p" id="fmSv" onclick="doSave()">Simpan</button></div>
  </div>
</div>

<script>
let _K=sessionStorage.getItem('dzk')||localStorage.getItem('dzk'), _ace=null, _nk=null, _auto=false;
function sk(k){window._K=k;sessionStorage.setItem('dzk',k);localStorage.setItem('dzk',k)}
function ck(){window._K=null;sessionStorage.removeItem('dzk');localStorage.removeItem('dzk')}
if(_K) verifyKey(_K);

async function verifyKey(k){
  try{
    const r=await fetch('/api/files',{headers:{'x-api-key':k}});
    if(!r.ok){ck();return;}
    showDash('My Files',true,false);
  }catch(e){ck();}
}

async function tryAutoLogin(){
  const btn=document.getElementById('btnAuto');
  btn.disabled=true;btn.textContent='Detecting...';
  try{
    const r=await fetch('/api/auth/ip-login',{method:'POST',headers:{'Content-Type':'application/json'}});
    const d=await r.json();
    if(!d.success)throw 0;
    sk(d.key);_auto=true;
    showDash(d.name,d.is_existing,true);
  }catch(e){
    toast('Auto login gagal','er');
    btn.disabled=false;btn.innerHTML='⚡ Auto Login via IP';
  }
}

function showDash(name,exist,banner){
  document.getElementById('vLanding').style.display='none';
  document.getElementById('vDash').style.display='block';
  document.getElementById('dName').textContent=name||'My Files';
  const k=window._K||'';
  document.getElementById('kPrev').textContent=k.substring(0,14)+'...'+k.slice(-4);
  document.getElementById('dSub').textContent='NS: '+k.substring(5,13)+'...';
  if(banner){
    document.getElementById('ipBanner').style.display='flex';
    document.getElementById('ipBMsg').textContent=exist?'⚡ Auto-login berhasil!':'🎉 Project baru dibuat!';
    document.getElementById('ipBSub').textContent=exist?'Dikenali dari IP kamu.':'IP kamu otomatis terdaftar.';
    document.getElementById('logBtn').style.display='none';
  }
  loadFiles();
}

function doLogout(){ck();location.reload()}

async function doEnter(){
  const key=document.getElementById('inpKey').value.trim();
  if(!key){toast('Masukkan API key','er');return;}
  const r=await fetch('/api/files',{headers:{'x-api-key':key}});
  if(!r.ok){toast('API key tidak valid','er');return;}
  sk(key);cm('enterModal');showDash('My Files',true,false);
}

async function loadFiles(){
  const g=document.getElementById('fgrid');
  g.innerHTML='<div class="empty"><div class="empty-i">⏳</div><h3>Loading...</h3></div>';
  try{
    const r=await fetch('/api/files',{headers:{'x-api-key':window._K}});
    if(r.status===429){const d=await r.json();toast('Frozen · sisa '+d.retry_after_seconds+'s','wn',5000);return;}
    if(!r.ok){toast('Gagal load files','er');return;}
    const files=await r.json();
    if(!files.length){g.innerHTML='<div class="empty"><div class="empty-i">📂</div><h3>Belum ada file</h3><p>Klik "+ New" untuk mulai</p></div>';return;}
    g.innerHTML=files.map(f=>{
      const dt=new Date(f.updated).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'2-digit'});
      return \`<div class="fc"><div class="fcn">\${esc(f.name)}.json</div><div class="fcm">\${f.size} · \${dt}</div><div class="fca"><button class="btn btn-g btn-xs" onclick="openEdit('\${esc(f.name)}')">✎ Edit</button><button class="btn btn-d btn-xs" onclick="doDel('\${esc(f.name)}')">✕</button></div></div>\`;
    }).join('');
  }catch(e){toast('Error','er');}
}

function initAce(){
  if(_ace)return;
  _ace=ace.edit("ace-ed");
  _ace.setTheme("ace/theme/tomorrow_night");
  _ace.session.setMode("ace/mode/json");
  _ace.setOptions({fontSize:"12px",showPrintMargin:false,tabSize:2,useSoftTabs:true});
}

function openNew(){
  document.getElementById('fmT').textContent='New File';
  document.getElementById('fmNm').value='';
  document.getElementById('fmNm').readOnly=false;
  initAce();_ace.setValue(JSON.stringify({status:"ok",data:[]},null,2),-1);
  om('fModal');
}

async function openEdit(name){
  document.getElementById('fmT').textContent='Edit · '+name+'.json';
  document.getElementById('fmNm').value=name;
  document.getElementById('fmNm').readOnly=true;
  initAce();
  try{
    const r=await fetch('/api/raw/'+encodeURIComponent(name),{headers:{'x-api-key':window._K}});
    _ace.setValue(JSON.stringify(await r.json(),null,2),-1);
  }catch(e){_ace.setValue('{}');}
  om('fModal');
}

async function doSave(){
  const nm=document.getElementById('fmNm').value.trim();
  if(!nm){toast('Isi nama file','er');return;}
  const btn=document.getElementById('fmSv');btn.disabled=true;btn.textContent='Saving...';
  try{
    const r=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':window._K},body:JSON.stringify({filename:nm,content:_ace.getValue()})});
    const d=await r.json();
    if(!r.ok){toast(d.error||'Gagal','er');return;}
    cm('fModal');toast('Tersimpan ✓','ok');loadFiles();
  }catch(e){toast('Error','er');}
  finally{btn.disabled=false;btn.textContent='Simpan';}
}

async function doDel(name){
  if(!confirm('Hapus "'+name+'.json"?'))return;
  const r=await fetch('/api/delete/'+encodeURIComponent(name),{method:'DELETE',headers:{'x-api-key':window._K}});
  r.ok?( toast('Dihapus','ok'),loadFiles()):toast('Gagal hapus','er');
}

function afterCreate(){
  if(!_nk)return;sk(_nk);cm('krModal');_auto=false;showDash('My Project',false,false);
}
</script>
`));
});

app.get('/docs', (req, res) => {
    res.send(UI(`
<nav><div class="c"><div class="nav-i">
  <div class="logo">Dezz<span>DB</span><sub>Pro</sub></div>
  <div class="nav-r"><a href="/" class="btn btn-g btn-sm">← Back</a></div>
</div></div></nav>
<div class="c" style="max-width:700px;padding-top:40px;padding-bottom:60px">
  <p style="font-size:9px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:var(--mu);margin-bottom:10px">Developer Docs</p>
  <h1 style="font-size:clamp(26px,5vw,42px);font-weight:800;color:#fff;letter-spacing:-1.5px;margin-bottom:10px">Integration Guide.</h1>
  <p style="font-size:13px;color:var(--mu);margin-bottom:28px">Semua endpoint + contoh kode.</p>
  <hr class="hr">
  <section style="margin-bottom:28px"><h3 style="font-size:13px;font-weight:800;color:#fff;margin-bottom:9px">Auth Header</h3><div class="cb">x-api-key: dapd_xxxxxxxxxx
Content-Type: application/json</div></section>
  <section style="margin-bottom:28px"><h3 style="font-size:13px;font-weight:800;color:#fff;margin-bottom:11px">Endpoints</h3><div style="display:flex;flex-direction:column;gap:7px">
    ${[['GET','/api/files','List files'],['GET','/api/raw/:name','Baca file'],['POST','/api/save','Simpan file'],['DELETE','/api/delete/:name','Hapus file'],['POST','/api/key/create','Buat key (1/IP)'],['POST','/api/auth/ip-login','Auto-login via IP']].map(([m,p,d])=>`<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--s1);border:1px solid var(--b1);border-radius:10px"><span class="tag ${m==='GET'?'tg':m==='POST'?'tp':'tr'}">${m}</span><span style="font-family:'JetBrains Mono',monospace;font-size:11px;flex:1">${p}</span><span style="font-size:10px;color:var(--mu)">${d}</span></div>`).join('')}
  </div></section>
  <section style="margin-bottom:28px"><h3 style="font-size:13px;font-weight:800;color:#fff;margin-bottom:11px">Rate Limit</h3><div style="display:flex;flex-direction:column;gap:7px">
    ${[['tg','≤ 10 req/s','Normal'],['ty','10–100 req/s','Frozen 10 menit'],['tr','> 100 req/s','Banned permanen']].map(([t,r,d])=>`<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--s1);border:1px solid var(--b1);border-radius:10px"><span class="tag ${t}">${r}</span><span style="font-size:11px;color:var(--mu)">${d}</span></div>`).join('')}
  </div></section>
  <section style="margin-bottom:28px"><h3 style="font-size:13px;font-weight:800;color:#fff;margin-bottom:9px">Node.js</h3><div class="cb"><span class="cm">// npm install axios</span>
const axios = require('axios');
const BASE = 'https://your-server.com';
const H    = { 'x-api-key': 'dapd_xxxxxxxxxx' };

const get  = n  => axios.get(\`\${BASE}/api/raw/\${n}\`, {headers:H}).then(r=>r.data);
const save = (n,d) => axios.post(\`\${BASE}/api/save\`, {filename:n,content:d}, {headers:H});
const del  = n  => axios.delete(\`\${BASE}/api/delete/\${n}\`, {headers:H});</div></section>
  <section style="margin-bottom:28px"><h3 style="font-size:13px;font-weight:800;color:#fff;margin-bottom:9px">Python</h3><div class="cb"><span class="cm"># pip install requests</span>
import requests
H = {'x-api-key': 'dapd_xxxxxxxxxx', 'Content-Type': 'application/json'}
BASE = 'https://your-server.com'
data = requests.get(f'{BASE}/api/raw/users', headers=H).json()
requests.post(f'{BASE}/api/save', json={'filename':'users','content':data}, headers=H)</div></section>
  <section><h3 style="font-size:13px;font-weight:800;color:#fff;margin-bottom:9px">Aturan Filename</h3><div class="cb">✓  users · bot_data-v2 · config_2024
✗  ../etc/passwd  (path traversal → BLOCKED)
✗  file.json      (titik tidak diizinkan)
✗  nama spasi     (spasi tidak diizinkan)

Max: 64 karakter · Max size file: 1MB</div></section>
</div>`, 'DezzDB — Docs'));
});

app.get('/admin', (req, res) => {
    res.send(UI(`
<nav><div class="c"><div class="nav-i">
  <div class="logo">Dezz<span>DB</span> <span style="font-size:9px;font-weight:700;letter-spacing:2px;color:var(--rd);text-transform:uppercase;margin-left:6px">Admin</span></div>
  <div class="nav-r"><button class="btn btn-g btn-sm" onclick="doOut()">Logout</button></div>
</div></div></nav>
<div class="c" style="padding-top:28px;padding-bottom:60px">
  <div id="vL" style="max-width:360px;margin:60px auto">
    <h2 style="font-size:22px;font-weight:800;color:#fff;margin-bottom:4px">Control Tower</h2>
    <p style="font-size:12px;color:var(--mu);margin-bottom:20px">Masukkan master key.</p>
    <div class="fg"><input type="password" id="mki" class="inp mono" placeholder="mk_..." autocomplete="off" onkeydown="if(event.key==='Enter')doIn()"></div>
    <button onclick="doIn()" class="btn btn-p btn-full">Masuk</button>
  </div>
  <div id="vA" style="display:none">
    <div class="srow" id="aS"></div>
    <div style="margin-bottom:14px">
      <p style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--yw);margin-bottom:9px">⏳ Frozen IPs</p>
      <div id="frL" style="display:flex;flex-direction:column;gap:6px"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" id="aGrid">
      <div class="card" style="padding:17px">
        <p style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--rd);margin-bottom:11px">🚫 Banned IPs</p>
        <div id="bL" style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;margin-bottom:11px"></div>
        <div style="display:flex;gap:7px"><input type="text" id="bI" class="inp mono" placeholder="1.2.3.4" style="font-size:11px"><button onclick="doBan()" class="btn btn-d btn-sm" style="flex-shrink:0">Ban</button></div>
      </div>
      <div class="card" style="padding:17px">
        <p style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--ac);margin-bottom:11px">🔑 API Keys</p>
        <div id="kL" style="display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto"></div>
      </div>
    </div>
  </div>
</div>
<style>@media(max-width:540px){#aGrid{grid-template-columns:1fr!important}}</style>
<script>
let MK=sessionStorage.getItem('amk');
if(MK)load();
async function doIn(){
  MK=document.getElementById('mki').value.trim();
  if(!MK)return;
  const r=await fetch('/api/admin/stats',{headers:{'x-api-key':MK}});
  if(!r.ok){toast('Master key salah','er');MK=null;return;}
  sessionStorage.setItem('amk',MK);load();
}
async function load(){
  const r=await fetch('/api/admin/stats',{headers:{'x-api-key':MK}});
  if(!r.ok){sessionStorage.removeItem('amk');MK=null;return;}
  const d=await r.json();
  document.getElementById('vL').style.display='none';
  document.getElementById('vA').style.display='block';
  document.getElementById('aS').innerHTML=\`
    <div class="sc"><div class="sn">\${d.total_keys}</div><div class="sl">Keys</div></div>
    <div class="sc"><div class="sn">\${d.active}</div><div class="sl">Active</div></div>
    <div class="sc"><div class="sn" style="color:var(--yw)">\${d.frozen_count}</div><div class="sl">Frozen</div></div>
    <div class="sc"><div class="sn" style="color:var(--rd)">\${d.bans.length}</div><div class="sl">Banned</div></div>
  \`;
  const fe=Object.entries(d.frozen||{});
  document.getElementById('frL').innerHTML=fe.length
    ?fe.map(([ip,ts])=>\`<div class="ii"><span>\${ip}</span><span style="color:var(--yw)">\${Math.ceil((new Date(ts)-Date.now())/1000)}s</span><button class="btn btn-g btn-xs" onclick="unfreeze('\${ip}')">Unfreeze</button></div>\`).join('')
    :'<p style="font-size:10px;color:var(--mu)">Tidak ada</p>';
  document.getElementById('bL').innerHTML=d.bans.length
    ?d.bans.map(ip=>\`<div class="ii"><span style="flex:1">\${ip}</span><button class="btn btn-g btn-xs" onclick="unban('\${ip}')">Unban</button></div>\`).join('')
    :'<p style="font-size:10px;color:var(--mu)">Kosong</p>';
  document.getElementById('kL').innerHTML=d.keys.length
    ?d.keys.map(k=>\`<div class="ii" style="flex-wrap:wrap;gap:4px"><div style="flex:1;min-width:110px"><div style="color:var(--tx)">\${esc(k.name)}</div><div style="color:var(--mu);font-size:9px">\${k.key_preview} · \${k.ip||'?'}</div>\${k.frozen_until?'<div style="color:var(--yw);font-size:9px">❄ Frozen</div>':''}</div><span class="tag \${k.revoked?'tr':'tg'}">\${k.revoked?'Revoked':'Active'}</span></div>\`).join('')
    :'<p style="font-size:10px;color:var(--mu)">Kosong</p>';
}
async function doBan(){
  const ip=document.getElementById('bI').value.trim();
  if(!ip){toast('Masukkan IP','er');return;}
  const r=await fetch('/api/admin/ban',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':MK},body:JSON.stringify({ip})});
  if(r.ok){document.getElementById('bI').value='';toast('Banned','ok');load();}else toast('Gagal','er');
}
async function unban(ip){
  const r=await fetch('/api/admin/unban',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':MK},body:JSON.stringify({ip})});
  if(r.ok){toast('Unbanned','ok');load();}
}
async function unfreeze(ip){
  const r=await fetch('/api/admin/unfreeze',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':MK},body:JSON.stringify({ip})});
  if(r.ok){toast('Unfrozen','ok');load();}
}
function doOut(){sessionStorage.removeItem('amk');MK=null;location.reload()}
</script>
`, 'DezzDB Admin'));
});

// ==========================================
// START — default port 3001, bisa di-override
// ==========================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log('\n🚀 DezzDB Pro aktif di port ' + PORT);
    console.log('   → http://localhost:' + PORT);
    console.log('   → http://localhost:' + PORT + '/admin');
    console.log('   → http://localhost:' + PORT + '/docs\n');
});
