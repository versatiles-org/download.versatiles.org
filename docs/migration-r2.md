# Migration Plan: download.versatiles.org → Cloudflare R2 (issue #22)

Re-implement **download.versatiles.org** as a standalone, **Node.js-only** project that
(1) mirrors `.versatiles` data from the Hetzner Storage Box to **Cloudflare R2**, and
(2) builds and publishes the static download website — served **directly from object
storage** over our own domain (no reverse proxy, no per-GB egress, no redirects).

## 1. What this repo does today

The current project is a **build pipeline + serving stack**, orchestrated by `src/lib/run.ts`:

| Step | Code | Fate in migration |
|------|------|-------------------|
| Scan `volumes/remote_files` (sshfs mount) for `*.versatiles` | `file_ref.ts::getAllFilesRecursive` | **Keep** (repoint at SFTP listing) |
| Compute/load `.md5`/`.sha256` sidecars over SSH | `hashes.ts::generateHashes` | **Replace** with newer tiles-repo version |
| Group files, pick "latest", strip date suffix | `file_group.ts::groupFiles` | **Keep as-is** (storage-agnostic) |
| Mirror "local" files to fast SSD | `sync.ts::downloadLocalFiles` | **Drop** (replaced by rclone → R2) |
| Render `index.html` + `feed-<slug>.xml` | `template.ts` + `template/*` | **Keep**, retarget output to R2 upload |
| Build md5/sha256/urllist as nginx inline strings | `file_response.ts`, `FileGroup.getResponses` | **Repurpose** → upload as real objects |
| Render nginx config | `nginx.ts` + `template/nginx.conf` | **Drop entirely** |
| `/update` webhook server | `server.ts` | **Drop** (manual trigger) |
| Serve via SWAG (nginx+certbot) in Docker | `compose.yaml`, `scripts/*.sh` | **Drop entirely** |

Roughly half the codebase is lifted, half deleted; one new capability is added:
**mirror-to-R2 + upload-site-to-R2**.

## 2. Target architecture

```
Hetzner Storage Box ──[SFTP]──> Node updater (manual run, small VPS)
                                  1. scan *.versatiles + sidecars
                                  2. rclone delta-sync → R2   (data + sidecars)
                                  3. build HTML/RSS from file list
                                  4. upload site → R2         (LAST = atomic publish)
                                          │
                                  Cloudflare R2 (EU) + custom domain + Worker
                                          │
                              https://download.versatiles.org/<key>  ($0 egress, no redirects)
```

## 3. Decisions (locked)

1. **Hashing** — Sidecars + fallback compute. Lift the newer `hashes.ts` from
   `tiles.versatiles.org/download/src/lib/file/hashes.ts`: SSH `cat` existing
   `.md5`/`.sha256`, fall back to remote `md5sum`/`sha256sum` and SCP the computed
   sidecar back for future runs; local hash cache; concurrency (8 download / 1 compute).
   ⚠️ Never use the R2/S3 ETag as the hash (multipart ETag ≠ MD5).
2. **Site hosting** — Cloudflare Worker with R2/static-assets binding on the one
   hostname; `/` → `index.html` + clean routes. Data keys stream directly from R2.
3. **Updater host / trigger** — Tiny VPS near the data, **manually triggered** (no cron
   scheduler). Operator runs `npm run once` over SSH. Monitoring = exit code +
   last-success, not missed-schedule alerts.
4. **Archival** — Keep dated `<slug>.<date>.versatiles` copies public; RSS /
   previous-versions stays working.

### Knock-on effects
- **FileRef becomes remote-path-aware** (`remotePath`, no local `statSync`). Lift the
  tiles repo's evolved `FileRef` alongside its `hashes.ts` where newer.
- **No webhook server** — manual trigger means `server.ts` and `/update` are removed
  unconditionally.

## 4. Bucket layout & naming convention

No central catalog file. Consumers rely on a predictable key convention + sidecars:

- `https://download.versatiles.org/<slug>.versatiles` — stable "latest" key (overwritten in place).
- `<slug>.versatiles.md5` and `.sha256` — sidecars (integrity + change detection).
- `<slug>.<date>.versatiles` (+ sidecars) — dated archival copies.
- Website assets (`index.html`, CSS/JS, `feed-<slug>.xml`, `urllist_<slug>.tsv`) under their own keys.

