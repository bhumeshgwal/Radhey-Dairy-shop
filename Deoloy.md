# Radhey Dairy — Vercel Deployment Guide (Fixed Structure)

## What was wrong before

1. **`fs.writeFileSync(orders.json)`** — Vercel's serverless functions have a
   **read-only filesystem**. Any write crashes the function instantly →
   "This Serverless Function has crashed."
2. **Folder name with a space** (`Radhey dairy/`) — caused routing problems,
   so even your homepage was being sent to the crashing function.
3. **Hardcoded keys** — `YOUR_KEY_ID` placeholders would also break Razorpay
   initialization on the server.

## New structure (this folder)

```
/
├── api/
│   └── index.js      ← serverless function (auto-detected by Vercel)
├── index.html
├── cart.html
├── drinks.html
├── style.css
├── script.js
├── vercel.json
└── package.json
```

No `builds` or complex `routes` needed — Vercel auto-detects:
- Anything in `/api` → serverless function
- Everything else → static files served as-is

---

## Step 1: Push this structure to your GitHub repo

Replace your current repo contents with this folder's contents
(keeping your images like `logo.png`, `500ml-milk.png` etc. alongside the
HTML files, same as before).

```bash
git add .
git commit -m "Fix Vercel deployment structure"
git push
```

---

## Step 2: Add your Razorpay keys as Environment Variables

**Do not put keys directly in code** — especially the secret key.

1. Go to your project on vercel.com → **Settings → Environment Variables**
2. Add:
   | Name | Value |
   |---|---|
   | `RAZORPAY_KEY_ID` | your Razorpay Key ID |
   | `RAZORPAY_KEY_SECRET` | your Razorpay Key Secret |
3. Click **Save**, then go to **Deployments** → click the three dots on the
   latest deployment → **Redeploy** (env vars only apply to new deployments)

---

## Step 3: Visit your site

Once redeployed, `https://radhey-dairy-shop.vercel.app` should load normally.

Test the API directly:
```
https://radhey-dairy-shop.vercel.app/api/create-order
```
(This will show a 404/method error for GET — that's expected, it only
accepts POST. If you see a crash page here instead, check the Vercel
function logs under **Deployments → [latest] → Functions**.)

---

## Step 4: Test a real payment

1. Add items to cart → go to `cart.html` → fill details → click **Pay**
2. Razorpay popup opens (test mode = no real money)
3. Use a test card from https://razorpay.com/docs/payments/payments/test-card-details/
4. On success, you'll see "Order Placed!"

---

## About order storage (orders.json removed)

The new `api/index.js` **doesn't save orders anywhere** — Vercel can't write
files. Verification still works (so payments are still secure), but you
won't have an order history yet.

When you're ready, add a free database — easiest options for beginners:
- **MongoDB Atlas** (free tier, works great with Vercel)
- **Vercel Postgres** (built into Vercel dashboard, free tier)
- **Vercel KV** (simple key-value store, free tier)

Once you pick one, I can add the order-saving code back in using it.