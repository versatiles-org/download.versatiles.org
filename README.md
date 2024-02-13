
# preparation
```bash
brew install hcloud
hcloud context create versatile
```

# setup server
```bash
NAME="download.versatiles.org1"
hcloud server create --location nbg1 --image debian-12 --type cax11 --name $NAME --network download.versatiles.org --volume download.versatiles.org --ssh-key 9919841
sleep 20
hcloud server ssh $NAME "curl 'https://raw.githubusercontent.com/versatiles-org/download.versatiles.org/main/scripts/setup_server.sh' | bash"
```

# update

```bash

```

# delete server
```bash
NAME="download.versatiles.org1"
hcloud volume detach download.versatiles.org
hcloud server delete $NAME
```

