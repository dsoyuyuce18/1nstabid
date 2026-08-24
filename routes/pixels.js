const express = require('express');
const router = express.Router();
const { db } = require('../db');

router.get('/', (req, res) => {
    try {
        const bids = db.prepare(`
            SELECT username, image_url, profile_url, bid_amount, created_at
            FROM bids WHERE status = 'paid'
            ORDER BY bid_amount DESC
        `).all();
        res.json(bids);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load bids.' });
    }
});

module.exports = router;
