#!/bin/sh
git pull -f
npm run start /var/www/docs
nginx -s reload
