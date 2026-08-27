const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { db, cleanupPending } = require('../db');
const { validateInstagramUser } = require('../services/instagramService');

const INSTAGRAM_USERNAME_RE = /^[a-zA-Z0-9._]{1,30}$/;

function bidDetailsFromSession(session) {
    const username = String(session.metadata?.username || '').replace('@', '').trim();
    const bidAmount = Number(session.metadata?.bid_amount || session.amount_total);

    if (!INSTAGRAM_USERNAME_RE.test(username) || !Number.isInteger(bidAmount) || bidAmount < 100) {
        return null;
    }

    return {
        username,
        bidAmount,
        email: session.customer_details?.email || session.customer_email || null,
        imageUrl: `https://unavatar.io/instagram/${username}`,
        profileUrl: `https://instagram.com/${username}`
    };
}

function recordPaidSession(session) {
    if (session.payment_status !== 'paid') return null;

    const bid = bidDetailsFromSession(session);
    if (!bid) {
        console.error(`Could not restore paid Checkout Session ${session.id}: missing or invalid bid metadata.`);
        return null;
    }

    db.prepare(`
        INSERT INTO bids (
            username, image_url, profile_url, bid_amount,
            stripe_session_id, status, email, paid_at
        )
        VALUES (?, ?, ?, ?, ?, 'paid', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(stripe_session_id) DO UPDATE SET
            username = excluded.username,
            profile_url = excluded.profile_url,
            bid_amount = excluded.bid_amount,
            status = 'paid',
            email = COALESCE(excluded.email, bids.email),
            paid_at = COALESCE(bids.paid_at, excluded.paid_at)
    `).run(
        bid.username,
        bid.imageUrl,
        bid.profileUrl,
        bid.bidAmount,
        session.id,
        bid.email
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
    const { username, bid_amount, email } = req.body;

    if (!username || !bid_amount || bid_amount < 100 || !email || !/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email and a bid of at least €1.00.' });
    }

    const instaCheck = await validateInstagramUser(username);
    if (!instaCheck.valid) {
        return res.status(400).json({ error: instaCheck.message });
    }

    const cleanUser = instaCheck.username;
    const imageUrl = instaCheck.profileImageUrl || `https://unavatar.io/instagram/${cleanUser}`;
    const profileUrl = `https://instagram.com/${cleanUser}`;
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
            metadata: { username: cleanUser, bid_amount: amountCents }
        });

        db.prepare(`
            INSERT INTO bids (username, image_url, profile_url, bid_amount, stripe_session_id, status, email)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)
        `).run(cleanUser, imageUrl, profileUrl, amountCents, session.id, email.trim());

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
