# MyStore Professional — Supabase + Render

This version stores products, stock, coupons, orders and the admin password in Supabase. Product images uploaded through Admin are stored in Supabase Storage.

## One-time setup
1. Create a free Supabase project.
2. Open Supabase SQL Editor and run `supabase_schema.sql`.
3. Copy the Supabase Project URL and the **service_role** key from Project Settings → API.
4. Upload this project to a GitHub repository.
5. In Render choose New → Web Service and connect the repo.
6. Build: `npm install`; Start: `npm start`.
7. Add Render Environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `ADMIN_PASSWORD`, `SUPABASE_BUCKET=product-images`, `STORE_WHATSAPP`.
8. Deploy. Render supplies the public `onrender.com` URL.
9. Open it in Chrome → Admin.

## Admin login fallback
If Supabase is temporarily unavailable or its URL/key is misconfigured, Admin Login can authenticate with the Render `ADMIN_PASSWORD` environment variable. Product, stock, coupon and order data continue to use Supabase.

## Change password
Admin → Admin Password → enter current password and new password (8+ characters) → Save. The new password is bcrypt-hashed and stored in Supabase.

## Security
Never expose or commit `SUPABASE_SERVICE_ROLE_KEY`. Keep it only in Render Environment Variables.

## Free-tier note
Render Free web services can spin down after 15 minutes of inactivity and their local filesystem is ephemeral. This app therefore stores business data and uploaded images in Supabase. Supabase Free currently has 500 MB database and 1 GB storage limits and can pause projects after inactivity. These limits are suitable for a small hobby/demo store, not a guaranteed production SLA.
