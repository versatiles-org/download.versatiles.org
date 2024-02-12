#!/bin/sh
git pull -f
npm run start
nginx -s reload
