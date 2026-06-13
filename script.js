// =======================================================
//  Radhey Dairy — script.js
//  Shared across index.html, drinks.html, cart.html
// =======================================================

// -------------------------------------------------------
//  CONFIG
// -------------------------------------------------------
// URL of your backend server (server.js).
// While testing locally, this is usually http://localhost:3000
const SERVER_URL = 'http://localhost:3000';

// -------------------------------------------------------
//  Cart State (persisted in localStorage)
// -------------------------------------------------------
function getCart() {
    try { return JSON.parse(localStorage.getItem('rd_cart') || '[]'); }
    catch { return []; }
}

function saveCart(cart) {
    localStorage.setItem('rd_cart', JSON.stringify(cart));
}

function addToCart(name, price, unit) {
    const cart = getCart();
    // unit is optional (e.g. "500ml", "200g") — for display only
    const key = name + '__' + price;
    const existing = cart.find(item => item.key === key);
    if (existing) {
        existing.qty++;
    } else {
        cart.push({ key, name, price, unit: unit || '', qty: 1 });
    }
    saveCart(cart);
    updateCartBadge();
    showToast(name + ' added to cart!');
}

function removeFromCart(key) {
    const cart = getCart().filter(item => item.key !== key);
    saveCart(cart);
    updateCartBadge();
}

function updateQty(key, qty) {
    const cart = getCart();
    const item = cart.find(i => i.key === key);
    if (item) {
        if (qty < 1) { removeFromCart(key); return; }
        item.qty = qty;
        saveCart(cart);
        updateCartBadge();
    }
}

// -------------------------------------------------------
//  Cart Badge (works on every page that has .nav-link "Cart")
// -------------------------------------------------------
function updateCartBadge() {
    const total = getCart().reduce((sum, item) => sum + item.qty, 0);
    let badge = document.getElementById('cart-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.id = 'cart-badge';
        badge.style.cssText = [
            'background:var(--primary)', 'color:#fff',
            'border-radius:999px', 'padding:1px 8px',
            'font-size:0.75rem', 'margin-left:6px',
            'vertical-align:middle', 'font-family:var(--font-body)'
        ].join(';');
        const cartLink = [...document.querySelectorAll('.nav-link')]
            .find(el => el.textContent.trim().startsWith('Cart'));
        if (cartLink) cartLink.appendChild(badge);
    }
    badge.textContent = total > 0 ? total : '';
    badge.style.display = total > 0 ? 'inline' : 'none';
}

// -------------------------------------------------------
//  Toast notification
// -------------------------------------------------------
function showToast(msg) {
    let toast = document.getElementById('rd-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'rd-toast';
        toast.style.cssText = [
            'position:fixed', 'bottom:30px', 'left:50%',
            'transform:translateX(-50%)',
            'background:var(--primary)', 'color:#fff',
            'padding:12px 28px', 'border-radius:999px',
            'font-family:var(--font-body)', 'font-size:1rem',
            'z-index:2000', 'opacity:0',
            'transition:opacity 0.3s ease',
            'pointer-events:none', 'white-space:nowrap',
            'box-shadow:0 4px 16px rgba(0,0,0,0.2)'
        ].join(';');
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._hide);
    toast._hide = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
}

// -------------------------------------------------------
//  Paneer Card (index.html only — safe to call on other pages, will silently skip)
// -------------------------------------------------------
const RATE = 420;   // ₹420 per kg
let cardGrams = 100;
let modalGrams = 100;

function calcPrice(g) {
    return Math.round((g / 1000) * RATE);
}

function updateCard() {
    const qtyEl = document.getElementById('card-qty');
    const priceEl = document.getElementById('card-price');
    if (qtyEl) qtyEl.value = cardGrams;
    if (priceEl) priceEl.textContent = '₹' + calcPrice(cardGrams);
}

function openModal() {
    modalGrams = cardGrams;
    const mqty = document.getElementById('modal-qty');
    if (mqty) mqty.value = modalGrams;
    updateModalDisplay();
    const modal = document.getElementById('modal');
    if (modal) modal.classList.add('open');
}

function closeModal() {
    const modal = document.getElementById('modal');
    if (modal) modal.classList.remove('open');
}

function modalQty(delta) {
    modalGrams = Math.max(100, modalGrams + delta);
    const mqty = document.getElementById('modal-qty');
    if (mqty) mqty.value = modalGrams;
    updateModalDisplay();
}

function modalQtyInput(el) {
    let v = Math.round(parseInt(el.value) / 100) * 100;
    if (isNaN(v) || v < 100) v = 100;
    modalGrams = v;
    el.value = modalGrams;
    updateModalDisplay();
}

