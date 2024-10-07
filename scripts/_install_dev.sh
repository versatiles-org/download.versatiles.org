#!/bin/bash
set -e
cd $(dirname $(dirname $0))

source .env

mkdir -p volumes/local_files
mkdir -p volumes/logs
mkdir -p volumes/nginx_conf
mkdir -p volumes/remote_files

sshfs -o "allow_other,default_permissions,IdentityFile=$(pwd)/.ssh/storage,StrictHostKeyChecking=no,UserKnownHostsFile=/dev/null,BatchMode=yes" -p 23 "$STORAGE_URL:/home/" "volumes/remote_files"

npm i
