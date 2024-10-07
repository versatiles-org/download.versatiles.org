#!/bin/bash

set -e
cd $(dirname $(dirname $0))

source .env

mkdir -p volumes/local_files
mkdir -p volumes/logs
mkdir -p volumes/nginx_conf
mkdir -p volumes/remote_files

if mount | awk '{if ($3 == "volumes/remote_files") {exit 0}} ENDFILE{exit -1}'; then
	echo "volumes/remote_files already mounted"
else
	sshfs -o allow_other,default_permissions -o IdentityFile=$(pwd)/.ssh/storage -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -p 23 $STORAGE_URL:/home/ volumes/remote_files
fi

docker build --progress plain -t download-server --target local .
docker run --rm -it download-server
