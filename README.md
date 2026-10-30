# Event Orders

QR-code ordering for event stands (summits, health weeks).

| Folder | What it is | Use it? |
|---|---|---|
| [`dna-life-site/`](dna-life-site/) | **The version in use.** An order website (one Railway Function file). Orders, payments and barcodes go into the DNA Life Google Sheet, which runs Stripe and emails through Apps Script. | **Yes, start here.** Follow [dna-life-site/README.md](dna-life-site/README.md). |
| [`event-orders-full/`](event-orders-full/) | Earlier standalone version: its own database (SQLite) and staff pages, with no Google Sheet. | Only if you want a version without the Sheet. |

No passwords, keys or secrets are stored in this repo. They live in Railway Variables and in Apps Script ▸ Script properties.
