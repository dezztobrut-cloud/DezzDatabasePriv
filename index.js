const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// Header HTTP untuk Bypass Ringan
const ALIEN_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 QuantumBrowser/99.9';

// SUNTIKAN DEVTOOLS LEVEL DEWA + INTERCEPTOR TOTAL
const DEVTOOLS_SCRIPT = `
<script src="https://cdn.jsdelivr.net/npm/eruda"></script>
<script src="https://cdn.jsdelivr.net/npm/eruda-code"></script>
<script src="https://cdn.jsdelivr.net/npm/eruda-dom"></script>

<script>
    eruda.init(); 
    try { eruda.add(erudaCode); } catch(e) {}

    // 1. WEBSOCKET INTERCEPTOR
    const OrigWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        console.log('%c[WS] Saluran terbuka ke: ' + url, 'color: #00ffff; font-weight: bold;');
        const ws = new OrigWebSocket(url, protocols);
        ws.addEventListener('message', function(e) {
            console.log('%c[WS TARGET MEMBALAS]', 'color: #00ff00', e.data);
        });
        const origSend = ws.send;
        ws.send = function(data) {
            console.log('%c[WS DATA DIKIRIM KELUAR]', 'color: #ff0000', data);
            origSend.apply(this, arguments);
        };
        return ws;
    };

    // 2. API FETCH SNIFFER
    const origFetch = window.fetch;
    window.fetch = async function() {
        console.log('%c[API CALL DETECTED]', 'color: #ffaa00; font-weight: bold;', arguments);
        return origFetch.apply(this, arguments);
    };

    // 3. KEYSTROKE INTERCEPTOR (SADAP KETIKAN LOKAL)
    window.addEventListener('keydown', function(e) {
        if(e.key.length === 1) {
            console.log('%c[KEYSTROKE INTERCEPTED]', 'color: #ff3333; font-weight: bold; background: #220000; padding: 2px;', e.key);
        }
    });

    // 4. FORM HIJACKER (CEGAT SUBMIT DATA)
    document.addEventListener('submit', function(e) {
        e.preventDefault(); 
        const formData = new FormData(e.target);
        const dataBajakan = {};
        for (let [key, value] of formData.entries()) {
            dataBajakan[key] = value;
        }
        console.log('%c[🔥 DATA FORM DICEGAT 🔥]', 'color: #ffffff; background: #ff0000; font-weight: bold; padding: 5px;');
        console.table(dataBajakan);
        alert('Form dicegat! Data mentah terekam di Console Eruda!');
    });

    // 5. DATA DUMPER & X-RAY SCANNER (VIA ERUDA SNIPPETS)
    window.ekstrakDataTuan = function() {
        console.log('Cookies:', document.cookie);
        console.log('LocalStorage:', localStorage);
        alert('Data Storage dibongkar di Console!');
    };

    window.bongkarRahasia = function() {
        document.querySelectorAll('*').forEach(el => {
            const style = window.getComputedStyle(el);
            if(style.display === 'none' || style.visibility === 'hidden') {
                el.style.display = 'block';
                el.style.visibility = 'visible';
                el.style.border = '2px dashed red';
            }
        });
    };

    setTimeout(() => {
        if(eruda.get('snippets')) {
            eruda.get('snippets').add('💥 EKSTRAK DATA LOKAL', 'Kuras Cookies & Storage', window.ekstrakDataTuan);
            eruda.get('snippets').add('👁️ X-RAY ELEMEN', 'Paksa muncul form hidden', window.bongkarRahasia);
        }
    }, 1000);

    console.log("%c[DEZZ SYSTEM AKTIF - BUKA CONSOLE ERUDA SEKARANG!]", "color: #00ff00; font-weight: bold; border: 1px solid #00ff00; padding: 10px;");
</script>
`;

// ROUTING EXPRESS SERVER
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: monospace; text-align: center; margin-top: 50px; background-color: #0a0a0a; color: #00ffcc; padding: 50px; border-radius: 10px; border: 1px solid #00ffcc;">
            <h2>👁️ DEZZ DEEP INSPECTOR</h2>
            <form action="/proxy" method="GET">
                <input type="text" name="url" placeholder="https://target-web.com" style="width: 300px; padding: 10px;" required>
                <button type="submit" style="padding: 10px; background-color: #00ffcc; color: #000; font-weight: bold;">SUNTIK WEB!</button>
            </form>
        </div>
        <style>body { background-color: #050505; color: white; }</style>
    `);
});

app.get('/proxy', async (req, res) => {
    let targetUrl = req.query.url;
    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

    try {
        const response = await axios.get(targetUrl, {
            headers: { 'User-Agent': ALIEN_USER_AGENT },
            responseType: 'arraybuffer',
            validateStatus: () => true 
        });

        const contentType = response.headers['content-type'] || '';
        res.set('Content-Type', contentType);

        if (contentType.includes('text/html')) {
            let htmlData = response.data.toString('utf-8');
            
            // Suntik paksa script Dezz ke dalam web target
            if (/<head[^>]*>/i.test(htmlData)) {
                htmlData = htmlData.replace(/<head[^>]*>/i, match => match + DEVTOOLS_SCRIPT);
            } else {
                htmlData = DEVTOOLS_SCRIPT + htmlData;
            }

            // Rewrite URL link biar ga kabur dari proxy
            htmlData = htmlData.replace(/(href|src|action)=["'](.*?)["']/gi, (match, attr, link) => {
                if (link.startsWith('data:') || link.startsWith('javascript:') || link.startsWith('#')) return match;
                try {
                    const absoluteUrl = new URL(link, targetUrl).href;
                    return `${attr}="/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
                } catch (e) { return match; }
            });

            return res.send(htmlData);
        }
        res.send(response.data);
    } catch (error) {
        res.status(500).send('<h2>[ERROR] Gagal akses web: ' + error.message + '</h2>');
    }
});

app.listen(PORT, () => {
    console.log("🔥 DEZZ INSPECTOR NYALA Boss! Akses di http://localhost:" + PORT);
});
