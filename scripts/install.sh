#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# 1. Install Necessary Tools
echo "Installing necessary tools"

# Install all required packages in one go
apt-get update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y \
   docker-compose \
   docker.io \
   git \
   nodejs \
   sshfs \
   tmux \
   webhook

# 2. User Setup
echo "Creating a new user 'web'..."
if id "web" &>/dev/null; then
   echo "User 'web' already exists."
else
   adduser --disabled-password --gecos "" web
fi

# 3. Prepare SSH Key for SSHFS access (run as root)
echo "Setting up SSH key for SSHFS"
mkdir -p /root/.ssh
nano /root/.ssh/storage
chmod 600 /root/.ssh/storage

#############################################################

# Switch to the 'web' user for project operations
echo "Switching to 'web' user to configure project..."
su - web <<'EOSU'

# 4. Clone Project Repository
echo "Cloning project repository..."
git clone https://github.com/versatiles-org/download.versatiles.org.git
cd download.versatiles.org

# 5. Install Node.js dependencies
echo "Installing Node.js dependencies..."
npm install

# 6. Configure Environment (.env File)
echo "Configuring environment variables..."
cat >.env <<EOT
STORAGE_USERNAME="u??????-????"
STORAGE_URL="${STORAGE_USERNAME}@${STORAGE_USERNAME}.your-storagebox.de"
WEBHOOK_SECRET=$(openssl rand -hex 16)
DOMAIN=download.versatiles.org
EOT

EOSU

#############################################################

# Back to root for SSHFS setup and other root-level tasks
cd /home/web/download.versatiles.org

# Open .env file in nano for user to review and edit
nano .env

source .env
PROJECT_PATH=$(pwd)

# 7. SSHFS Configuration
echo "Configuring SSHFS..."

# Ensure the mount point exists
mkdir -p $PROJECT_PATH/volumes/remote_files

# Add the mount to /etc/fstab
echo "sshfs#$STORAGE_URL:/home/ $PROJECT_PATH/volumes/remote_files fuse defaults,ro,allow_other,port=23,IdentityFile=/root/.ssh/storage 0 0" >>/etc/fstab

# Mount the cloud storage
systemctl daemon-reload
mount -a

# 8. Webhook Configuration
echo "Configuring webhook..."

# Set up webhook configuration
tee /etc/webhook.conf >/dev/null <<EOL
[
   {
      "id": "update",
      "execute-command": "su - web -c '$PROJECT_PATH/scripts/update.sh'",
      "trigger-rule": {
         "match": {
            "type": "value",
            "value": "$WEBHOOK_SECRET",
            "parameter": { "source": "url", "name": "secret" }
         }
      }
   }
]
EOL

# Restart webhook service to apply changes
systemctl restart webhook

echo "Installation complete!"
