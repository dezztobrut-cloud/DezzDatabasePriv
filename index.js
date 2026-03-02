const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// Header HTTP
const ALIEN_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 QuantumBrowser/99.9';

// SUNTIKAN DEVTOOLS LEVEL DEWA (ERUDA + DEEP INSPECTOR)
const DEVTOOLS_SCRIPT = `
<script src="https://cdn.jsdelivr.net/npm/eruda"></script>
<script src="https://cdn.jsdelivr.net/npm/eruda-code"></script>
<script src="https://cdn.jsdelivr.net/npm/eruda-dom"></script>

<script>
    eruda.init(); 
    try { eruda.add(erudaCode); } catch(e) {}

    // --- 1. WEBSOCKET INTERCEPTOR ---
    const OrigWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        console.log('%c[WS] Saluran terbuka ke: ' + url, 'color: #00ffff; font-weight: bold;');
        const ws = new OrigWebSocket(url, protocols);
        ws.addEventListener('message', function(e) {
            console.log('%c[WS TARGET MEMBALAS]', 'color: #00ff00', e.data);
        });
        const origSend = ws.send;
        ws.send = function(data) {
            console.log('%c[WS DATA KITA DIKIRIM]', 'color: #ff0000', data);
            origSend.apply(this, arguments);
        };
        return ws;
    };

    // --- 2. API FETCH SNIFFER ---
    const origFetch = window.fetch;
    window.fetch = async function() {
        console.log('%c[API CALL DETECTED]', 'color: #ffaa00; font-weight: bold;', arguments);
        return origFetch.apply(this, arguments);
    };

    // --- 3. GOD-MODE DATA DUMPER ---
    window.ekstrakDataTuan = function() {
        console.log('%c[MENGURAS COOKIES KLIEN]', 'color: #ff00ff; font-size: 14px;', document.cookie);
        console.log('%c[MENGURAS LOCAL STORAGE]', 'color: #ff00ff; font-size: 14px;', localStorage);
        console.log('%c[MENGURAS SESSION STORAGE]', 'color: #ff00ff; font-size: 14px;', sessionStorage);
        alert('Data Storage & Cookie sesi ini sudah dibongkar di Console, Boss!');
    };

    // --- 4. DOM X-RAY SCANNER ---
    window.bongkarRahasia = function() {
        let count = 0;
        document.querySelectorAll('*').forEach(el => {
            const style = window.getComputedStyle(el);
            if(style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                el.style.display = 'block';
                el.style.visibility = 'visible';
                el.style.opacity = '1';
                el.style.border = '2px dashed red';
                el.style.backgroundColor = 'rgba(255,0,0,0.1)';
                count++;
            }
        });
        console.log('%c[DOM X-RAY] ' + count + ' ELEMEN RAHASIA DIBONGKAR!', 'color: red; font-size: 16px; font-weight: bold;');
    };

    // --- 5. INJECT KE ERUDA MENU ---
    setTimeout(() => {
        if(eruda.get('snippets')) {
            eruda.get('snippets').add('💥 EKSTRAK DATA CLIENT', 'Kuras Cookies & Storage sesi ini', window.ekstrakDataTuan);
            eruda.get('snippets').add('👁️ X-RAY ELEMEN WEB', 'Paksa muncul semua form/elemen hidden', window.bongkarRahasia);
        }
    }, 1000);

    console.log("%c[DEZZ DEEP INSPECTOR AKTIF - BUKA TAB SNIPPETS DI ERUDA!]", "color: #00ff00; font-size: 16px; font-weight: bold; border: 1px solid #00ff00; padding: 10px;");
</script>
`;

app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: monospace; text-align: center; margin-top: 50px; background-color: #0a0a0a; color: #00ffcc; padding: 50px; border-radius: 10px; border: 1px solid #00ffcc; box-shadow: 0 0 20px #00ffcc55;">
            <h2 style="text-transform: uppercase; letter-spacing: 2px;">👁️ Deep Web Inspector</h2>
            <form action="/proxy" method="GET">
                <input type="text" name="url" placeholder="https://target-web.com" style="width: 80%; max-width: 400px; padding: 12px; border-radius: 5px; border: 1px solid #00ffcc; background: #111; color: #fff; outline: none;" required>
                <br><br>
                <button type="submit" style="padding: 12px 30px; cursor: pointer; background-color: #00ffcc; color: #000; font-weight: bold; font-size: 16px; border-radius: 5px; border: none; text-transform: uppercase;">Bedah Web!</button>
            </form>
        </div>
        <style>body { background-color: #050505; margin: 0; padding: 20px; display: flex; justify-content: center; }</style>
    `);
});

app.get('/proxy', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL-nya masukin dulu Boss!');

    if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
    }

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': ALIEN_USER_AGENT,
                'Accept-Language': 'en-US,en;q=0.9',
            },
            responseType: 'arraybuffer',
            validateStatus: () => true 
        });

        const contentType = response.headers['content-type'] || '';
        res.set('Content-Type', contentType);

        if (contentType.includes('text/html')) {
            let htmlData = response.data.toString('utf-8');
            
            if (/<head[^>]*>/i.test(htmlData)) {
                htmlData = htmlData.replace(/<head[^>]*>/i, (match) => match + DEVTOOLS_SCRIPT);
            } else {
                htmlData = DEVTOOLS_SCRIPT + htmlData;
            }

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
        res.status(500).send('<h2 style="color:red;">[FATAL ERROR] Gagal nembus web tujuan:</h2><p>' + error.message + '</p>');
    }
});

app.listen(PORT, () => {
    console.log("🔥 INJECTOR NYALA Boss! Akses di http://localhost:" + PORT);
});
