const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { validateInstagramUser } = require('../services/instagramService');
const { syncRecentlyPaidBids } = require('./payment');

router.get('/', async (req, res) => {
    try {
        // Keep the public list in sync with Stripe before returning it. This
        // prevents a confirmed bid from disappearing on the browser's next
        // 30-second leaderboard refresh when requests reach another instance.
        try {
            await syncRecentlyPaidBids();
        } catch (err) {
            // Stripe being temporarily unavailable must not hide the existing
            // leaderboard entries stored in the database.
            console.error('Could not sync recent paid bids before loading leaderboard:', err.message);
        }

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
