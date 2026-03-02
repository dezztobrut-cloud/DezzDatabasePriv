const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// Header HTTP
const ALIEN_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 QuantumBrowser/99.9';

// SCRIPT SUNTIKAN LEVEL INTI (PROTOTYPE BYPASS)
const SPOOF_SCRIPT = `
<script src="https://cdn.jsdelivr.net/npm/eruda"></script>
<script>
    eruda.init(); // DevTools aktif

    // --- 1. IDENTITAS ABNORMAL ---
    const customUA = '${ALIEN_USER_AGENT}';
    Object.defineProperty(navigator, 'userAgent', {get: () => customUA});
    Object.defineProperty(navigator, 'appVersion', {get: () => customUA});
    Object.defineProperty(navigator, 'vendor', {get: () => 'Alien Tech Inc.'});
    Object.defineProperty(navigator, 'platform', {get: () => 'MacIntel'});
    
    // --- 2. HANCURKAN ADRENO 610 (GPU SPOOF LEVEL PROTOTYPE) ---
    try {
        const getParamProxy = function(original) {
            return function(param) {
                if (param === 37445) return 'Alien GPU Corporation'; // VENDOR
                if (param === 37446) return 'RTX 9090 Ti Quantum Super'; // RENDERER
                return original.apply(this, arguments);
            };
        };
        if (window.WebGLRenderingContext) {
            WebGLRenderingContext.prototype.getParameter = getParamProxy(WebGLRenderingContext.prototype.getParameter);
        }
        if (window.WebGL2RenderingContext) {
            WebGL2RenderingContext.prototype.getParameter = getParamProxy(WebGL2RenderingContext.prototype.getParameter);
        }
    } catch(e) {}

    // --- 3. LAYAR & SENTUHAN GAK NGOTAK ---
    // Ubah resolusi layar ke 32768 x 18432 dan warna ke 256-bit
    Object.defineProperty(Screen.prototype, 'width', {get: () => 32768});
    Object.defineProperty(Screen.prototype, 'height', {get: () => 18432});
    Object.defineProperty(Screen.prototype, 'availWidth', {get: () => 32768});
    Object.defineProperty(Screen.prototype, 'availHeight', {get: () => 18432});
    Object.defineProperty(Screen.prototype, 'colorDepth', {get: () => 256});
    Object.defineProperty(Screen.prototype, 'pixelDepth', {get: () => 256});
    
    // Sentuhan 999 Jari
    Object.defineProperty(navigator, 'maxTouchPoints', {get: () => 999});

    // --- 4. HARDWARE, JARINGAN & STORAGE DEWA ---
    Object.defineProperty(navigator, 'deviceMemory', {get: () => 2048}); 
    Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => 1024});
    
    // Jaringan 6G Speed 999999 Mbps
    const mockConnection = { effectiveType: '6g', downlink: 999999, rtt: 0, saveData: false, type: 'wifi' };
    Object.defineProperty(navigator, 'connection', {get: () => mockConnection});

    // Storage API Bypass (Memori Kuota Unlimited)
    if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate = () => Promise.resolve({ quota: 999999999999999, usage: 100 });
    }

    // --- 5. BATERAI & PLUGINS ---
    const mockBattery = { level: 10.0, charging: true, chargingTime: 0, dischargingTime: Infinity, addEventListener: () => {} };
    Object.defineProperty(navigator, 'getBattery', { value: () => Promise.resolve(mockBattery) });
    
    // Nipu Active Plugins biar kebaca ada "Quantum Hologram"
    const fakePlugins = [
        { name: 'Quantum Engine', description: 'Alien Renderer', filename: 'quantum.plugin' },
        { name: 'Hologram Emitter', description: '3D Projection', filename: 'holo.plugin' },
        { name: 'Neural Link API', description: 'Brain-Computer Interface', filename: 'neural.dll' }
    ];
    Object.defineProperty(navigator, 'plugins', {get: () => fakePlugins});

    // --- 6. DRM WIDEVINE SPOOF ---
    if (navigator.requestMediaKeySystemAccess) {
        const originalRequest = navigator.requestMediaKeySystemAccess;
        navigator.requestMediaKeySystemAccess = function(keySystem, config) {
            if (keySystem === 'com.widevine.alpha') {
                return Promise.resolve({
                    keySystem: 'com.widevine.alpha',
                    getConfiguration: () => config[0]
                });
            }
            return originalRequest.apply(this, arguments);
        };
    }

    // --- 7. SENSOR LAINNYA ---
    Object.defineProperty(navigator, 'language', {get: () => 'ja-JP'});
    Object.defineProperty(navigator, 'languages', {get: () => ['ja-JP', 'ja', 'en-US', 'en']});
    Date.prototype.getTimezoneOffset = () => -540;
</script>
`;

app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px; background-color: #1a1a1a; color: #00ff00; padding: 50px; border-radius: 10px;">
            <h2>🛸 Alien Stealth Proxy (Abnormal Spec)</h2>
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
            
            // Logika baru: Cari tag <head> walaupun pake huruf besar atau ada atribut
            htmlData = htmlData.replace(/<head[^>]*>/i, (match) => match + SPOOF_SCRIPT);

            htmlData = htmlData.replace(/(href|src|action)=["'](.*?)["']/gi, (match, attr, link) => {
                if (link.startsWith('data:') || link.startsWith('javascript:') || link.startsWith('#')) {
                    return match;
                }
                try {
                    const absoluteUrl = new URL(link, targetUrl).href;
                    return `${attr}="/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
                } catch (e) {
                    return match;
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
