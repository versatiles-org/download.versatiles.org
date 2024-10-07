#!/bin/bash

set -e

cd $(dirname $0);

git pull

npm ci

npm run update

docker compose run nginx "service nginx reload"
