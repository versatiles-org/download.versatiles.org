apt-get -qq -y update
apt-get -qq -y upgrade
apt-get -qq -y install ca-certificates curl git supervisor webhook
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get -qq -y update
apt-get -qq -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
useradd -m -g docker -s /bin/bash web
su web
cd ~
mkdir logs
git clone https://github.com/versatiles-org/download.versatiles.org.git
cd download.versatiles.org
exit
cp /home/web/download.versatiles.org/webhooks.conf /etc/supervisor/conf.d/

reboot