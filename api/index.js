// =======================================================
//  Radhey Dairy — Vercel Serverless API
//  File location: /api/index.js
//  Vercel auto-routes:
//    /api            -> this file
//    /api/anything   -> this file (we read req.url to branch)
// =======================================================

const Razorpay = require('razorpay');
const crypto = require('crypto');

// -------------------------------------------------------
//  CONFIG — set these in Vercel dashboard as Environment
//  Variables (Project Settings -> Environment Variables),
//  NOT hardcoded here. Names must match exactly:
//    RAZORPAY_KEY_ID
//    RAZORPAY_KEY_SECRET
// -------------------------------------------------------
const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});

// -------------------------------------------------------
//  NOTE on storage:
//  Vercel functions have a READ-ONLY filesystem (no writing
//  to orders.json like before). For now we don't persist
//  orders — payment verification still works fine without
//  storage. When ready, add a real database (see SETUP.md).
// -------------------------------------------------------

module.exports = async (req, res) => {
    // Allow requests from your frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { pathname } = new URL(req.url, `http://${req.headers.host}`);

    // =====================================================
    //  POST /api/create-order
    // =====================================================
    if (pathname === '/api/create-order' && req.method === 'POST') {
        try {
            const { amount, customer, items } = req.body;
            const amountInPaise = Math.round(amount * 100);

            const rzpOrder = await razorpay.orders.create({
                amount: amountInPaise,
                currency: 'INR',
                receipt: 'order_rcpt_' + Date.now(),
            });

            return res.status(200).json({
                success: true,
                order_id: rzpOrder.id,
                amount: amountInPaise,
                key_id: RAZORPAY_KEY_ID,
            });
        } catch (err) {
            console.error('Create order error:', err);
            return res.status(500).json({ success: false, error: 'Could not create order' });
        }
    }

    // =====================================================
    //  POST /api/verify-payment
    // =====================================================
    if (pathname === '/api/verify-payment' && req.method === 'POST') {
        try {
            const {
                razorpay_order_id,
                razorpay_payment_id,
                razorpay_signature,
            } = req.body;

            const expectedSignature = crypto
                .createHmac('sha256', RAZORPAY_KEY_SECRET)
                .update(razorpay_order_id + '|' + razorpay_payment_id)
                .digest('hex');

            const isValid = expectedSignature === razorpay_signature;

            if (isValid) {
                // TODO: save order to a database here (see SETUP.md)
                return res.status(200).json({ success: true, message: 'Payment verified' });
            }

            return res.status(400).json({ success: false, error: 'Payment verification failed' });
        } catch (err) {
            console.error('Verify payment error:', err);
            return res.status(500).json({ success: false, error: 'Verification error' });
        }
    }

    // =====================================================
    //  Fallback
    // =====================================================
    return res.status(404).json({ success: false, error: 'Not found' });
};