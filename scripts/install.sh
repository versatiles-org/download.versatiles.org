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
   npm \
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

#############################################################

# Switch to the 'web' user for subsequent operations
echo "Switching to the 'web' user..."
su web

cd $HOME

# 3. Clone Project Repository
echo "Cloning project repository..."
git clone https://github.com/versatiles-org/download.versatiles.org.git
cd download.versatiles.org

# 4. Install Node.js dependencies
echo "Installing Node.js dependencies..."
npm install

# 4. Configure Environment (.env File)
echo "Configuring environment variables..."

# Create default .env file with dummy values
cat >.env  <<EOT
STORAGE_URL="u417480-sub1@u417480-sub1.your-storagebox.de"
WEBHOOK_SECRET=$(openssl rand -hex 16)
DOMAIN=download.versatiles.org
EOT

# Open .env file in nano for user to review and edit
nano .env

exit

####################################################

cd /home/web/download.versatiles.org
source .env
PROJECT_PATH=$(pwd)

# 5. SSHFS Configuration
echo "Configuring SSHFS..."

nano /root/.ssh/storage
chmod 600 /root/.ssh/storage

# Ensure the mount point exists
mkdir -p $PROJECT_PATH/volumes/remote_files

# Add the mount to /etc/fstab
echo "sshfs#$STORAGE_URL:/home/ $PROJECT_PATH/volumes/remote_files fuse defaults,ro,allow_other,port=23,IdentityFile=/root/.ssh/storage 0 0" >>/etc/fstab

# Mount the cloud storage
systemctl daemon-reload
mount -a

# 6. Webhook Configuration
echo "Configuring webhook..."

# Set up webhook to trigger npm run start when a request is received
mkdir /etc/webhook
tee /etc/webhook.conf >/dev/null <<EOL
[
   {
      "id": "update",
      "execute-command": "/usr/bin/npm",
      "command-working-directory": "$PROJECT_PATH",
      "pass-arguments-to-command": [
         {
            "source": "string",
            "name": "run"
         },
         {
            "source": "string",
            "name": "start"
         }
      ],
      "trigger-rule": {
         "match": {
            "type": "value",
            "value": "$WEBHOOK_SECRET",
            "parameter": {
               "source": "url",
               "name": "secret"
            }
         }
      }
   }
]
EOL

# Restart webhook service to apply changes
systemctl restart webhook

echo "Installation complete!"
