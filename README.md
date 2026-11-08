# Discord-Music

Discord-Music is een fork van [het officiële SinusBot Docker-project](https://github.com/SinusBot/docker).

Eén container voor Unraid (x86-64): een muziekbibliotheek, webinterface en Discord-verbinding. In een leeg kanaal stopt de muziek. De bot komt terug wanneer iemand muziek start en er een luisteraar aanwezig is.

## Installatie

Gebruik het [Unraid-template](templates/discord-music.xml). In het veld **Repository** hoort `ghcr.io/marcvandecoevering/discord-music:latest` te staan. Unraid haalt dit image rechtstreeks uit de GitHub Container Registry. Vul het adminwachtwoord, Discord-bottoken, server-ID en voicekanaal-ID in. De bot heeft View Channel, Connect en Speak nodig. Open de WebUI (standaard poort 18087) en log in als admin. Bewaar de datamap bij updates. Laat nooit twee spelers tegelijk dezelfde bibliotheek openen.

Bij de eerste start downloadt Discord-Music de spelerlaag uit het officiële Docker Hub-image sinusbot/docker:1.0.2-discord en controleert de SHA-256. De cache in /data/.muziekwijf maakt offline herstarts mogelijk. SinusBot zelf zit niet in deze repository of het gepubliceerde image. SinusBot heeft een eigen licentie voor persoonlijk gebruik. Lokale muziekuploads en playlists worden ondersteund; TTS en een YouTube-downloader zijn niet inbegrepen.

## Publicatie

De GitHub Actions-workflow test het image en publiceert vanaf main naar GHCR. Maak het package publiek en controleer een anonieme pull. Het template hoort ook in de unraid-templates-repository van de beheerder. Valideer en dien het in via https://ca.unraid.net/submit. Het verschijnt in Apps na acceptatie.

Links bovenin staat de naam van de actieve instance. Wijzig deze onder Settings → Instance Settings → Name en sla op. Als de naam leeg is, verschijnt Discord-Music. Behoud bij updates de bestaande datamap.
