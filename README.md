
# preparation
```bash
brew install hcloud
hcloud context create versatile
```

# setup server
```bash
NAME="download.versatiles.org1"
hcloud server create --location nbg1 --image debian-12 --type cax11 --name $NAME --network download.versatiles.org --volume download.versatiles.org --ssh-key 9919841
sleep 30
echo "SECRET=\"$(cat secret.txt)\"" | cat - scripts/setup_server.sh | hcloud server ssh $NAME
hcloud load-balancer add-target download.versatiles.org --server $NAME --use-private-ip
```

# update

```bash

```

# delete server
```bash
NAME="download.versatiles.org1"
sed -i '' -e '/128\.140\.47\.180/d' ~/.ssh/known_hosts
hcloud volume detach download.versatiles.org
hcloud server delete $NAME
```

