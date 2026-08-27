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
            WITH ranked_bids AS (
                SELECT
                    id,
                    username,
                    image_url,
                    profile_url,
                    created_at,
                    clicks,
                    SUM(bid_amount) OVER (
                        PARTITION BY LOWER(username)
                    ) AS total_bid_amount,
                    COUNT(*) OVER (
                        PARTITION BY LOWER(username)
                    ) AS payment_count,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(username)
                        ORDER BY created_at DESC, id DESC
                    ) AS user_bid_rank
                FROM bids
                WHERE status = 'paid'
            )
            SELECT
                username,
                image_url,
                profile_url,
                total_bid_amount AS bid_amount,
                payment_count,
                created_at,
                clicks
            FROM ranked_bids
            WHERE user_bid_rank = 1
            ORDER BY bid_amount DESC, created_at DESC, id DESC
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

router.post('/:username/click', (req, res) => {
    const username = String(req.params.username || '').replace('@', '').trim();
    if (!/^[a-zA-Z0-9._]{1,30}$/.test(username)) return res.status(400).end();
    db.prepare(`UPDATE bids SET clicks = clicks + 1 WHERE id = (
        SELECT id FROM bids WHERE LOWER(username) = LOWER(?) AND status = 'paid'
        ORDER BY created_at DESC, id DESC LIMIT 1
    )`).run(username);
    res.status(204).end();
});

module.exports = router;
