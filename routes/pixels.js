const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { validateInstagramUser } = require('../services/instagramService');

router.get('/', async (req, res) => {
    try {
        const bids = db.prepare(`
            SELECT username, image_url, profile_url, bid_amount, created_at
            FROM bids WHERE status = 'paid'
            ORDER BY bid_amount DESC
        `).all();

        const fallbackBids = bids.filter((bid) => bid.image_url.includes('unavatar.io'));
        await Promise.all(fallbackBids.map(async (bid) => {
            const profile = await validateInstagramUser(bid.username);
            if (profile.valid && profile.profileImageUrl) {
                db.prepare(`UPDATE bids SET image_url = ? WHERE username = ? AND image_url LIKE '%unavatar.io%'`)
                    .run(profile.profileImageUrl, bid.username);
                bid.image_url = profile.profileImageUrl;
            }
        }));

        res.json(bids);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load bids.' });
    }
});

module.exports = router;
