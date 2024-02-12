DOMAIN="test.versatiles.org"

RED='\033[0;31m'
NC='\033[0m'

echo -e "${RED}SETUP SYSTEM${NC}"
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - # for node js
apt-get -qq -y update
apt-get -qq -y upgrade
apt-get -qq -y install curl git nginx nodejs supervisor ufw webhook
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

echo -e "${RED}CONFIG WEBHOOK${NC}"
ln -s /home/web/download.versatiles.org/webhook/webhooks.conf /etc/supervisor/conf.d/webhooks.conf

echo -e "${RED}CONFIG NGINX${NC}"
cp /home/web/download.versatiles.org/nginx/nginx.conf /etc/nginx/
mkdir /etc/nginx/sites/
cp /home/web/download.versatiles.org/nginx/download.versatiles.org.conf /etc/nginx/sites/
ln -s /mnt/HC_Volume_29360110/download /var/www/download.versatiles.org/docs

# reboot