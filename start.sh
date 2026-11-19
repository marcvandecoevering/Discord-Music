#!/bin/bash
set -euo pipefail
mkdir -p /data/discord-music
chown 1000:1000 /data/discord-music
exec setpriv --reuid=1000 --regid=1000 --clear-groups node /app/app/server.js