function updateModalDisplay() {
    const qtyDisplay = document.getElementById('modal-qty-display');
    const total = document.getElementById('modal-total');
    if (qtyDisplay) qtyDisplay.textContent = modalGrams + 'g';
    if (total) total.textContent = '₹' + calcPrice(modalGrams);
}

function confirmOrder() {
    addToCart('Fresh Paneer (' + modalGrams + 'g)', calcPrice(modalGrams), modalGrams + 'g');
    closeModal();
}

// Wire up paneer card buttons if they exist on this page
document.addEventListener('DOMContentLoaded', function () {
    updateCartBadge();

    const btnPlus  = document.getElementById('btn-plus');
    const btnMinus = document.getElementById('btn-minus');
    const cardQty  = document.getElementById('card-qty');

    if (btnPlus)  btnPlus.addEventListener('click',  () => { cardGrams += 100; updateCard(); });
    if (btnMinus) btnMinus.addEventListener('click', () => { if (cardGrams > 100) cardGrams -= 100; updateCard(); });
    if (cardQty)  cardQty.addEventListener('change', function () {
        let v = Math.round(parseInt(this.value) / 100) * 100;
        if (isNaN(v) || v < 100) v = 100;
        cardGrams = v;
        updateCard();
    });
});

// -------------------------------------------------------
//  Razorpay Payment (called from cart.html)
//  Full flow:
//    1. Ask our server to create a Razorpay order
//    2. Open Razorpay popup with that order_id
//    3. On success, send payment details to our server to verify
//    4. Server confirms → show success screen
// -------------------------------------------------------
async function startPayment(totalAmount, customerName, customerPhone, customerAddress) {
    const cart = getCart();

    try {
        // ---- STEP 1: create order on server ----
        const createRes = await fetch(SERVER_URL + '/api/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: totalAmount,
                customer: { name: customerName, phone: customerPhone, address: customerAddress },
                items: cart,
            }),
        });

        const orderData = await createRes.json();
        if (!orderData.success) {
            showToast('Could not start payment. Please try again.');
            return;
        }

        // ---- STEP 2: open Razorpay popup ----
        const options = {
            key: orderData.key_id,
            amount: orderData.amount,        // in paise, from server
            currency: 'INR',
            name: 'Radhey Dairy',
            description: 'Fresh dairy products',
            order_id: orderData.order_id,    // <-- real order id from server
            prefill: {
                name: customerName || '',
                contact: customerPhone || '',
            },
            theme: { color: '#2e6b4f' },
            handler: async function (response) {
                // ---- STEP 3: verify payment on server ----
                await verifyPayment(response);
            },
            modal: {
                ondismiss: function () {
                    showToast('Payment cancelled.');
                },
            },
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', function (response) {
            showToast('Payment failed: ' + response.error.description);
        });
        rzp.open();

    } catch (err) {
        console.error('Payment start error:', err);
        showToast('Server not reachable. Is your backend running?');
    }
}

async function verifyPayment(response) {
    try {
        const verifyRes = await fetch(SERVER_URL + '/api/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
            }),
        });

        const result = await verifyRes.json();

        if (result.success) {
            onPaymentSuccess(response.razorpay_payment_id);
        } else {
            showToast('Payment verification failed. Contact support.');
        }
    } catch (err) {
        console.error('Verification error:', err);
        showToast('Could not verify payment. Contact support.');
    }
}

function onPaymentSuccess(paymentId) {
    // Clear cart
    localStorage.removeItem('rd_cart');
    // Redirect to a success message (we do it inline in cart.html)
    const cartMain = document.getElementById('cart-main');
    if (cartMain) {
        cartMain.innerHTML = `
          <div style="text-align:center;padding:80px 20px;">
            <div style="font-size:4rem;margin-bottom:20px;">🎉</div>
            <h2 style="font-family:var(--font-heading);font-size:2rem;color:var(--text-h1);margin-bottom:10px;">
              Order Placed!
            </h2>
            <p style="color:var(--text-secondary);font-size:1.1rem;margin-bottom:6px;">
              Payment ID: <strong>${paymentId}</strong>
            </p>
            <p style="color:var(--text-secondary);font-size:1rem;margin-bottom:30px;">
              Thank you for choosing Radhey Dairy. Your fresh order is on its way!
            </p>
            <a href="index.html" style="
              background:var(--primary);color:#fff;
              padding:12px 32px;border-radius:999px;
              font-size:1rem;font-weight:500;
              text-decoration:none;display:inline-block;">
              Back to Home
            </a>
          </div>`;
    }
}