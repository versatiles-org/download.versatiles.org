
# preparation
```bash
brew install hcloud
hcloud context create versatile
```

# setup server
```bash
hcloud server create --location nbg1 --image docker-ce --type cax11 --name download.versatiles.org1 --network download.versatiles.org --volume download.versatiles.org --ssh-key 9919841
sleep 20
hcloud server ssh download.versatiles.org1 "curl 'https://raw.githubusercontent.com/versatiles-org/download.versatiles.org/main/setup.sh' | bash"
```

# update

```bash

```
