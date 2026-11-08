FROM node:24-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/marcvandecoevering/Discord-Music" \
      org.opencontainers.image.title="Discord-Music"
RUN apt-get update && apt-get install -y --no-install-recommends nginx curl ca-certificates tini util-linux && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default
WORKDIR /app
COPY bridge/package*.json ./
RUN npm ci --omit=dev
COPY bridge/*.js ./
COPY web/nginx.conf /etc/nginx/conf.d/discord-music.conf
COPY web/assets /usr/share/nginx/html/branding
COPY --chmod=755 start.sh /usr/local/bin/start-discord-music
EXPOSE 8080
HEALTHCHECK --start-period=180s --interval=20s CMD curl -fsS http://127.0.0.1:8080/api/v1/botId >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini","-g","--","/usr/local/bin/start-discord-music"]
