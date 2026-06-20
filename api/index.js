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
//    TELEGRAM_BOT_TOKEN     <- new, get from @BotFather
//    TELEGRAM_CHAT_ID       <- new, your shop's chat/group id
// -------------------------------------------------------
const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID    = process.env.TELEGRAM_CHAT_ID;

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});

// -------------------------------------------------------
//  PRICE MAP — SOURCE OF TRUTH. The server recalculates
//  every order total from THIS, never from what the
//  browser sends. This is what stops someone editing
//  prices in dev tools.
//
//  1) Gram-based products (Paneer, Dahi — sold by weight,
//     price shown is per 100g). Cart items for these look
//     like "Fresh Paneer (300g)" — that's how script.js
//     names them (see confirmOrder() in script.js).
//     Key = exact product name used in openModal(...).
// -------------------------------------------------------
const GRAM_RATE_PER_100G = {
    'Fresh Paneer': 42,
    'Fresh Dahi': 12,
    // TODO: add any other gram-based products here exactly
    // as they appear in your openModal('Name', rate) calls
};

// -------------------------------------------------------
//  2) Fixed-price products (milk packets — sold per packet,
//     not scaled by weight). Key = exact product name used
//     in your addToCart('Name', price) call for milk items.
// -------------------------------------------------------
const FIXED_PRICE_PRODUCTS = {
    // TODO — fill these in to match your milk product cards, e.g.:
    // '500ml Milk': 25,
    // '1L Milk': 48,
    // '1L Toned Milk': 45,
    // '2L Milk': 92,
    // '2L Toned Milk': 88,
};

const COD_HANDLING_CHARGE = 5;

// -------------------------------------------------------
//  Works out the correct price for one cart item using
//  ONLY the server-side price maps above. Returns null if
//  the item doesn't match anything we recognise (so the
//  order gets rejected instead of silently mispriced).
// -------------------------------------------------------
function getExpectedItemPrice(item) {
    const gramMatch = typeof item.name === 'string' && item.name.match(/^(.*) \((\d+)g\)$/);
    if (gramMatch) {
        const baseName = gramMatch[1];
        const grams = parseInt(gramMatch[2], 10);
        const rate = GRAM_RATE_PER_100G[baseName];
        if (rate === undefined || isNaN(grams) || grams <= 0) return null;
        return Math.round((grams / 100) * rate);
    }

    if (Object.prototype.hasOwnProperty.call(FIXED_PRICE_PRODUCTS, item.name)) {
        return FIXED_PRICE_PRODUCTS[item.name];
    }

    return null;
}

// Recalculates a whole cart server-side. Returns { ok, subtotal, lines, error }
function recalculateCart(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return { ok: false, error: 'Cart is empty' };
    }

    let subtotal = 0;
    const lines = [];

    for (const item of items) {
        const qty = parseInt(item.qty, 10);
        if (!Number.isInteger(qty) || qty <= 0 || qty > 100) {
            return { ok: false, error: `Invalid quantity for ${item.name}` };
        }

        const unitPrice = getExpectedItemPrice(item);
        if (unitPrice === null) {
            return { ok: false, error: `Unrecognised product: ${item.name}` };
        }

        const lineTotal = unitPrice * qty;
        subtotal += lineTotal;
        lines.push(`${item.name} x${qty} = \u20B9${lineTotal}`);
    }

    return { ok: true, subtotal, lines };
}

// -------------------------------------------------------
//  Telegram notification helper
// -------------------------------------------------------
async function sendTelegramMessage(text) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error('Telegram env vars missing — skipping notification');
        return false;
    }
    try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text,
            }),
        });
        if (!res.ok) {
            console.error('Telegram send failed:', await res.text());
            return false;
        }
        return true;
    } catch (err) {
        console.error('Telegram send error:', err);
        return false;
    }
}

