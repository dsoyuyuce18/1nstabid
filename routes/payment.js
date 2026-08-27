const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { db, cleanupPending } = require('../db');
const { validateInstagramUser, validateTikTokUser } = require('../services/instagramService');

const INSTAGRAM_USERNAME_RE = /^[a-zA-Z0-9._]{1,30}$/;
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
    storage: multer.diskStorage({
        destination: uploadDir,
        filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype))
});

router.post('/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Please choose a JPG, PNG, WebP, or GIF image.' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

function bidDetailsFromSession(session) {
    const username = String(session.metadata?.username || '').replace('@', '').trim();
    const platform = session.metadata?.platform === 'tiktok' ? 'tiktok' : 'instagram';
    const bidAmount = Number(session.metadata?.bid_amount || session.amount_total);

    if (!/^[a-zA-Z0-9._]{1,30}$/.test(username) || !Number.isInteger(bidAmount) || bidAmount < 100) {
        return null;
    }

    return {
        username,
        bidAmount,
        email: session.customer_details?.email || session.customer_email || null,
        platform,
        imageUrl: session.metadata?.image_url || `https://unavatar.io/${platform}/${username}`,
        profileUrl: platform === 'tiktok' ? `https://tiktok.com/@${username}` : `https://instagram.com/${username}`
    };
}

function recordPaidSession(session) {
    if (session.payment_status !== 'paid') return null;

    const bid = bidDetailsFromSession(session);
    if (!bid) {
        console.error(`Could not restore paid Checkout Session ${session.id}: missing or invalid bid metadata.`);
        return null;
    }

    const paidAt = session.created ? new Date(session.created * 1000).toISOString().slice(0, 19).replace('T', ' ') : null;
    db.prepare(`
        INSERT INTO bids (
            username, image_url, profile_url, bid_amount, platform,
            stripe_session_id, status, email, paid_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, COALESCE(?, CURRENT_TIMESTAMP))
        ON CONFLICT(stripe_session_id) DO UPDATE SET
            username = excluded.username,
            profile_url = excluded.profile_url,
            platform = excluded.platform,
            bid_amount = excluded.bid_amount,
            status = 'paid',
            email = COALESCE(excluded.email, bids.email),
            paid_at = excluded.paid_at
    `).run(
        bid.username,
        bid.imageUrl,
        bid.profileUrl,
        bid.bidAmount,
        bid.platform,
        session.id,
        bid.email,
        paidAt
    );

    return db.prepare(`
        SELECT username, bid_amount, status, created_at, paid_at
        FROM bids WHERE stripe_session_id = ?
    `).get(session.id);
}

async function findOrRestoreBid(sessionId) {
    let bid = db.prepare(`
        SELECT username, bid_amount, status, created_at, paid_at
        FROM bids WHERE stripe_session_id = ?
    `).get(sessionId);

    if (bid?.status === 'paid') return bid;

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const restoredBid = recordPaidSession(session);
        if (restoredBid) return restoredBid;
    } catch (err) {
        console.error('Payment status lookup error:', err);
    }

    return bid;
}

async function restoreRecentPaidBids({ lookbackDays = 90 } = {}) {
    // A persistent DB is still required in production. This is a safety net for a
    // restart or a volume misconfiguration: recent successful payments can be
    // rebuilt from Stripe's authoritative Checkout Session data.
    const createdSince = Math.floor(Date.now() / 1000) - (lookbackDays * 24 * 60 * 60);
    let startingAfter;
    let restored = 0;

    do {
        const page = await stripe.checkout.sessions.list({
            limit: 100,
            created: { gte: createdSince },
            ...(startingAfter ? { starting_after: startingAfter } : {})
        });

        for (const session of page.data) {
            if (recordPaidSession(session)) restored += 1;
        }

        startingAfter = page.has_more ? page.data.at(-1)?.id : null;
    } while (startingAfter);

    return restored;
}

let latestBidSyncAt = 0;
let latestBidSyncPromise = null;

function syncRecentlyPaidBids() {
    // The leaderboard polls every 30 seconds. Reconcile recent Checkout Sessions
    // at most once per process every 20 seconds so a bid confirmed on a different
    // instance cannot vanish when the browser refreshes the list.
    if (Date.now() - latestBidSyncAt < 20_000) return Promise.resolve(0);
    if (latestBidSyncPromise) return latestBidSyncPromise;

    latestBidSyncPromise = restoreRecentPaidBids({ lookbackDays: 2 })
        .finally(() => {
            latestBidSyncAt = Date.now();
            latestBidSyncPromise = null;
        });

    return latestBidSyncPromise;
}

router.post('/create-checkout-session', async (req, res) => {
    cleanupPending();
    const { username, bid_amount, email, platform = 'instagram', image_url = '' } = req.body;
    if (!['instagram', 'tiktok'].includes(platform)) return res.status(400).json({ error: 'Please choose Instagram or TikTok.' });

    if (!username || !bid_amount || bid_amount < 100 || !email || !/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email and a bid of at least €1.00.' });
    }

    const accountCheck = platform === 'tiktok' ? await validateTikTokUser(username) : await validateInstagramUser(username);
    if (!accountCheck.valid) {
        return res.status(400).json({ error: accountCheck.message });
    }

    const cleanUser = accountCheck.username;
    const submittedImage = String(image_url).trim();
    const safeImageUrl = (/^https?:\/\//i.test(submittedImage) || /^\/uploads\/[a-zA-Z0-9._-]+$/.test(submittedImage))
        ? submittedImage
        : (accountCheck.profileImageUrl || `https://unavatar.io/${platform}/${cleanUser}`);
    const profileUrl = platform === 'tiktok' ? `https://tiktok.com/@${cleanUser}` : `https://instagram.com/${cleanUser}`;
    const amountCents = parseInt(bid_amount);

    try {
        const session = await stripe.checkout.sessions.create({
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: `InstaBid Spot — @${cleanUser}`,
                        description: `Bid €${(amountCents / 100).toFixed(2)} to own your ranked spot!`,
                    },
                    unit_amount: amountCents,
                },
                quantity: 1,
            }],
            mode: 'payment',
            customer_email: email.trim(),
            payment_intent_data: { receipt_email: email.trim() },
            success_url: `${process.env.BASE_URL}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.BASE_URL}/?canceled=true`,
            metadata: { username: cleanUser, bid_amount: amountCents, platform, image_url: safeImageUrl }
        });

        db.prepare(`
            INSERT INTO bids (username, image_url, profile_url, bid_amount, platform, stripe_session_id, status, email)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(cleanUser, safeImageUrl, profileUrl, amountCents, platform, session.id, email.trim());

        res.json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: 'Could not create payment session: ' + err.message });
    }
});

router.get('/status/:sessionId', async (req, res) => {
    const bid = await findOrRestoreBid(req.params.sessionId);
    if (!bid) return res.status(404).json({ error: 'Payment not found.' });
    res.json(bid);
});

router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const session = event.data.object;
        recordPaidSession(session);
    }

    res.json({ received: true });
});

router.restoreRecentPaidBids = restoreRecentPaidBids;
router.syncRecentlyPaidBids = syncRecentlyPaidBids;

module.exports = router;
