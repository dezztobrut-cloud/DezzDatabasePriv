const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// Header HTTP
const ALIEN_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 QuantumBrowser/99.9';

// Script Suntikan: DevTools (Eruda) + Spek Alien + Bypass Restricted API
const SPOOF_SCRIPT = `
<script src="https://cdn.jsdelivr.net/npm/eruda"></script>
<script>
    // 1. Inisialisasi Dev Tools (Muncul icon gear melayang di pojok layar)
    eruda.init();

    const customUA = '${ALIEN_USER_AGENT}';
    Object.defineProperty(navigator, 'userAgent', {get: () => customUA});
    Object.defineProperty(navigator, 'appVersion', {get: () => customUA});
    Object.defineProperty(navigator, 'vendor', {get: () => 'Apple Computer, Inc.'});
    Object.defineProperty(navigator, 'platform', {get: () => 'MacIntel'});
    Object.defineProperty(navigator, 'deviceMemory', {get: () => 2048}); 
    Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => 1024});

    // 2. Bypass Battery & Permissions Restricted
    const mockBattery = { level: 10.0, charging: true, chargingTime: 0, dischargingTime: Infinity, addEventListener: () => {} };
    Object.defineProperty(navigator, 'getBattery', { value: () => Promise.resolve(mockBattery) });
    
    // Nipu izin browser biar dikira ngizinin akses baterai
    if (navigator.permissions && navigator.permissions.query) {
        const originalQuery = navigator.permissions.query;
        navigator.permissions.query = (ext) => {
            if (ext.name === 'battery') return Promise.resolve({ state: 'granted', addEventListener: () => {} });
            return originalQuery.call(navigator.permissions, ext);
        };
    }

    // 3. Sensor Tambahan
    Object.defineProperty(navigator, 'language', {get: () => 'ja-JP'});
    Object.defineProperty(navigator, 'languages', {get: () => ['ja-JP', 'ja', 'en-US', 'en']});
    Date.prototype.getTimezoneOffset = () => -540;
</script>
`;

app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px; background-color: #1a1a1a; color: #00ff00; padding: 50px; border-radius: 10px;">
            <h2>🛸 Alien Stealth Proxy (Full Nav & DevTools)</h2>
            <form action="/proxy" method="GET">
                <input type="text" name="url" placeholder="Contoh: https://deviceinfo.me" style="width: 350px; padding: 10px; border-radius: 5px; border: none;" required>
                <button type="submit" style="padding: 10px; cursor: pointer; background-color: #00ff00; color: #000; font-weight: bold; border-radius: 5px; border: none;">Teleportasi!</button>
            </form>
        </div>
        <style>body { background-color: #0d0d0d; }</style>
    `);
});

app.get('/proxy', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL-nya masukin dulu bro!');

    // Tambahin https:// kalau lu lupa ngetik
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': ALIEN_USER_AGENT,
                'Accept-Language': 'ja-JP,ja;q=0.9',
                'X-Forwarded-For': '103.1.200.0'
            },
            responseType: 'arraybuffer',
            validateStatus: () => true 
        });

        const contentType = response.headers['content-type'] || '';
        res.set('Content-Type', contentType);

        // 4. Logika URL Rewriter (Biar bisa pindah halaman & CSS kebaca)
        if (contentType.includes('text/html')) {
            let htmlData = response.data.toString('utf-8');
            
            // Suntik DevTools dan Sensor
            htmlData = htmlData.replace('<head>', '<head>' + SPOOF_SCRIPT);

            // Parsing URL asli
            const targetObj = new URL(targetUrl);
            const baseOrigin = targetObj.origin;
            const basePath = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

            // Regex buat ngubah semua href="" dan src="" biar lewat proxy kita
            htmlData = htmlData.replace(/(href|src|action)=["'](.*?)["']/gi, (match, attr, link) => {
                // Biarin aja kalau linknya cuma format data/javascript
                if (link.startsWith('data:') || link.startsWith('javascript:') || link.startsWith('#')) return match;
                
                let absoluteLink = link;
                if (link.startsWith('//')) {
                    absoluteLink = 'https:' + link;
                } else if (link.startsWith('/')) {
                    absoluteLink = baseOrigin + link;
                } else if (!link.startsWith('http')) {
                    absoluteLink = basePath + link;
                }
                
                // Belokkan link target ke sistem proxy kita
                return `${attr}="/proxy?url=${encodeURIComponent(absoluteLink)}"`;
            });

            return res.send(htmlData);
        }

        // Kalau yang diakses murni file CSS/Gambar/JS, kirim langsung
        res.send(response.data);

    } catch (error) {
        res.status(500).send('<h2 style="color:red;">Gagal ngakses web tujuan:</h2><p>' + error.message + '</p>');
    }
});

app.listen(PORT, () => {
    console.log("Alien Proxy nyala di http://localhost:" + PORT);
});
