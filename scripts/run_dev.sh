#!/bin/bash
set -e
cd $(dirname $(dirname $0))

source .env

if mount | awk '{if ($3 == "volumes/remote_files") {exit 0}} ENDFILE{exit -1}'; then
	echo "volumes/remote_files already mounted"
else
	sshfs -o "allow_other,default_permissions,IdentityFile=$(pwd)/.ssh/storage,StrictHostKeyChecking=no,UserKnownHostsFile=/dev/null,BatchMode=yes" -p 23 "$STORAGE_URL:/home/" "volumes/remote_files"
fi

npm run once
