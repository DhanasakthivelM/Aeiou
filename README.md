# Goodkind — storefront and shop admin

A mobile-first storefront with editable products and homepage banners, WhatsApp checkout, an admin sales dashboard, and a FastAPI backend. Supabase stores the catalogue, image uploads, order records, and sales status. Vercel can host the FastAPI application and the storefront from this folder.

## What the admin can do

- View confirmed revenue, recent orders, and the last seven days of confirmed sales.
- Change order status to pending, confirmed, completed, or cancelled.
- Add, edit, hide, and remove products.
- Add, edit, hide, and remove rotating homepage banners.
- Upload product and banner images directly to the configured Supabase Storage bucket.

Only orders marked **confirmed** or **completed** count as sales. WhatsApp orders start as **pending**; confirm an order after agreeing it with the customer. Online card payments are not enabled.

## 1. Set up Supabase

1. Create a Supabase project and open **SQL Editor**.
2. Run [`supabase/schema.sql`](supabase/schema.sql). It creates the tables and guarded order/dashboard functions, sets row-level security, creates the public image bucket, and adds the eight example products and three example banners. Existing product edits are preserved when you run the seed section again.
3. In **Authentication → Users**, invite/create an administrator account. Add its email to `ADMIN_EMAILS`.
4. Copy the project URL, anon key, and service-role key from **Project Settings → API**. Keep the service-role key private; add it only as a server environment variable in local `.env` and Vercel. Never put it in browser JavaScript or commit it.

## 2. Run locally

Use Python 3.11 or newer:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Fill in the Supabase values and admin email in `.env`, then start the app:

```powershell
python -m uvicorn main:app --reload
```

- Storefront: `http://127.0.0.1:8000/`
- Admin: `http://127.0.0.1:8000/admin`
- Health/config check: `http://127.0.0.1:8000/api/health`

Set `WHATSAPP_NUMBER` to the shop number including country code, digits only (for example `14155550123`). The current catalogue and dashboard currency is USD; shipping is free at $75 and $5 otherwise.

## 3. Deploy to Vercel

1. Import the **shop's own GitHub repository** in Vercel. Do not select a different project repository.
2. Add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `ADMIN_EMAILS` as Vercel environment variables. Add `SUPABASE_STORAGE_BUCKET` if using a bucket name other than `storefront-media`, and set `WHATSAPP_NUMBER`. Do not deploy a `.env` file.
3. Deploy with Vercel's Python/FastAPI runtime. `main.py` is the ASGI entrypoint; `requirements.txt` lists its dependencies.

## Data and access notes

- The admin session is an HTTP-only, same-site cookie; the server verifies its Supabase Auth user and checks the `ADMIN_EMAILS` allowlist on each protected request.
- Storefront visitors can read active products and banners and place an order. They cannot directly write products, banner settings, or order status.
- Product and banner removals are soft deletes so past order items remain readable.
- Checkout recalculates prices and stock in a database function, saves a pending order, then opens a WhatsApp message with the saved order summary. Customer/payment confirmation still happens outside the site.
- Orders are not associated with customer accounts in this starter version; the admin manages the store-wide order list.

The shop name, currency, shipping policy, and wording are illustrative defaults. Adjust the product/banner seed rows and the order policy in `supabase/schema.sql` before launch if they do not match the business.
