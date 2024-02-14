#SECRET="???"
VOLUME="HC_Volume_29360110"

RED='\033[0;31m'
NC='\033[0m'

set -e
set -x

echo -e "${RED}SETUP SYSTEM${NC}"
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - # for node js
apt-get -qq -y update
apt-get -qq -y upgrade
apt-get -qq -y install curl git libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static nginx nodejs supervisor ufw webhook
ufw allow OpenSSH
ufw allow 8080/tcp
ufw allow 9000/tcp
ufw --force enable
git config --global --add safe.directory '*'

echo -e "${RED}MOUNT VOLUME${NC}"
echo "/dev/disk/by-id/scsi-0${VOLUME} /mnt/${VOLUME}/ ext4 rw,nosuid,dev,noexec,auto,nouser,async 0 0" >> /etc/fstab
systemctl daemon-reload
mkdir "/mnt/${VOLUME}/"
mount "/mnt/${VOLUME}/"
ln -s /mnt/HC_Volume_29360110/download/ /var/www/docs

echo -e "${RED}ADD USER${NC}"
chown www-data /var/www/
su - www-data -s /bin/bash
cd /var/www/
git clone https://github.com/versatiles-org/download.versatiles.org.git
cd download.versatiles.org
npm install
npm run start /var/www/docs
exit

echo -e "${RED}CONFIG NGINX${NC}"
mkdir /etc/nginx/sites
mkdir /var/www/logs
rm -r /etc/nginx/sites-available
rm -r /etc/nginx/sites-enabled
rm /etc/nginx/nginx.conf
ln -s /var/www/download.versatiles.org/config/nginx/nginx.conf /etc/nginx/nginx.conf
ln -s /var/www/download.versatiles.org/config/nginx/download.versatiles.org.conf /etc/nginx/sites/download.versatiles.org.conf
nginx -s reload

echo -e "${RED}CONFIG WEBHOOK${NC}"
ln -s /var/www/download.versatiles.org/config/webhook/webhooks.conf /etc/supervisor/conf.d/webhooks.conf
cat /var/www/download.versatiles.org/config/webhook/webhook.yaml | sed "s/%SECRET%/$SECRET/g" > /var/www/webhook.yaml
supervisorctl reload

# reboot
