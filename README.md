# download.versatiles.org

> [!NOTE]
> This repository is being re-implemented as a standalone, **Node.js-only** updater that
> serves data and the website directly from **Cloudflare R2** (see
> [issue #22](https://github.com/versatiles-org/download.versatiles.org/issues/22)).
> The previous NGINX/WebDAV serving stack has been removed.

[![Code Coverage](https://codecov.io/gh/versatiles-org/download.versatiles.org/branch/main/graph/badge.svg?token=IDHAI13M0K)](https://codecov.io/gh/versatiles-org/download.versatiles.org)
[![GitHub Workflow Status)](https://img.shields.io/github/actions/workflow/status/versatiles-org/download.versatiles.org/ci.yml)](https://github.com/versatiles-org/download.versatiles.org/actions/workflows/ci.yml)

## Project Outline

This repository powers **<https://download.versatiles.org>** — the public distribution
endpoint for VersaTiles datasets.

It is a **batch updater** (not a web server). On each run it:

- scans the Hetzner Storage Box for `.versatiles` files over SSH
- downloads the existing `.md5` / `.sha256` sidecars (or computes & uploads them if missing)
- groups files into datasets and identifies the latest version of each
- mirrors the data files to a **Cloudflare R2** bucket using `rclone` (delta sync)
- builds the website (`index.html`, per-dataset RSS feeds, checksum sidecars, url lists)
  and uploads it to R2

The data and the website are then served **directly from R2** over our own domain — no
reverse proxy in the request path, no per-GB egress fees, and no redirects. A small
[Cloudflare Worker](worker/) provides the `/` → `index.html` routing that R2 custom
domains lack.

## Architecture

```
Hetzner Storage Box  (source of truth — where .versatiles files are produced)
        │
        │   Node.js updater  (manual run on a small persistent host)
        │   1. scan Hetzner for *.versatiles (+ .md5/.sha256 sidecars)   src/lib/source
        │   2. download/compute hashes                                   src/lib/file/hashes.ts
        │   3. mirror changed data → R2  (rclone, S3 API)                src/lib/mirror
        │   4. build the static site (SvelteKit prerender) + sidecars    src/lib/site, src/routes
        │   5. upload site → R2          (LAST = atomic publish)
        ▼
Cloudflare R2 bucket  ── custom domain + Worker, $0 egress ──▶  https://download.versatiles.org/…
        │                                                          (data + sidecars + website)
        └──▶ consumed by the versatiles tile-server (resolves <slug> → URL via the convention below)
```

**Atomic publish:** the data files are mirrored _before_ the site is uploaded, so the
site never advertises a file that isn't fully present on R2.

## Bucket layout & naming convention

There is no central catalog file — consumers rely on a predictable key convention plus
the sidecars:

- `https://download.versatiles.org/<slug>.versatiles` — stable "latest" key (overwritten in place)
- `…/<slug>.versatiles.md5` and `.sha256` — sidecars (integrity + change detection)
- `…/<slug>.<date>.versatiles` (+ sidecars) — dated archival copies
- website assets (`index.html`, `feed-<slug>.xml`, `urllist_<slug>.tsv`) under their own keys

> ⚠️ Change detection uses the **MD5 from the sidecar**, never the R2/S3 ETag — for
> multipart (multi-GB) uploads the ETag is not the MD5.

## Development (frontend preview)

The website is a [SvelteKit](https://svelte.dev/) app prerendered with
`adapter-static`. To work on it you don't need any cloud access — `npm run dev`
generates sample data and starts the Vite dev server:

```bash
git clone https://github.com/versatiles-org/download.versatiles.org.git
cd download.versatiles.org
npm install
npm run dev
```

Then edit [`src/routes/+page.svelte`](src/routes/+page.svelte) (and
[`src/lib/ConvertHelper.svelte`](src/lib/ConvertHelper.svelte)) and reload
`http://localhost:5173`. Sample data comes from
[`src/generate_testdata.ts`](src/generate_testdata.ts); dataset titles and
descriptions live in [`src/lib/file/file_group.ts`](src/lib/file/file_group.ts).

## Configuration

The updater is configured via environment variables (see [`.env.sample`](.env.sample)):

| Variable             | Required | Description                                                                 |
| -------------------- | -------- | --------------------------------------------------------------------------- |
| `DOMAIN`             | yes      | Public domain used to build absolute URLs (e.g. `download.versatiles.org`). |
| `STORAGE_URL`        | yes      | SSH target of the Storage Box (`user@host`).                                |
| `SSH_KEY`            | no       | SSH identity file (default `.ssh/storage`).                                 |
| `RCLONE_SFTP_REMOTE` | yes      | Name of the configured rclone SFTP remote (source).                         |
| `RCLONE_R2_REMOTE`   | yes      | Name of the configured rclone S3/R2 remote (destination).                   |
| `R2_BUCKET`          | yes      | Target R2 bucket name.                                                      |
| `RCLONE_BIN`         | no       | Path to the rclone executable (default `rclone`).                           |

The host also needs `rclone` installed with the two remotes configured in `rclone.conf`
(an SFTP remote for Hetzner and an S3 remote for R2).

## Running the updater

The updater is a one-shot job, **triggered manually** on a small persistent host near the
data (not GitHub Actions — a single multi-TB file would exceed runner limits):

```bash
npm run once
```

It exits non-zero on failure, so it is easy to wrap in monitoring/alerting. For the very
first sync, do the initial multi-TB bulk copy by hand with `rclone copy` (and verify with
`rclone check`); subsequent runs only transfer the deltas.

## Cloudflare Worker

The site root routing, range/resume and CORS handling live in [`worker/`](worker/). See
[`worker/README.md`](worker/README.md) for deployment.

## Verification checklist

After a deploy / cutover, confirm:

- [ ] `https://download.versatiles.org/` returns the HTML index (Worker `/ → index.html`)
- [ ] `https://download.versatiles.org/<slug>.versatiles` streams the bytes directly (HTTP 200, **no redirect**)
- [ ] HTTP range/resume works: `curl -r 0-1023 …/<slug>.versatiles` returns `206 Partial Content`
- [ ] sidecars resolve: `…/<slug>.versatiles.md5` and `.sha256`
- [ ] browser `fetch()` works cross-origin (CORS headers present)
- [ ] `Content-Type` of `.versatiles` objects is `application/octet-stream`

## Available Scripts

- **`npm run setup`**: Installs & configures rclone on the host from `.env`.
- **`npm run once`**: Runs the updater once (`run_once.ts`).
- **`npm run dev`**: Generates sample data and starts the SvelteKit dev server.
- **`npm run build:site`**: Prerenders the static site to `build/` (`vite build`).
- **`npm run check`**: Runs lint + typecheck + tests.
- **`npm run lint`** / **`npm run format`**: ESLint / Prettier.
- **`npm run typecheck`**: `svelte-check` + `tsc`.
- **`npm run test`** / **`npm run test-coverage`**: Vitest.
- **`npm run upgrade`**: Updates dependencies.

## Running Tests

The project uses **Vitest** for unit tests.

```bash
npm test            # run the suite
npm run test-coverage   # with coverage
```

## Code Structure Overview

- **`src/lib/source/`** — SSH/SFTP helpers and the remote file scan (`scan.ts`, `ssh.ts`).
- **`src/lib/file/`** — core domain types: `FileRef`, `FileGroup` (dataset metadata), `FileResponse`, hash/sidecar handling.
- **`src/lib/mirror/`** — the `rclone` wrapper (`mirrorToR2`, `uploadObject`, `uploadDir`).
- **`src/lib/site/`** — writes `data/fileGroups.json`, runs `vite build`, uploads the site + sidecars to R2.
- **`src/lib/run.ts`** — orchestrates the whole pipeline.
- **`src/routes/`**, **`src/lib/data.ts`**, **`src/lib/ConvertHelper.svelte`**, **`src/app.html`** — the SvelteKit frontend.
- **`src/generate_testdata.ts`** — sample data for local dev.
- **`src/run_once.ts`** — manual one-shot entry point.
- **`worker/`** — the Cloudflare Worker that fronts the R2 bucket.

## Contributing

Contributions are welcome! Please submit a pull request or open an issue for any
improvements or bugs you find.

## Dependency Graph

<!--- This chapter is generated automatically --->

```mermaid
---
config:
  layout: elk
---
flowchart TB

subgraph 0["src"]
1["generate_testdata.ts"]
subgraph 2["lib"]
subgraph 3["file"]
4["file_group.ts"]
5["file_ref.ts"]
6["file_response.ts"]
9["hashes.ts"]
end
7["ConvertHelper.svelte"]
8["data.ts"]
subgraph A["source"]
B["ssh.ts"]
H["scan.ts"]
end
subgraph C["mirror"]
D["rclone.ts"]
end
E["run.ts"]
subgraph F["site"]
G["site.ts"]
end
end
subgraph I["routes"]
J["+layout.server.ts"]
K["+layout.svelte"]
L["+page.server.ts"]
M["+page.svelte"]
subgraph N["feed-[slug].xml"]
O["+server.ts"]
end
end
P["run_once.ts"]
end
1-->4
1-->5
4-->5
4-->6
5-->6
9-->B
E-->4
E-->9
E-->D
E-->G
E-->H
G-->D
H-->5
H-->B
P-->E

class 0,2,3,A,C,F,I,N subgraphs;
classDef subgraphs fill-opacity:0.1, fill:#888, color:#888, stroke:#888;
```

## License

This project is licensed under the MIT License.
