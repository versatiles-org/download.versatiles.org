#!/bin/bash
set -e
cd $(dirname $(dirname $0))

docker compose up -d

while true
do
	git pull
	npm run once
	docker compose restart swag
	npm run server
done
