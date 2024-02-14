#!/bin/bash
cd "$(dirname "$0")"
set -e

NAME="download.versatiles.org"
hcloud server create --location nbg1 --image debian-12 --type cax11 --name $NAME --network download.versatiles.org --volume download.versatiles.org --ssh-key 9919841
sleep 30
echo "SECRET=\"$(cat secret.txt)\"" | cat - scripts/setup_server.sh | hcloud server ssh $NAME
hcloud load-balancer add-target download.versatiles.org --server $NAME --use-private-ip
