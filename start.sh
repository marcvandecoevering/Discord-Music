#!/bin/bash
set -Eeuo pipefail
: "${SINUSBOT_PASSWORD:?Set the web admin password}"
export SINUSBOT_URL=http://127.0.0.1:8087
digest=eaa8b3c48608546628514a9647c5b664c98e346aa66fb085f6c6ed27e9654464
cache=/data/.muziekwijf
mkdir -p "$cache" /opt/player
blob="$cache/$digest.tgz"
if ! test -s "$blob"; then
  token=$(curl -fsS --retry 3 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:sinusbot/docker:pull' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
  curl -fsSL --retry 3 -H "Authorization: Bearer $token" "https://registry-1.docker.io/v2/sinusbot/docker/blobs/sha256:$digest" -o "$blob.part"
  echo "$digest  $blob.part" | sha256sum -c -
  mv "$blob.part" "$blob"
fi
echo "$digest  $blob" | sha256sum -c -
cd /opt/player
tar -xzf "$blob" --strip-components=2 --wildcards 'opt/sinusbot/sinusbot' 'opt/sinusbot/lib*.so*' 'opt/sinusbot/README.md'
ln -sfn /data data
ln -sfn /data/private.dat private.dat
mkdir -p scripts
if ! test -f /data/config.ini; then
  printf 'EnableWebStream = true\nListenPort = 8087\nListenHost = "127.0.0.1"\nTS3Path = ""\n' >/data/config.ini
fi
sed -E '/^[[:space:]]*(ListenHost|ListenPort|EnableWebStream|DataDir)[[:space:]]*=/d' /data/config.ini > config.tail
{ printf 'DataDir = "/data/"\nListenHost = "127.0.0.1"\nListenPort = 8087\nEnableWebStream = true\n'; cat config.tail; } >config.ini
chown 1000:1000 /data scripts
setpriv --reuid=1000 --regid=1000 --clear-groups ./sinusbot --override-password="$SINUSBOT_PASSWORD" &
player=$!
setpriv --reuid=1000 --regid=1000 --clear-groups node /app/instance-settings.js &
nginx -g 'daemon off;' &
web=$!
for n in {1..90}; do
  if curl -fsS http://127.0.0.1:8087/api/v1/botId >/dev/null 2>&1; then break; fi
  kill -0 "$player"; sleep 1
done
curl -fsS http://127.0.0.1:8087/api/v1/botId >/dev/null
if [[ "${WEB_ONLY:-0}" != 1 ]]; then
  setpriv --reuid=1000 --regid=1000 --clear-groups node /app/index.js &
fi
wait -n
exit 1
