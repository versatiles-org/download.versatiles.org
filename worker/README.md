# download.versatiles.org — Cloudflare Worker

R2 custom domains serve objects by exact key but have **no directory-index**
behaviour (`/` does not map to `index.html`). This Worker fronts the R2 bucket
and provides that, plus range/CORS handling. It is **host-agnostic**, so the same
Worker serves both `download.versatiles.cloud` and the SaaS custom hostname
`download.versatiles.org`.

## What it does

- `/` and any path ending in `/` → serves `…/index.html`
- every other path → streams the matching R2 object by key (data files included)
- forwards HTTP `Range` and conditional headers → download **resume** works
  (`206 Partial Content` / `304 Not Modified`)
- permissive **CORS** so browser `fetch()` works cross-origin

Worker → R2 traffic is free, so serving large data files through the Worker still
incurs **no egress fee**.

## Architecture (Plan B — keep versatiles.org DNS where it is)

```
versatiles.org DNS (current provider, unchanged)
  download  CNAME ─────────────┐  + ACM cert-validation record
                               ▼
Cloudflare zone: versatiles.cloud (full setup, Free plan)
  • Cloudflare for SaaS custom hostname: download.versatiles.org
  • fallback origin: download.versatiles.cloud  (originless AAAA 100::, proxied)
  • Workers route: */*  →  this Worker
  • this Worker streams from ↓
Cloudflare R2 bucket "download-versatiles-org" (EU)  ── $0 egress ──▶ client
```

`download.versatiles.cloud` also resolves to the Worker (via the `*/*` route),
which is handy for testing before the `.org` custom hostname is live.

## Deploy

1. Make sure `versatiles.cloud` is an **active zone** in this Cloudflare account
   and the R2 bucket exists (`bucket_name` / `jurisdiction` in `wrangler.toml`).
2. Upload the Worker:

   ```bash
   cd worker
   npm install
   npm run deploy        # wrangler deploy (uploads the script + R2 binding)
   ```

   `wrangler.toml` declares no routes — routing is set up in the dashboard below.

## Cloudflare dashboard configuration (one-time)

On the **versatiles.cloud** zone:

1. **DNS** → add the fallback-origin record (originless, **proxied / orange-cloud**):
   - Type `AAAA`, Name `download`, IPv6 `100::`, Proxy **on**.
2. **Workers Routes** → **Add route**: pattern `*/*`, Worker = `download-versatiles-org`.
   (This sends the whole zone — and every SaaS custom hostname — to the Worker.)
3. **SSL/TLS → Custom Hostnames** (Cloudflare for SaaS):
   - Set the **Fallback origin** to `download.versatiles.cloud`.
   - **Add custom hostname** `download.versatiles.org` (certificate validation
     method: TXT or HTTP). Cloudflare shows the records to add.

On the **versatiles.org** DNS (current provider, unchanged otherwise) add **two
records** Cloudflare gives you:

4. `CNAME` `download` → `download.versatiles.cloud` (the fallback origin / CNAME target).
5. the **certificate-validation** record (TXT or CNAME) shown by the custom-hostname wizard.

When the custom hostname shows **Active** (cert issued + hostname validated),
`https://download.versatiles.org/` serves the site and `…/<slug>.versatiles`
streams the bytes directly — no redirect.

Local dev: `npm run dev` (uses a local/preview R2 binding).
