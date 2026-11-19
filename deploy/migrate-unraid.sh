#!/bin/bash
# Run on Unraid. No music files or legacy databases are deleted or rewritten.
set -Eeuo pipefail
name="${CONTAINER_NAME:-Discord-Music}"
image="${IMAGE:-ghcr.io/marcvandecoevering/discord-music:independent}"
base="${APPDATA:-/mnt/user/appdata/muziekwijf}"
cd "$base"
docker inspect "$name" >/dev/null
test -s config/bridge.env
data=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$name")
[[ "$data" == "$base/data" ]] || { echo 'Unexpected data mount. Set APPDATA to the existing app directory.'; exit 1; }
binding=$(docker inspect -f '{{with index .HostConfig.PortBindings "8080/tcp"}}{{(index . 0).HostIp}}:{{(index . 0).HostPort}}{{end}}' "$name")
[[ "$binding" =~ ^[0-9.]*:[0-9]+$ ]] || { echo 'Unexpected port configuration.'; exit 1; }
docker pull "$image"
# Pin the local image ID so a moving registry tag cannot change this migration.
imageid=$(docker image inspect -f '{{.Id}}' "$image")
stamp=$(date +%Y%m%d-%H%M%S)
old="$name-before-v2-$stamp"
backup="$base/backups/independent-$stamp"
mkdir -p "$backup"
chmod 700 "$backup"
docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$name" > "$backup/restart-policy"
template="/boot/config/plugins/dockerMan/templates-user/my-$name.xml"
if [[ -f "$template" ]]; then cp -a "$template" "$backup/template.xml"; fi
docker stop "$name"
trap 'docker start "$name" >/dev/null' ERR
cp -a data/db "$backup/"
for f in data/config.ini data/discord-music-instance-names.json; do [[ ! -f "$f" ]] || cp -a "$f" "$backup/"; done
docker rename "$name" "$old"
docker update --restart=no "$old" >/dev/null
rollback() {
  trap - ERR
  if docker inspect "$name" >/dev/null 2>&1; then
    docker logs --tail 100 "$name" > "$backup/startup.log" 2>&1 || true
    docker update --restart=no "$name" >/dev/null
    docker stop "$name" >/dev/null || true
    docker rename "$name" "$name-failed-v2-$stamp"
  fi
  docker rename "$old" "$name"
  docker update --restart="$(cat "$backup/restart-policy")" "$name" >/dev/null
  docker start "$name" >/dev/null
  echo "Previous installation restored. Log: $backup/startup.log"
  exit 1
}
trap rollback ERR
docker run -d --name "$name" --restart unless-stopped --env-file config/bridge.env \
  -v "$data:/data" -p "$binding:8080" \
  --label net.unraid.docker.managed=dockerman \
  --label 'net.unraid.docker.webui=http://[IP]:[PORT:8080]/' \
  --label 'net.unraid.docker.icon=https://raw.githubusercontent.com/marcvandecoevering/Discord-Music/main/web/assets/icon.png' \
  "$image"
[[ "$(docker inspect -f '{{.Image}}' "$name")" == "$imageid" ]] || rollback
ready=0
for n in {1..150}; do
  if docker exec "$name" node -e "fetch('http://127.0.0.1:8080/health').then(async r=>{const s=await r.json();if(!s.ready||!s.discord)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then ready=1; break; fi
  if (( n % 10 == 0 )); then echo "Checking migration and Discord ($((n*2)) seconds)..."; fi
  sleep 2
done
[[ "$ready" == 1 ]] || rollback
docker exec "$name" node -e "const fs=require('fs');const p='/data/discord-music/migration-report.json';if(!fs.existsSync(p))process.exit(1);const r=JSON.parse(fs.readFileSync(p));if(r.missingFiles!==0)process.exit(1);console.log(JSON.stringify(r,null,2))"
# Update the existing template without losing port bindings, environment settings or mounts.
if [[ -f "$template" ]]; then
  IMAGE="$image" TEMPLATE="$template" php -r '$p=getenv("TEMPLATE");$x=simplexml_load_file($p);if(!$x)exit(1);$x->Repository=getenv("IMAGE");$x->Project="https://github.com/marcvandecoevering/Discord-Music";$x->Support="https://github.com/marcvandecoevering/Discord-Music/issues";if($x->asXML($p)===false)exit(1);'
fi
trap - ERR
echo "Independent Discord-Music is running. Previous container stopped: $old"
echo "Backup: $backup"
echo "Sign in and play a track while you are in the configured voice channel."
