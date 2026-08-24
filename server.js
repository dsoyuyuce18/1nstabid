require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { db } = require('./db');

const app = express();

// in-memory online session tracker
const onlineSessions = new Map();

function cleanOnline() {
    const cutoff = Date.now() - 65000;
    for (const [id, ts] of onlineSessions) {
        if (ts < cutoff) onlineSessions.delete(id);
    }
}

app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
    res.json({ ok: true });
});

// Heartbeat — called every 30s from browser
app.post('/api/heartbeat', (req, res) => {
    const { sid } = req.body;
    if (sid && typeof sid === 'string' && sid.length < 64) {
        const isNew = !onlineSessions.has(sid);
        onlineSessions.set(sid, Date.now());
        if (isNew) db.prepare(`UPDATE stats SET value = value + 1 WHERE key = 'visitors'`).run();
    }
    cleanOnline();
    const visitors = db.prepare(`SELECT value FROM stats WHERE key='visitors'`).get()?.value ?? 0;
    res.json({ online: onlineSessions.size, visitors });
});

app.get('/api/stats', (req, res) => {
    cleanOnline();
    const visitors = db.prepare(`SELECT value FROM stats WHERE key='visitors'`).get()?.value ?? 0;
    res.json({ online: onlineSessions.size, visitors });
});

app.use('/api/bids', require('./routes/pixels'));
app.use('/api/payment', require('./routes/payment'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running: http://localhost:${PORT}`);
});
