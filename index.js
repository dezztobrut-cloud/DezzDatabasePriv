const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// Custom User-Agent lu di sini
const CUSTOM_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ProxyGua/1.0';

app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h2>Web Proxy Simple</h2>
            <form action="/proxy" method="GET">
                <input type="text" name="url" placeholder="Masukkan link (contoh: https://google.com)" style="width: 300px; padding: 10px;" required>
                <button type="submit" style="padding: 10px; cursor: pointer;">Maju Jalan!</button>
            </form>
        </div>
    `);
});

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('Mana URL-nya bro?');
    }

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': CUSTOM_USER_AGENT
            },
            responseType: 'arraybuffer'
        });

        res.set('Content-Type', response.headers['content-type']);
        res.send(response.data);
    } catch (error) {
        res.status(500).send('Waduh, gagal ngakses web tujuan: ' + error.message);
    }
});

app.listen(PORT, () => {
    console.log(\`Proxy lu udah jalan di http://localhost:\${PORT}\`);
});
