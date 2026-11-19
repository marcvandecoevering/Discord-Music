# Discord-Music

Een onafhankelijke Discord-muziekapp voor Unraid, met een eigen webinterface, database en FFmpeg-speler. Eén container, één datamap en één webpoort. De container bevat alles voor het afspelen van lokale muziek; bij de eerste start is geen download van een andere muziekapp nodig. Alleen de Discord-verbinding vereist internet.

Dit project begon als fork van het [SinusBot Docker-project](https://github.com/SinusBot/docker). Versie 2 vervangt de onderliggende speler en interface volledig door eigen broncode. De legacy-importeur kan bestaande gegevens lezen, maar voert geen oude code uit.

## Versie 2: migratiepreview

De branch codex/independent-player publiceert het image **ghcr.io/marcvandecoevering/discord-music:independent**. De bestaande latest-versie wordt pas vervangen na de migratiecontrole op Unraid. Gebruik de preview niet gelijktijdig met een andere speler die dezelfde muziekmap gebruikt.

## Functies

- Muziek uploaden, zoeken, metadata wijzigen en ordenen in playlists.
- Playlists afspelen, wachtrij, volgende/vorige, seek, volume, shuffle en herhalen.
- Albumcovers uit de bestaande bibliotheek.
- Instancenaam aanpassen; die verschijnt linksboven.
- Gebruikers en rechten, bestaande wachtwoorden migreren, eigen wachtwoord wijzigen.
- Discord voice met DAVE. De bot verlaat het kanaal zodra de laatste menselijke luisteraar weg is en bewaart de afspeelpositie. Een terugkerende luisteraar start niets: pas een nieuwe afspeelactie verbindt de bot.
- Geen scripts, addons, radiocatalogus of afhankelijkheid van een externe muziekspeler.

## Unraid

Gebruik templates/discord-music.xml. Voor de migratiepreview is de Repository ghcr.io/marcvandecoevering/discord-music:independent. Poort 8080 in de container is standaard hostpoort 18087. Koppel je bestaande muziekdatamap aan /data.

Vul DISCORD_MUSIC_ADMIN_PASSWORD, DISCORD_TOKEN, DISCORD_GUILD_ID en DISCORD_CHANNEL_ID in. Het adminwachtwoord wordt bij eerste initialisatie ingesteld; latere wijzigingen gebeuren in de app. De bot heeft View Channel, Connect en Speak nodig. De container draait de applicatie als UID/GID 1000 en maakt alleen /data/discord-music aan. Bestaande bestanden moeten leesbaar zijn voor deze gebruiker.

Bij meerdere oude instances is DISCORD_MUSIC_INSTANCE_ID verplicht. Alle instances en hun instellingen worden bewaard; deze container beheert één actieve Discord-verbinding. Oude SINUSBOT_PASSWORD en SINUSBOT_INSTANCE_ID omgevingsvariabelen worden uitsluitend als migratiecompatibiliteit ondersteund.

## Bestaande bibliotheek behouden

1. Stop de oude container voordat je de nieuwe op dezelfde datamap start.
2. Bewaar een back-up van db/, config.ini en discord-music-instance-names.json. De muziek in store/ en covers in cache/ blijven ongewijzigd.
3. De nieuwe app leest de database in een consistente SQLite-transactie en importeert nummers, playlistvolgorde inclusief duplicaten, accounts/rechten, naam, volume, wachtrij, shuffle, herhalen en laatst gekozen nummer/positie.
4. Ontbrekende muziek of niet-ondersteunde playlistverwijzingen breken de migratie af. Er wordt geen gedeeltelijke nieuwe bibliotheek gepubliceerd.
5. De nieuwe database staat afzonderlijk in discord-music/library.sqlite. De oude database blijft ongewijzigd. Het rapport staat in discord-music/migration-report.json. De volledige oorspronkelijke instellingen en een logische databasesnapshot worden apart bewaard.
6. De speler start bewust gepauzeerd. Controleer een playlist en start muziek terwijl iemand in het kanaal aanwezig is.

Het script deploy/migrate-unraid.sh automatiseert de bestaande één-containerinstallatie met config/bridge.env. Het bewaart de oude container als gestopte terugvaloptie, controleert webinterface en Discord-login, en herstelt de oude container bij een mislukte start. APPDATA, CONTAINER_NAME en IMAGE kunnen worden ingesteld. De standaard APPDATA is het pad van de oorspronkelijke MuziekWijf-installatie.

Voor terugrollen: stop de nieuwe container en start de bewaarde oude container. Nieuwe wijzigingen in versie 2 worden niet teruggeschreven naar de oude database. De app verwijdert audiobestanden niet fysiek bij het verwijderen uit de bibliotheek. Maak reguliere back-ups van de volledige /data-map.

## Verschillen en grenzen

De nieuwe UI vervangt de oude UI. Spraakverbinding, playlists, muziekbibliotheek en gebruikersbeheer zijn eigen implementaties. TeamSpeak, oude scripts, TTS, YouTube-downloads, radiofeeds, Discord-chatcommando's en oude API-clients worden niet ondersteund. Niet-actieve legacy-instellingen blijven in de back-up bewaard; ze krijgen geen stilzwijgend andere betekenis.

Nieuwe uploads worden met FFprobe gecontroleerd en met FFmpeg afgespeeld. Maximaal 250 MB per upload. Audio wordt alleen van lokale bestanden geopend; netwerkprotocollen voor audio zijn uitgeschakeld. Gebruik een vertrouwd netwerk of HTTPS reverse proxy; zet SECURE_COOKIES=1 bij uitsluitend HTTPS-toegang.

## Ontwikkeling en licenties

Node.js 24; npm ci; npm test. Bouw met docker build -t discord-music:test . . Voor tests zonder Discord: DISCORD_DISABLED=1. test/integration.mjs, test/audio.mjs en test/transport.mjs draaien in een wegwerpcontainer. CI start expliciet zonder netwerk en controleert upload, authenticatie, rechten, playlistbeheer, PCM/Opus, DAVE en de afspeelstatusovergangen.

Eigen code: MIT. Zie THIRD_PARTY_NOTICES.md voor dependencies. Het image bevat de overeenkomende Debian FFmpeg-bronarchieven en patches in /usr/share/doc/discord-music, met licentieteksten onder /usr/share/doc.
