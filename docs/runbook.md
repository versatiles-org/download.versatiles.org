# Runbook

How to operate download.versatiles.org: what to do when the monthly update fails, how to
publish a new release or a new dataset, and how to replace credentials. For how the
updater works, see the [README](../README.md).

## The monthly update failed

The [Update workflow](../.github/workflows/update.yml) runs on the 20th. Open the failed
run under _Actions → Update_; its summary shows the plan, and the error names the cause.

| Message                                                             | Meaning                                                                               | What to do                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Uploads greater than 80 GB were skipped`                           | Everything else was updated. The named files are too large for a hosted runner.       | [Upload them from a server](#uploading-a-large-file-from-a-server).                                          |
| `Preflight failed` … `Storage Box: cannot list`                     | SSH to the Storage Box failed: key removed, box unreachable, or the host key changed. | Read the reason after the dash. For a host key change see [below](#the-storage-box-host-key-changed).        |
| `Preflight failed` … `rclone remote "hetzner"`                      | rclone could not log in over SFTP, although ssh could.                                | Usually the host key: `STORAGE_KNOWN_HOSTS` must contain the key type rclone is offered.                     |
| `Preflight failed` … `rclone remote "r2"`                           | R2 rejected the credentials or the endpoint is wrong.                                 | Check the R2 token, and that `R2_ENDPOINT` is the `.eu.` form without a bucket path.                         |
| `Invalid configuration`                                             | A setting is missing or malformed.                                                    | The message lists each one. Fix it in the `updater` environment.                                             |
| `Found a file on the Storage Box that belongs to no known dataset`  | A `.versatiles` file under `STORAGE_ROOT` has a name that matches no dataset.         | Rename or move the file, or [add the dataset](#adding-a-dataset).                                            |
| `Could not reach the Storage Box while …`                           | The connection dropped during hashing, after three attempts.                          | Run the workflow again.                                                                                      |
| `rclone failed to upload …`, or the job hit its time limit          | A transfer failed or took longer than 350 minutes.                                    | Run it again. Nothing is half-published; a cut-off upload leaves no object behind.                           |
| `… has N bytes on R2 after the transfer`, `… carries md5 …`         | The object read back from R2 is not the file that was sent.                           | Run it again; the file is uploaded anew. If it repeats, compare the file and its sidecar on the Storage Box. |
| Warning `No update was run: the 'updater' environment is missing …` | The run did nothing (and counts as successful).                                       | Add the named secrets and variables.                                                                         |

Before running again, a dry run shows what would happen without changing anything:
_Run workflow_ with **Only report what an update would do** ticked.

If no run appears on the 20th at all: GitHub disables scheduled workflows in a repository
without activity for 60 days, and re-enables them with a button on the workflow's page.

## Uploading a large file from a server

Needed for any upload above the workflow's limit — today satellite, elevation and
hillshade-vectors. Use a host that can run for a day or more without interruption.

1. Make sure no Update workflow is running, and none is about to start. The lock file only
   keeps runs on the same machine apart.
2. Bring the checkout up to date and install:

   ```bash
   git pull
   npm ci
   ```

3. On a new host, create `.env` from [`.env.sample`](../.env.sample) — with
   `MAX_UPLOAD_GB` left unset — and run `npm run setup` once. It installs rclone, creates
   the two remotes and tests both.
4. Look at the plan, then run it inside `tmux` or `screen`, so that it survives a dropped
   SSH session:

   ```bash
   npm run once -- --dry-run
   npm run once
   ```

5. Afterwards the next workflow run is green again. To see that straight away, start it by
   hand.

If the run is interrupted, start it again: files that are already on R2 are skipped. The
file that was in transit starts from the beginning.

## Publishing a new release

1. Put the file on the Storage Box, inside `STORAGE_ROOT`. Name it
   `<slug>.<YYYYMMDD>.versatiles` to keep earlier releases available as well (as for
   `osm`), or `<slug>.versatiles` to replace the dataset in place.
2. Optionally put `<file>.md5` and `<file>.sha256` next to it, in `md5sum` / `sha256sum`
   format. Without them the updater computes both on the Storage Box, which reads the
   whole file twice and takes a long time for a large one. A sidecar that is older than
   its data file is ignored and recomputed.
3. Wait for the 20th, or start the Update workflow by hand.

Until the upload has happened, the site keeps showing the previous release. This also
holds for a release above the size limit, until it has been uploaded from a server.

## Adding a dataset

1. Add an entry to [`src/lib/file/datasets.ts`](../src/lib/file/datasets.ts). Its key is
   the slug: the part of the file name before the first dot.
2. Run `npm run check`, commit and push.
3. [Publish its first release](#publishing-a-new-release).

Do it in this order. A file whose dataset is not in the table yet stops every update.

## Removing a release or a dataset

The updater never deletes anything from R2. A file that is removed from the Storage Box
disappears from the site at the next update, but its object, its checksum files and its
size index stay on R2 and remain downloadable by URL. To remove them as well:

```bash
rclone deletefile r2:<bucket>/<file>.versatiles
rclone deletefile r2:<bucket>/<file>.versatiles.md5
rclone deletefile r2:<bucket>/<file>.versatiles.sha256
rclone deletefile r2:<bucket>/<file>.versatiles.index.json   # latest releases only
```

For a whole dataset, also delete `feed-<slug>.xml` and `urllist_<slug>.tsv`, and remove
its entry from `datasets.ts`.

## Replacing credentials

All of them live in GitHub environments (_Settings → Environments_): `updater` for the
update workflow, `worker` for the worker deployment. A server has its own copies in
`.env` and in the rclone configuration; after changing them there, run `npm run setup`.

### Storage Box SSH key

```bash
ssh-keygen -t ed25519 -N '' -C 'github-updater' -f updater_key
cat updater_key.pub | ssh -p 23 <user>@<host> install-ssh-key
```

Put the content of `updater_key` into the secret `STORAGE_SSH_KEY`, start a dry run to
confirm it works, then remove the old public key from `.ssh/authorized_keys` on the
Storage Box and delete the local key files.

### The Storage Box host key changed

A run then fails with `Host key verification failed` or `knownhosts: key mismatch`. Do not
simply accept the new key: confirm with Hetzner (the Storage Box page in their console, or
their documentation of the current host keys) that the box was given a new one. Then
replace the variable `STORAGE_KNOWN_HOSTS` with the new line, in the form
`[<host>]:23 ssh-ed25519 AAAA…`.

### R2 access key

Create a new R2 API token with _Object Read & Write_ on the bucket, put its access key id
and secret access key into `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, confirm with a
dry run, then delete the old token in the Cloudflare dashboard.

### Cloudflare API token for the worker

The token in `CLOUDFLARE_API_TOKEN` (environment `worker`) **expires on 11 October 2030**.
A deployment then fails with `Invalid access token`. Create a new one from the _Edit
Cloudflare Workers_ template, limited to the account, replace the secret, and deploy as
described below.

## The worker

A push to `main` that changes `worker/` deploys it, after all checks have passed. To
deploy without a change, start the CI workflow by hand on `main` with **Deploy the worker
afterwards** ticked.

To go back to the previous version, use the _Deployments_ tab of the worker in the
Cloudflare dashboard, or `npx wrangler rollback` in `worker/`. Then revert the commit, or
the next change to `worker/` deploys it again.

The [verification checklist](../README.md#verification-checklist) in the README lists
what to check afterwards.

## Updating rclone in the workflow

The update workflow installs a pinned rclone release, which Dependabot does not update.
To move to a newer one, change both values at the top of
[`update.yml`](../.github/workflows/update.yml): `PINNED_RCLONE_VERSION`, and
`PINNED_RCLONE_SHA256` with the line for `rclone-<version>-linux-amd64.deb` from
`https://downloads.rclone.org/<version>/SHA256SUMS`. Start a dry run afterwards.