## 5. Implementation phases

### Phase 0 — Infra provisioning (out-of-repo prerequisite)
- R2 bucket (EU jurisdiction hint), S3 API token, custom domain, CF-managed cert.
- Bucket CORS + default `Content-Type` (`application/octet-stream` for `.versatiles`)
  so browser `fetch` + HTTP range/resume work.
- One-time bulk `rclone copy` Hetzner → R2, verify with `rclone check`.
- Install/configure `rclone` on the VPS (SFTP remote + R2 S3 remote).

### Phase 1 — Strip the serving stack from the repo
- Delete `src/lib/nginx/`, `template/nginx.conf`, `src/lib/file/sync.ts` (+ tests).
- Delete `src/server.ts` (+ test), `compose.yaml`, `scripts/run.sh`, `scripts/install.sh`, `.dockerignore`.
- Remove `express`/`cookie`/`supertest` runtime deps; remove `server` npm script;
  remove the `Webhook` step from `.github/workflows/ci.yml`.
- Keep `dev.ts` for local template preview (express stays as a **devDependency**).

### Phase 2 — Remote-aware scan + hashing (lift from tiles repo)
- Lift the evolved `FileRef` (remote-path-aware) and `hashes.ts` from the tiles repo.
- Add a `lib/source/` SFTP listing of `*.versatiles` + sidecars (replaces sshfs walk),
  reusing `STORAGE_URL` / `.ssh/storage`.
- Keep `groupFiles` and date-suffix/latest logic unchanged.

### Phase 3 — rclone mirror wrapper (data plane)
- `lib/mirror/rclone.ts`: Node orchestrates, rclone moves bytes. Delta `sync`/`copy`
  SFTP → R2 (multipart/retry/resume), mirror sidecars as-is, write to the key convention.
- Change detection from sidecar hashes, **not** ETag.

### Phase 4 — Site generation retargeted to R2
- Keep `template.ts` + `template/index.html` + `template/feed.xml`.
- Reuse content-generation from `file_response.ts` / `FileGroup.getResponses`, but
  upload **real objects** to R2 (`index.html`, `feed-<slug>.xml`, `<file>.md5/.sha256`,
  `urllist_<slug>.tsv`) instead of nginx inline strings.

### Phase 5 — Orchestration + atomic publish
- Rewrite `run.ts`: scan → mirror data+sidecars → build site → **upload site last**.
- `run_once.ts` is the single batch entry point (`npm run once`); structured logging;
  non-zero exit on failure.

### Phase 6 — Cloudflare Worker
- Small Worker (R2 binding / static-assets) for `/` → `index.html` + clean routes.
  Data files need no Worker. Keep in `worker/` with `wrangler` config.

### Phase 7 — Manual trigger, cutover, verification
- Operator runs `npm run once` on the VPS (optionally a minimal authed trigger later).
- Verify: absolute URLs serve bytes directly over HTTPS, range/resume works, no `302`,
  CORS OK for browser `fetch`.
- Cut `download.versatiles.org` DNS over to R2 / Worker route.
- Update `README.md` (architecture, scripts, maintenance banner).

### Phase 8 — Follow-up in `tiles.versatiles.org` (separate repo)
- Remove old `download/` pipeline, WebDAV proxy, nginx download vhost, `versatiles.yaml`.

## 6. Testing strategy
- Keep unit tests for lifted modules (`file_group`, `file_ref`, `hashes`, `template`).
- New tests: SFTP scan (mock), rclone wrapper (mock child process / assert argv),
  R2 upload sink (mock S3 client), **publish-ordering invariant** (site after data).
- Drop nginx/sync/server tests.

## 7. Risks / watch-items
- FileRef refactor ripples across call sites.
- ETag ≠ MD5 for multipart — always use sidecars.
- Atomic publish ordering is the key correctness guarantee.
- `dev.ts` depends on express — keep as devDependency.
- README "no longer maintained → tiles repo" banner contradicts #22 (which re-homes the
  project here) — reconcile with maintainer.

## 8. Workflow
Implement **phase by phase**; after each phase, pause for the maintainer to review and
commit before continuing.