function buildOrderMessage({ paymentMode, customerName, customerPhone, customerAddress, lines, subtotal, delivery, handling, total, paymentId }) {
    let msg = `\uD83C\uDD95 New ${paymentMode} Order\n\n`;
    msg += `Name: ${customerName}\n`;
    msg += `Phone: ${customerPhone}\n`;
    msg += `Address: ${customerAddress}\n\n`;
    msg += `Items:\n${lines.join('\n')}\n\n`;
    msg += `Subtotal: \u20B9${subtotal}\n`;
    if (delivery) msg += `Delivery: \u20B9${delivery}\n`;
    if (handling) msg += `Handling charge: \u20B9${handling}\n`;
    msg += `Total: \u20B9${total}\n`;
    if (paymentMode === 'ONLINE') {
        msg += `Payment ID: ${paymentId}\n`;
        msg += `Status: PAID`;
    } else {
        msg += `Payment: Cash on Delivery — collect \u20B9${total}`;
    }
    return msg;
}

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
            const { customer, items } = req.body;

            const result = recalculateCart(items);
            if (!result.ok) {
                return res.status(400).json({ success: false, error: result.error });
            }

            const delivery = result.subtotal < 100 ? 10 : 0;
            const total = result.subtotal + delivery;
            const amountInPaise = Math.round(total * 100);

            const rzpOrder = await razorpay.orders.create({
                amount: amountInPaise,
                currency: 'INR',
                receipt: 'order_rcpt_' + Date.now(),
                // Stash order details in notes so verify-payment can read
                // them back later — this avoids needing a database.
                notes: {
                    customerName: (customer && customer.name) || '',
                    customerPhone: (customer && customer.phone) || '',
                    customerAddress: (customer && customer.address) || '',
                    lines: result.lines.join(' | ').slice(0, 950), // notes value limit
                    subtotal: String(result.subtotal),
                    delivery: String(delivery),
                },
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

            if (!isValid) {
                return res.status(400).json({ success: false, error: 'Payment verification failed' });
            }

            // Pull order details back from Razorpay's notes field
            const order = await razorpay.orders.fetch(razorpay_order_id);
            const notes = order.notes || {};
            const subtotal = parseInt(notes.subtotal, 10) || 0;
            const delivery = parseInt(notes.delivery, 10) || 0;
            const total = subtotal + delivery;
            const lines = (notes.lines || '').split(' | ').filter(Boolean);

            // Only notify after signature verification succeeds — this is
            // what stops fake/unpaid orders from reaching Telegram.
            await sendTelegramMessage(buildOrderMessage({
                paymentMode: 'ONLINE',
                customerName: notes.customerName,
                customerPhone: notes.customerPhone,
                customerAddress: notes.customerAddress,
                lines,
                subtotal,
                delivery,
                handling: 0,
                total,
                paymentId: razorpay_payment_id,
            }));

            return res.status(200).json({ success: true, message: 'Payment verified' });
        } catch (err) {
            console.error('Verify payment error:', err);
            return res.status(500).json({ success: false, error: 'Verification error' });
        }
    }

    // =====================================================
    //  POST /api/cod-order
    //  Cash on Delivery — no payment to verify, but the
    //  total is still computed entirely server-side so the
    //  customer can't alter prices from the browser.
    // =====================================================
    if (pathname === '/api/cod-order' && req.method === 'POST') {
        try {
            const { customer, items } = req.body;

            if (!customer || !customer.name || !customer.phone || !customer.address) {
                return res.status(400).json({ success: false, error: 'Missing customer details' });
            }

            const result = recalculateCart(items);
            if (!result.ok) {
                return res.status(400).json({ success: false, error: result.error });
            }

            const delivery = result.subtotal < 100 ? 10 : 0;
            const total = result.subtotal + delivery + COD_HANDLING_CHARGE;

            const sent = await sendTelegramMessage(buildOrderMessage({
                paymentMode: 'COD',
                customerName: customer.name,
                customerPhone: customer.phone,
                customerAddress: customer.address,
                lines: result.lines,
                subtotal: result.subtotal,
                delivery,
                handling: COD_HANDLING_CHARGE,
                total,
            }));

            if (!sent) {
                return res.status(500).json({ success: false, error: 'Could not notify shop. Please call to confirm your order.' });
            }

            return res.status(200).json({ success: true, total });
        } catch (err) {
            console.error('COD order error:', err);
            return res.status(500).json({ success: false, error: 'Server error' });
        }
    }

    // =====================================================
    //  Fallback
    // =====================================================
    return res.status(404).json({ success: false, error: 'Not found' });
};