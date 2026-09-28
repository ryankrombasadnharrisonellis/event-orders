# Event Orders

QR-code ordering for summits and health weeks. Customers scan a QR code, fill in their details, choose products, pick **collect at the event** or **ship to my address**, and pay with Stripe Checkout. Staff see every order live at `/staff`, hand over pickups, and download a CSV that opens in Excel.

Same setup as the DNA kit app: zero-dependency Node 22, built-in SQLite on a Railway volume, Stripe over its REST API with a signed webhook.

| Page | What it is |
|---|---|
| `/` | Order page (the QR code points here). Always opens the **current event**; `/?event=CODE` opens a specific one. |
| `/staff` | Orders with live totals, search, CSV export |
| `/staff/pickup` | Pickup desk: scan or type an order number, see if it is paid, mark it handed over |
| `/staff/events` | Create events (copy products from an earlier one), switch the current event, open/close ordering |
| `/staff/products` | Prices, stock (empty = unlimited), pictures, on sale or not |
| `/staff/qr` | The QR code to print |
| `/staff/users`, `/staff/activity` | Admins only: staff accounts, activity log |
| `/stripe/webhook` | Stripe tells the app when a payment succeeds or expires |

**One company = one Railway service** (its own Stripe account, database and QR code). To add a company, deploy the same code again as a new service with that company's variables.

## Variables (Railway ▸ service ▸ Variables)

| Variable | Needed | Example / notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | yes | `sk_test_…` while testing, `sk_live_…` when live |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_…` from the Stripe webhook endpoint |
| `ADMIN_EMAIL` | yes | first admin account, created on first start |
| `ADMIN_PASSWORD` | recommended | first admin password (otherwise a random one is printed in the deploy logs). Change it after first login. |
| `BASE_URL` | yes | `https://your-domain` (no trailing slash). Used for Stripe return links and the QR code. |
| `COMPANY_NAME` | yes | e.g. `Nordic Health` (consent text, emails) |
| `PRIVACY_URL` | yes before live | link to the privacy notice |
| `ORDER_PREFIX` | optional | start of order numbers, default `NH` (use a different one per company) |
| `DEMO_MODE` | for demos | `true` shows a DEMO banner on every page and refuses live Stripe keys, so no real payment can be taken |
| `DATA_DIR` | optional | default `/data` (mount the volume here) |
| `PAYMENT_WINDOW_MINUTES` | optional | how long an unpaid order holds stock, min/default 30 |
| `RESEND_API_KEY`, `EMAIL_FROM`, `REPLY_TO_EMAIL` | optional | confirmation emails through Resend. Without them, no emails are sent. |

## Deploy on Railway

1. Put this folder in a GitHub repo (root directory = this folder).
2. Railway ▸ New service ▸ GitHub repo. Settings: **Root Directory** = this folder, **Region** = EU West (Amsterdam).
3. Add a **volume** mounted at `/data`.
4. Add the variables above, then **Generate Domain** and put it in `BASE_URL`.
5. Stripe ▸ Developers ▸ Webhooks ▸ Add endpoint: `https://your-domain/stripe/webhook` with events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
   Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
6. Open `/staff`, log in, check the example event under **Events** and **Products**, then print the QR code from `/staff/qr`.

## Test before every event
Pay with test card `4242 4242 4242 4242` on a real phone: the order should turn **Paid** in `/staff` within seconds. Try a pickup order at `/staff/pickup`, a shipping order, a cancelled payment (press back on Stripe), and a sold-out product (set Stock to 1).

## Run locally
`npm run dev` (Node 22.13+). Data is stored in `./data`.
