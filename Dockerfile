FROM node:24-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/marcvandecoevering/Discord-Music" \
      org.opencontainers.image.title="Discord-Music" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="2.0.0-beta.1"
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini util-linux \
    && mkdir -p /usr/share/doc/discord-music \
    && dpkg-query -W > /usr/share/doc/discord-music/installed-packages.tsv \
    && sed 's/Types: deb$/Types: deb-src/' /etc/apt/sources.list.d/debian.sources > /etc/apt/sources.list.d/discord-music-source.sources \
    && apt-get update && cd /usr/share/doc/discord-music \
    && apt-get source --download-only ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY app ./app
COPY public ./public
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY --chmod=755 start.sh /usr/local/bin/start-discord-music
EXPOSE 8080
HEALTHCHECK --start-period=180s --interval=20s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini","-g","--","/usr/local/bin/start-discord-music"]
