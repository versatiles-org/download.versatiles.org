#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e


nano .env
mkdir .ssh
nano .ssh/storage
chmod 600 .ssh/storage

# 1. Install Necessary Tools
echo "Installing necessary tools"

# Install all required packages in one go
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y \
   docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
   git \
   nodejs \
   sshfs \
   tmux \
   ufw

#############################################################

# 4. Clone Project Repository
echo "Cloning project repository..."
git clone https://github.com/versatiles-org/download.versatiles.org.git
cd download.versatiles.org

mkdir -p volumes/local_files
mkdir -p volumes/logs
mkdir -p volumes/nginx_conf
mkdir -p volumes/remote_files

source .env
PROJECT_PATH=$(pwd)

# 7. SSHFS Configuration
echo "Configuring SSHFS..."

# Add the mount to /etc/fstab
printf "\nsshfs#$STORAGE_URL:/home/ $PROJECT_PATH/volumes/remote_files fuse defaults,allow_other,port=23,IdentityFile=$PROJECT_PATH/.ssh/storage 0 0" >>/etc/fstab

# Mount the cloud storage
systemctl daemon-reload
mount -a

echo "Setting up Firewall"

ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw enable

echo "Installation complete!"
