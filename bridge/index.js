import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } from 'discord.js';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, NoSubscriberBehavior, generateDependencyReport } from '@discordjs/voice';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { decision } from './voice-policy.js';
import { SinusBot } from './sinusbot.js';

const required = ['DISCORD_TOKEN', 'DISCORD_GUILD_ID', 'DISCORD_CHANNEL_ID', 'SINUSBOT_PASSWORD'];
const missing = required.filter(key => !process.env[key]?.trim());
if (missing.length) {
  console.error(`Missing configuration: ${missing.join(', ')}. Fill in the local .env file.`);
  process.exit(1);
}
console.log(generateDependencyReport());
const bot = new SinusBot({
  url: process.env.SINUSBOT_URL || 'http://sinusbot:8087',
  username: process.env.SINUSBOT_USERNAME || 'admin',
  password: process.env.SINUSBOT_PASSWORD,
  instanceId: process.env.SINUSBOT_INSTANCE_ID,
});
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
let connection, streamController, shuttingDown = false;
let diagnostics;
const redact = message => {
  let clean = String(message);
  for (const secret of [process.env.DISCORD_TOKEN, process.env.SINUSBOT_PASSWORD, bot.token]) {
    if (secret) clean = clean.replaceAll(secret, '[redacted]');
  }
  return clean.replace(/\/stream\/[^\s"']+/g, '/stream/[redacted]');
};
player.on('error', error => { console.error('Audio error:', redact(error.message)); streamController?.abort(); });
player.on('stateChange', (oldState, state) => {
  if (oldState.status !== state.status) console.log('Audio:', state.status);
});
async function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(diagnostics);
  streamController?.abort();
  player.stop();
  connection?.destroy();
  client.destroy();
  process.exitCode = code;
}
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
client.on('error', error => console.error('Discord error:', redact(error.message)));
async function main() {
  await bot.login();
  await client.login(process.env.DISCORD_TOKEN);
  if (!client.isReady()) await new Promise(resolve => client.once('clientReady', resolve));
  const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
  const channel = await guild.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  if (channel?.type !== ChannelType.GuildVoice) throw new Error('Choose a normal server voice channel');
  const me = await guild.members.fetchMe();
  const permissions = channel.permissionsFor(me);
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    throw new Error('Test bot needs View Channel, Connect and Speak permissions');
  }
  console.log('Discord bridge connected; watching playback.');
  const count = () => channel.members.filter(member => !member.user.bot).size;
  const api = (path, method = 'GET') => bot.request(`bot/i/${bot.instanceId}/${path}`, { method });
  let pausedTrack, mustPause = false, busy = false, again = false;
  function silence() {
    streamController?.abort();
    streamController = undefined;
    player.stop(true);
  }
  function leave() {
    silence();
    const old = connection;
    connection = undefined;
    if (old && old.state.status !== VoiceConnectionStatus.Destroyed) old.destroy();
  }
  function startStream() {
    if (streamController) return;
    const ctrl = new AbortController();
    streamController = ctrl;
    (async () => {
      const body = await bot.openStream(ctrl.signal);
      if (ctrl.signal.aborted) { await body.cancel(); return; }
      const resource = createAudioResource(Readable.fromWeb(body), { inputType: StreamType.OggOpus });
      player.play(resource);
      await entersState(player, AudioPlayerStatus.Playing, AbortSignal.any([ctrl.signal, AbortSignal.timeout(20000)]));
      while (!ctrl.signal.aborted && player.state.resource === resource) await delay(250);
    })().catch(e => { if (!ctrl.signal.aborted) console.error('Stream:', redact(e.message)); })
      .finally(() => { if (streamController === ctrl) silence(); });
  }
  function join() {
    const active = connection = joinVoiceChannel({ channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: false, daveEncryption: true });
    active.on('error', e => console.error('Voice:', redact(e.message)));
    active.on('stateChange', (_, state) => console.log('Voice:', state.status));
    active.subscribe(player);
    entersState(active, VoiceConnectionStatus.Ready, 30000).catch(() => { if (connection === active) leave(); });
  }
  async function tick() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      if (!guild.available || !client.isReady()) return;
      const status = await api('status');
      if (typeof status.playing !== 'boolean') throw Error('Invalid playback status');
      if (shuttingDown) return;
      const action = decision({ listeners: count(), playing: status.playing, connected: !!connection, mustPause });
      if (action === 'pause' || action === 'leave') {
        leave();
        if (status.playing) {
          mustPause = true;
          const track = status.currentTrack;
          if (track?.uuid && track.duration > 0 && (!pausedTrack || pausedTrack.uuid !== track.uuid || status.position > 2000))
            pausedTrack = { uuid: track.uuid, percent: Math.min(99.99, 100 * (status.position || 0) / track.duration) };
          const result = await api('stop', 'POST');
          if (result?.success === false) throw Error('Player rejected stop');
        }
        mustPause = false;
        return;
      }
      if (action === 'idle') { silence(); return; }
      if (pausedTrack) {
        const resume = pausedTrack;
        if (resume.uuid === status.currentTrack?.uuid && resume.percent > 0)
          await api('seek/' + resume.percent, 'POST');
        pausedTrack = undefined;
      }
      if (!count() || mustPause || shuttingDown) return;
      if (!connection) join();
      if (connection.state.status === VoiceConnectionStatus.Ready) startStream();
      if (connection.state.status === VoiceConnectionStatus.Disconnected) leave();
    } catch (e) {
      console.error('Playback check:', redact(e.message));
      if (/API (401|403)/.test(e.message)) await bot.login().catch(err => console.error(redact(err.message)));
    } finally {
      busy = false;
      if (again && !shuttingDown) { again = false; void tick(); }
    }
  }
  client.on('voiceStateUpdate', (before, after) => {
    if (before.channelId !== channel.id && after.channelId !== channel.id) return;
    if (before.id !== me.id && !count()) { mustPause = true; leave(); }
    void tick();
  });
  diagnostics = setInterval(() => void tick(), 1000);
  await tick();
}
main().catch(async error => { console.error(redact(error.message)); await stop(1); });
