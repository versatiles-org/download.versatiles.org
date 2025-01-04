#!/bin/bash
set -e
cd $(dirname $(dirname $0))

docker compose up -d

while true
do
	git pull
	npm ci
	npm run once
	docker compose pull
	docker compose up -d --force-recreate --build
	npm run server
done
