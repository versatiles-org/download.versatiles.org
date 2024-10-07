#!/bin/bash
set -e
cd $(dirname $(dirname $0))

##npm run once
TARGET=dev docker compose --progress=plain up
