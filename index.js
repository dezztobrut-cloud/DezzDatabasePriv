const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// SUNTIKAN DEVTOOLS LEVEL DEWA (ERUDA + ALL PLUGINS)
const DEVTOOLS_SCRIPT = `
<script src="https://cdn.jsdelivr.net/npm/eruda"></script>

<script src="https://cdn.jsdelivr.net/npm/eruda-fps"></script>
<script src="https://cdn.jsdelivr.net/npm/eruda-features"></script>
<script src="https://cdn.jsdelivr.net/npm/eruda-timing"></script>
<script src="https://cdn.jsdelivr.net/npm/eruda-memory"></script>
<script src="https://cdn.jsdelivr.net/npm/eruda-code"></script>
<script src="https://cdn.jsdelivr.net/npm/eruda-touches"></script>

<script>
    // Inisialisasi Core
    eruda.init(); 

    // Inject Semua Plugin Dewa
    eruda.add(erudaFps);       // Pantau Frame Per Second & performa render
    eruda.add(erudaFeatures);  // Cek dukungan fitur browser target
    eruda.add(erudaTiming);    // Bedah waktu load network & resource (Wajib buat bypass)
    eruda.add(erudaMemory);    // Lacak kebocoran memori (Memory Leak) target
    eruda.add(erudaCode);      // Editor JS tingkat lanjut langsung di dalam browser
    eruda.add(erudaTouches);   // Visualisasi sentuhan layar untuk debug event listener

    // Pamer dikit di Console target
    console.log("%c[DEZZ AI INJECTION PROTOCOL AKTIF]", "color: #00ff00; font-size: 18px; font-weight: bold; background: #000; padding: 10px; border-radius: 5px;");
    console.log("%c🔥 DevTools Supercharged berhasil disuntikkan ke jantung website target! 🔥", "color: #ff0000; font-size: 14px; font-weight: bold;");
</script>
`;

app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: monospace; text-align: center; margin-top: 50px; background-color: #0a0a0a; color: #00ffcc; padding: 50px; border-radius: 10px; border: 1px solid #00ffcc; box-shadow: 0 0 20px #00ffcc55;">
            <h2 style="text-transform: uppercase; letter-spacing: 2px;">👁️ DevTools Injector (God-Mode)</h2>
            <p style="color: #888;">Masukkan URL target untuk dibedah anatominya.</p>
            <form action="/proxy" method="GET">
                <input type="text" name="url" placeholder="https://target-web.com" style="width: 80%; max-width: 400px; padding: 12px; border-radius: 5px; border: 1px solid #00ffcc; background: #111; color: #fff; outline: none;" required>
                <br><br>
                <button type="submit" style="padding: 12px 30px; cursor: pointer; background-color: #00ffcc; color: #000; font-weight: bold; font-size: 16px; border-radius: 5px; border: none; text-transform: uppercase; transition: 0.3s;">Suntik DevTools!</button>
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            responseType: 'arraybuffer',
            validateStatus: () => true 
        });

        const contentType = response.headers['content-type'] || '';
        res.set('Content-Type', contentType);

        if (contentType.includes('text/html')) {
            let htmlData = response.data.toString('utf-8');
            
            // Suntik paksa tepat setelah tag <head> atau di awal jika tidak ada <head>
            if (/<head[^>]*>/i.test(htmlData)) {
                htmlData = htmlData.replace(/<head[^>]*>/i, (match) => match + DEVTOOLS_SCRIPT);
            } else {
                htmlData = DEVTOOLS_SCRIPT + htmlData;
            }

            // Rewrite URL biar tetap stay di proxy kita
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
        res.status(500).send('<h2 style="color:red; font-family: monospace;">[FATAL ERROR] Gagal nembus web tujuan:</h2><p style="color: #fff;">' + error.message + '</p>');
    }
});

app.listen(PORT, () => {
    console.log("🔥 INJECTOR NYALA Boss! Akses di http://localhost:" + PORT);
});
