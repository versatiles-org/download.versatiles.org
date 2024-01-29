RED='\033[0;31m'
NC='\033[0m'

echo -e "${RED}SETUP SYSTEM${NC}"
apt-get -qq -y update
apt-get -qq -y upgrade
apt-get -qq -y install certbot curl git nginx python3-certbot-nginx supervisor ufw webhook
ufw allow OpenSSH
ufw allow 'Nginx HTTP'
ufw enable

echo -e "${RED}CONFIG CERTBOT${NC}"
certbot certonly --webroot -w /var/www/example -d example.com -d www.example.com

echo -e "${RED}ADD USER${NC}"
useradd -m -g docker -s /bin/bash web
su web
cd ~
mkdir logs
git clone https://github.com/versatiles-org/download.versatiles.org.git
cd download.versatiles.org
exit
cp /home/web/download.versatiles.org/webhooks.conf /etc/supervisor/conf.d/

# reboot