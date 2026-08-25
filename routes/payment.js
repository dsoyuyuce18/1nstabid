const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { db, cleanupPending } = require('../db');
const { validateInstagramUser } = require('../services/instagramService');

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
                        description: `Bid $${(amountCents / 100).toFixed(2)} to own your ranked spot!`,
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
    const bid = db.prepare(`
        SELECT username, bid_amount, status, created_at
        FROM bids WHERE stripe_session_id = ?
    `).get(req.params.sessionId);

    if (!bid) return res.status(404).json({ error: 'Payment not found.' });

    if (bid.status !== 'paid') {
        try {
            const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
            if (session.payment_status === 'paid') {
                db.prepare(`UPDATE bids SET status = 'paid' WHERE stripe_session_id = ?`).run(req.params.sessionId);
                bid.status = 'paid';
            }
        } catch (err) {
            console.error('Payment status lookup error:', err);
        }
    }

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

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        db.prepare(`UPDATE bids SET status = 'paid' WHERE stripe_session_id = ?`).run(session.id);
    }

    res.json({ received: true });
});

module.exports = router;
