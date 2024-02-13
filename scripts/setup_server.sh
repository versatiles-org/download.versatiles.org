NAME="test.versatiles.org"
VOLUME="HC_Volume_29360110"

RED='\033[0;31m'
NC='\033[0m'

echo -e "${RED}SETUP SYSTEM${NC}"
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - # for node js
apt-get -qq -y update
apt-get -qq -y upgrade
apt-get -qq -y install curl git libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static nginx nodejs supervisor ufw webhook
ufw allow OpenSSH
ufw allow 'Nginx HTTP'
ufw --force enable

echo -e "${RED}ADD USER${NC}"
useradd -m -s /bin/bash web
su web
cd ~
mkdir logs
git clone https://github.com/versatiles-org/download.versatiles.org.git
cd download.versatiles.org
npm install
npm run start
exit

echo -e "${RED}MOUNT VOLUME${NC}"
echo "/dev/disk/by-id/scsi-0${VOLUME} /mnt/${VOLUME}/ ext4 ro,nosuid,dev,noexec,auto,nouser,async 0 0" >> /etc/fstab
systemctl daemon-reload
mkdir "/mnt/${VOLUME}/"
mount "/mnt/${VOLUME}/"

echo -e "${RED}CONFIG NGINX${NC}"
mkdir /etc/nginx/sites
mkdir /var/www/download.versatiles.org
mkdir /var/www/download.versatiles.org/docs
mkdir /var/www/download.versatiles.org/logs
rm -r /etc/nginx/sites-available/
rm -r /etc/nginx/sites-enabled
rm /etc/nginx/nginx.conf
ln -s /home/web/download.versatiles.org/config/nginx/nginx.conf /etc/nginx/nginx.conf
ln -s /home/web/download.versatiles.org/config/nginx/download.versatiles.org.conf /etc/nginx/sites/download.versatiles.org.conf
ln -s /mnt/HC_Volume_29360110/download /var/www/download.versatiles.org/docs
nginx -s reload

echo -e "${RED}CONFIG WEBHOOK${NC}"
ln -s /home/web/download.versatiles.org/config/hooks/webhooks.conf /etc/supervisor/conf.d/webhooks.conf

# reboot