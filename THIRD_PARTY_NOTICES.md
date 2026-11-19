# Third-party components

Application code is MIT licensed. Dependency licenses apply separately.

- Node.js: notices in the official Node image.
- discord.js, @discordjs/voice, @snazzah/davey, opusscript and transitive dependencies: licenses in /app/node_modules. Versions are locked in package-lock.json.
- Debian FFmpeg: /usr/share/doc/ffmpeg/copyright. Matching source archives and Debian build patches/instructions are included in /usr/share/doc/discord-music. FFmpeg runs as a separate process.
- Other Debian packages: /usr/share/doc/<package>/copyright. Installed versions are in /usr/share/doc/discord-music/installed-packages.tsv; sources are available from Debian and snapshot.debian.org.

The historical Docker wrapper originated from the SinusBot Docker repository, Copyright (c) 2018 SinusBot, under MIT. That notice is retained in LICENSE. The current runtime includes no upstream player binary, frontend, or first-start download. The importer only reads the user's data; original databases, audio and covers are never distributed in the image.
