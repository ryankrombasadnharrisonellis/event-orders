# DNA Life order website: setup guide

This is the order site we use at events. Customers scan a QR code, order and pay. Every order, payment and barcode lands in the **Google Sheet** ("DNA Life Event Webste").

There are two parts:

```
Customer / staff / lab  ──►  Order website (Railway, this folder)  ──►  Google Sheet + Apps Script  ──►  Stripe + emails
```

- **The Google Sheet + its Apps Script.** This is the back office: products, prices, pricing rules, orders, Stripe, emails. It already exists and keeps working. You don't rebuild it.
- **The order website.** This is the one file in this folder, `index.tsx`, running as a Railway Function. It's the page people see. It holds no data: it just passes every action on to the Apps Script. This is the part to set up on your Railway.

Setup takes about 15 minutes.

---

## 1. Get access to the Sheet

Ask Ryan or Henry to share **DNA Life Event Webste** with your Google account as **Editor**.

Then open it, go to **Extensions ▸ Apps Script** and note down two things:

1. **The web app link.** Go to **Deploy ▸ Manage deployments**, pick the **Web app** deployment (Execute as: Me, Who has access: Anyone) and copy its URL. It ends in `/exec`.
   - Use `/exec`, never a `/dev` link.
   - Don't create a new deployment. Use the existing one.
2. **The API secret.** Go to **Project Settings (gear) ▸ Script properties** and copy the value of `API_SECRET`.
   - Treat this like a password. Never put it in GitHub, a chat or a doc.

## 2. Create the Railway Function

1. Go to railway.com, then **New Project ▸ Function** (the Bun runtime).
2. Delete the example code. Paste in the **whole** of `index.tsx` from this folder (about 890 lines).
   - It's one self-contained file with no other files or packages.
3. In the service, go to **Settings**:
   - **Region:** EU West (Amsterdam). Customers and the Sheet are in Europe.
   - **Networking ▸ Generate Domain.** Copy the address, e.g. `https://something.up.railway.app`.
4. In the service, go to **Variables** and add:

| Variable | Value |
|---|---|
| `APPS_SCRIPT_URL` | the `/exec` link from step 1 |
| `APPS_SCRIPT_SECRET` | the `API_SECRET` value from step 1 (exactly the same text) |
| `SESSION_SECRET` | any long random text, at least 32 characters (keeps staff logged in across restarts) |
| `STAFF_SESSION_HOURS` | optional. How long a staff login lasts. Default 12 |

5. Deploy, then open `https://YOUR-DOMAIN/healthz`. It should say `ok`.

## 3. Point the Sheet at the new website

1. In the Sheet, open the **Settings** tab and set `PUBLIC_SITE_URL` to your Railway address. Leave off the `/` at the end.
2. Go to **Orders ▸ Show order page link & QR code**. It checks the site and shows the new QR code.
3. **Print the new QR code.** The old one points at Ryan's Railway address, which no longer works.

Once `PUBLIC_SITE_URL` is set, the Stripe return links, the "Verify it's me" emails for practitioners, the staff link and the lab link all point to the new site automatically.

## 4. Test before an event

Do this on a real phone.

| Check | Expected |
|---|---|
| Open `https://YOUR-DOMAIN/` | Order page with the current event's tests (event set by `CURRENT_EVENT` in Settings) |
| Place an order, pay with test card `4242 4242 4242 4242` (any future date and CVC) | Payment received page; order shows **Paid** on the Orders tab; confirmation email arrives |
| `https://YOUR-DOMAIN/staff` | Asks for a work email and emails a 6-digit code. Only works for emails on the **Staff** tab with Active = TRUE |
| `https://YOUR-DOMAIN/lab` | Lab lookup after staff login |
| Scan with camera (barcode step) | Camera opens in Chrome or Safari |

Test cards only work while the Sheet uses a Stripe **test** key. The key is set from the Sheet: **Orders ▸ Set Stripe key**.

## Addresses

| Page | Address |
|---|---|
| Order page (QR code) | `https://YOUR-DOMAIN/` (opens `CURRENT_EVENT`) or `https://YOUR-DOMAIN/event/CPHW` |
| Staff (iPads) | `https://YOUR-DOMAIN/staff` |
| Lab | `https://YOUR-DOMAIN/lab` |
| Health check | `https://YOUR-DOMAIN/healthz` |

## If something goes wrong

| You see | Cause / fix |
|---|---|
| Yellow "Preview mode" banner and demo products | `APPS_SCRIPT_URL` isn't set. Add it and redeploy. |
| "The order system is busy right now" | Google didn't answer properly. The site already retries once and falls back to the last good page for up to 30 minutes. If it keeps happening, check that `APPS_SCRIPT_URL` is the `/exec` link and the deployment is "Anyone". |
| Railway logs say "Apps Script refused the secret" | `APPS_SCRIPT_SECRET` doesn't match `API_SECRET` in Script properties. |
| Staff get logged out after each deploy | `SESSION_SECRET` isn't set. |
| QR menu says "This link does not open" | The Railway site is down or `PUBLIC_SITE_URL` is wrong. Open `/healthz` to check. |

Changing products, prices, events or pricing rules needs no code changes. Do it in the Sheet tabs (Products, Events, Pricing Rules). `CURRENT_EVENT` in Settings picks which event the QR code opens.

## Notes for whoever maintains the code

- Only these Apps Script functions can be called from the website: `PUBLIC_FNS` and `STAFF_FNS` near the top of the server code. Staff functions need the signed staff cookie.
- The page itself (HTML) comes from the Apps Script files `Index` and `Lab` (via `getPageSource`). `EMBEDDED_PATCHES` in `index.tsx` then applies the website-only changes (camera scanning, sample pictures, staff login). If someone edits `Index` in Apps Script and a patch stops matching, the Railway logs say "change(s) did not match".
- To move off Railway later (company server or the VMS), any host that runs Bun can run `index.tsx` with the same variables (`PORT` defaults to 3000). The VMS can replace the Apps Script by answering the same `POST {secret, fn, arg, staff}` → `{ok, result}` calls.
