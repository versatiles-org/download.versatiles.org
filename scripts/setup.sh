#!/usr/bin/env bash
#
# Host bootstrap for the download.versatiles.org updater.
#
# Installs rclone (if missing) and writes the two rclone remotes (Hetzner SFTP
# source + Cloudflare R2 destination) from the values in .env, then verifies
# both remotes. Idempotent — safe to re-run.
#
# Usage:  npm run setup     (or: bash scripts/setup.sh)

set -euo pipefail

# Move to the repo root (this script lives in scripts/).
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
	echo "ERROR: .env not found. Copy .env.sample to .env and fill it in." >&2
	exit 1
fi

# Load .env (export every assignment).
set -a
# shellcheck disable=SC1091
source .env
set +a

require() {
	if [ -z "${!1:-}" ]; then
		echo "ERROR: missing required env var: $1 (set it in .env)" >&2
		exit 1
	fi
}
require STORAGE_URL
require RCLONE_SFTP_REMOTE
require RCLONE_R2_REMOTE
require R2_BUCKET
require R2_ACCESS_KEY_ID
require R2_SECRET_ACCESS_KEY
require R2_ENDPOINT

SSH_KEY="${SSH_KEY:-.ssh/storage}"
SSH_PORT="${SSH_PORT:-23}"

# Expand a leading ~ or $HOME so paths like ~/.ssh/id_ed25519 work from .env.
# (The patterns intentionally match the literal text read from .env.)
# shellcheck disable=SC2088,SC2016
case "$SSH_KEY" in
	"~") SSH_KEY="$HOME" ;;
	"~/"*) SSH_KEY="$HOME/${SSH_KEY#\~/}" ;;
	'$HOME/'*) SSH_KEY="$HOME/${SSH_KEY#\$HOME/}" ;;
esac

if [ ! -f "$SSH_KEY" ]; then
	echo "ERROR: SSH key not found at '$SSH_KEY'." >&2
	echo "       Set SSH_KEY in .env to the absolute path of a key authorized on the Storage Box," >&2
	echo "       e.g.  SSH_KEY=\"\$HOME/.ssh/id_ed25519\"" >&2
	exit 1
fi

# Derive SFTP user/host from STORAGE_URL (user@host) and an absolute key path.
SFTP_USER="${STORAGE_URL%@*}"
SFTP_HOST="${STORAGE_URL#*@}"
KEY_FILE="$(cd "$(dirname "$SSH_KEY")" && pwd)/$(basename "$SSH_KEY")"
KNOWN_HOSTS="$HOME/.ssh/known_hosts"

# Pre-flight: connect once over SSH. This verifies the key authenticates AND
# records the Storage Box host key in known_hosts (accept-new) — without it,
# rclone's host-key validation fails on first contact.
echo "Testing SSH connection to $SFTP_HOST ..."
mkdir -p "$HOME/.ssh"
ssh_err="$(mktemp)"
if ! ssh -p "$SSH_PORT" -i "$KEY_FILE" \
	-o IdentitiesOnly=yes \
	-o StrictHostKeyChecking=accept-new \
	-o BatchMode=yes \
	-o ConnectTimeout=15 \
	"$STORAGE_URL" "ls /home" >/dev/null 2>"$ssh_err"; then
	echo "ERROR: could not connect to the Storage Box over SSH:" >&2
	sed 's/^/       /' "$ssh_err" >&2 || true
	rm -f "$ssh_err"
	echo "       Check STORAGE_URL, SSH_PORT, and that SSH_KEY is authorized on the box." >&2
	exit 1
fi
rm -f "$ssh_err"
echo "SSH OK — host key recorded in $KNOWN_HOSTS."

# Install rclone if not present.
if ! command -v rclone >/dev/null 2>&1; then
	echo "Installing rclone..."
	curl -fsSL https://rclone.org/install.sh | sudo bash
fi
echo "rclone: $(rclone version | head -n1)"

echo "Configuring rclone remote '$RCLONE_SFTP_REMOTE' (sftp -> $SFTP_HOST)..."
rclone config delete "$RCLONE_SFTP_REMOTE" 2>/dev/null || true
rclone config create "$RCLONE_SFTP_REMOTE" sftp \
	host "$SFTP_HOST" \
	user "$SFTP_USER" \
	port "$SSH_PORT" \
	key_file "$KEY_FILE" \
	known_hosts_file "$KNOWN_HOSTS" \
	shell_type none \
	disable_hashcheck true \
	--non-interactive >/dev/null

echo "Configuring rclone remote '$RCLONE_R2_REMOTE' (s3 -> R2)..."
rclone config delete "$RCLONE_R2_REMOTE" 2>/dev/null || true
rclone config create "$RCLONE_R2_REMOTE" s3 \
	provider Cloudflare \
	access_key_id "$R2_ACCESS_KEY_ID" \
	secret_access_key "$R2_SECRET_ACCESS_KEY" \
	endpoint "$R2_ENDPOINT" \
	region auto \
	no_check_bucket true \
	--non-interactive >/dev/null

echo
echo "Verifying SFTP remote — dataset folders should be listed below:"
echo "-----------------------------------------------------------------"
rclone lsd "$RCLONE_SFTP_REMOTE:"
echo "-----------------------------------------------------------------"
echo "If the folders above are EMPTY but appear under '$RCLONE_SFTP_REMOTE:home',"
echo "set RCLONE_SFTP_STRIP_PREFIX=\"/\" in .env and re-run."
echo

echo "Verifying R2 remote (write/read/delete round-trip)..."
echo "ok" | rclone rcat "$RCLONE_R2_REMOTE:$R2_BUCKET/_healthcheck.txt"
test "$(rclone cat "$RCLONE_R2_REMOTE:$R2_BUCKET/_healthcheck.txt")" = "ok"
rclone deletefile "$RCLONE_R2_REMOTE:$R2_BUCKET/_healthcheck.txt"
echo "R2 remote OK."

echo
echo "Setup complete. Next: run the one-time bulk copy (see README), then 'npm run once'."
