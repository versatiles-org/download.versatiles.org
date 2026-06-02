# download.versatiles.org — Cloudflare Worker

R2 custom domains serve objects by exact key but have **no directory-index**
behaviour (`/` does not map to `index.html`). This Worker fronts the bucket on
the public hostname and provides that, plus range/CORS handling.

## What it does

- `/` and any path ending in `/` → serves `…/index.html`
- every other path → streams the matching R2 object by key (data files included)
- forwards HTTP `Range` and conditional headers to R2 → download **resume** works
  (`206 Partial Content`, `304 Not Modified`)
- permissive **CORS** so browser `fetch()` works cross-origin

Worker → R2 traffic is free, so serving large data files through the Worker still
incurs **no egress fee**.

## Setup

1. Create the R2 bucket (EU jurisdiction) — the same bucket the updater mirrors
   into (`R2_BUCKET`). Adjust `bucket_name` in `wrangler.toml` if it differs.
2. Install deps and deploy:

   ```bash
   cd worker
   npm install
   npm run deploy        # wrangler deploy
   ```

3. `wrangler` will bind the Worker to `download.versatiles.org` as a custom
   domain (Cloudflare-managed cert). DNS for the hostname must be on this
   Cloudflare account.

Local dev: `npm run dev` (uses a local/preview R2 binding).

## Alternative architecture

If you would rather have R2's **own** custom domain serve the data files directly
(so bytes never pass through the Worker), point the data keys at the R2 custom
domain and scope this Worker to the site root only. The single-Worker setup here
is simpler to operate on one hostname and is the default.
