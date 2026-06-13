// =======================================================
//  Radhey Dairy — Backend Server
//  Handles: order creation, payment verification, order storage
// =======================================================

const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());                 // allow your frontend to call this server
app.use(express.json());         // parse JSON request bodies

// -------------------------------------------------------
//  CONFIG — put your real keys here (use .env in production!)
// -------------------------------------------------------
const RAZORPAY_KEY_ID     = 'YOUR_KEY_ID';      // same as in script.js
const RAZORPAY_KEY_SECRET = 'YOUR_KEY_SECRET';  // NEVER put this in frontend code

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});

// -------------------------------------------------------
//  Simple file-based "database" (orders.json)
//  Good enough for learning — swap for MongoDB/MySQL later
// -------------------------------------------------------
const ORDERS_FILE = path.join(__dirname, 'orders.json');

function readOrders() {
    if (!fs.existsSync(ORDERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
}

function saveOrders(orders) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// =========================================================
//  STEP 1: Create a Razorpay order
//  Called when user clicks "Pay" — BEFORE the popup opens
// =========================================================
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount, customer, items } = req.body;
        // amount comes in rupees from frontend — convert to paise
        const amountInPaise = Math.round(amount * 100);

        // Ask Razorpay to create an order
        const rzpOrder = await razorpay.orders.create({
            amount: amountInPaise,
            currency: 'INR',
            receipt: 'order_rcpt_' + Date.now(),
        });

        // Save a "pending" order in our database
        const orders = readOrders();
        const newOrder = {
            id: rzpOrder.id,           // Razorpay order id (also our id)
            amount: amount,
            customer: customer || {},
            items: items || [],
            status: 'pending',
            createdAt: new Date().toISOString(),
        };
        orders.push(newOrder);
        saveOrders(orders);

        // Send order_id back to frontend so it can open the popup
        res.json({
            success: true,
            order_id: rzpOrder.id,
            amount: amountInPaise,
            key_id: RAZORPAY_KEY_ID,
        });
    } catch (err) {
        console.error('Create order error:', err);
        res.status(500).json({ success: false, error: 'Could not create order' });
    }
});

// =========================================================
//  STEP 2: Verify payment after user pays
//  Called when Razorpay popup's handler() fires
// =========================================================
app.post('/api/verify-payment', (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
        } = req.body;

        // Recreate the signature using our SECRET key
        const expectedSignature = crypto
            .createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + '|' + razorpay_payment_id)
            .digest('hex');

        const isValid = expectedSignature === razorpay_signature;

        const orders = readOrders();
        const order = orders.find(o => o.id === razorpay_order_id);

        if (isValid && order) {
            order.status = 'paid';
            order.payment_id = razorpay_payment_id;
            order.paidAt = new Date().toISOString();
            saveOrders(orders);

            return res.json({ success: true, message: 'Payment verified', order });
        }

        // Signature mismatch — possible tampering, mark as failed
        if (order) {
            order.status = 'failed';
            saveOrders(orders);
        }
        return res.status(400).json({ success: false, error: 'Payment verification failed' });

    } catch (err) {
        console.error('Verify payment error:', err);
        res.status(500).json({ success: false, error: 'Verification error' });
    }
});

// =========================================================
//  STEP 3 (optional): View all orders — for your admin use
// =========================================================
app.get('/api/orders', (req, res) => {
    res.json(readOrders());
});

// -------------------------------------------------------
//  Start server
// -------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Radhey Dairy server running on http://localhost:${PORT}`);
});