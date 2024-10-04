#!/bin/bash
set -e
cd $(dirname $(dirname $0))

mkdir -p volumes/cert
mkdir -p volumes/local_files
mkdir -p volumes/logs
mkdir -p volumes/nginx_conf
mkdir -p volumes/remote_files

npm i
