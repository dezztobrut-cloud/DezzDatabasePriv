const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// Header HTTP
const ALIEN_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 QuantumBrowser/99.9';

// Script Suntikan: DevTools (Eruda) + Spek Alien
const SPOOF_SCRIPT = `
<script src="https://cdn.jsdelivr.net/npm/eruda"></script>
<script>
    eruda.init(); // DevTools aktif

    const customUA = '${ALIEN_USER_AGENT}';
    Object.defineProperty(navigator, 'userAgent', {get: () => customUA});
    Object.defineProperty(navigator, 'appVersion', {get: () => customUA});
    Object.defineProperty(navigator, 'vendor', {get: () => 'Apple Computer, Inc.'});
    Object.defineProperty(navigator, 'platform', {get: () => 'MacIntel'});
    Object.defineProperty(navigator, 'deviceMemory', {get: () => 2048}); 
    Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => 1024});

    const mockBattery = { level: 10.0, charging: true, chargingTime: 0, dischargingTime: Infinity, addEventListener: () => {} };
    Object.defineProperty(navigator, 'getBattery', { value: () => Promise.resolve(mockBattery) });
    
    if (navigator.permissions && navigator.permissions.query) {
        const originalQuery = navigator.permissions.query;
        navigator.permissions.query = (ext) => {
            if (ext.name === 'battery') return Promise.resolve({ state: 'granted', addEventListener: () => {} });
            return originalQuery.call(navigator.permissions, ext);
        };
    }

    Object.defineProperty(navigator, 'language', {get: () => 'ja-JP'});
    Object.defineProperty(navigator, 'languages', {get: () => ['ja-JP', 'ja', 'en-US', 'en']});
    Date.prototype.getTimezoneOffset = () => -540;
</script>
`;

app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px; background-color: #1a1a1a; color: #00ff00; padding: 50px; border-radius: 10px;">
            <h2>🛸 Alien Stealth Proxy (Full Nav Fix)</h2>
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

    // Kalau lu lupa ngetik http/https, otomatis ditambahin
    if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
    }

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

        if (contentType.includes('text/html')) {
            let htmlData = response.data.toString('utf-8');
            
            // Suntik Script & DevTools
            htmlData = htmlData.replace('<head>', '<head>' + SPOOF_SCRIPT);

            // LOGIKA URL REWRITER YANG UDAH DI-FIX
            htmlData = htmlData.replace(/(href|src|action)=["'](.*?)["']/gi, (match, attr, link) => {
                // Jangan utak-atik script bawaan browser atau anchor
                if (link.startsWith('data:') || link.startsWith('javascript:') || link.startsWith('#')) {
                    return match;
                }
                
                try {
                    // Ini mesin pintarnya: otomatis gabungin "phone.html" sama "https://domain.com"
                    const absoluteUrl = new URL(link, targetUrl).href;
                    
                    // Terus ubah jadinya gini -> /proxy?url=https://domain.com/phone.html
                    return `${attr}="/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
                } catch (e) {
                    return match; // Kalau URL-nya cacat dari sananya, biarin aja
                }
            });

            return res.send(htmlData);
        }

        res.send(response.data);

    } catch (error) {
        res.status(500).send('<h2 style="color:red;">Gagal ngakses web tujuan:</h2><p>' + error.message + '</p>');
    }
});

app.listen(PORT, () => {
    console.log("Alien Proxy nyala di http://localhost:" + PORT);
});
