
# preparation
```bash
brew install hcloud
hcloud context create versatile
```

```bash
hcloud server create --location fsn1 --image debian-12 --type cax11 --name download.versatiles.org1 --ssh-key 9919841
sleep 15
hcloud server ssh download.versatiles.org1 "curl 'https://raw.githubusercontent.com/versatiles-org/download.versatiles.org/main/setup.sh' | bash"
```
