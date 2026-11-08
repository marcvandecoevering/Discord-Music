import { SinusBot } from './sinusbot.js';
import { Readable } from 'node:stream';
import { createAudioResource, StreamType, generateDependencyReport } from '@discordjs/voice';
import { setTimeout as delay } from 'node:timers/promises';
import OpusScript from 'opusscript';
import dave from '@snazzah/davey';
console.log(generateDependencyReport());
if (!(dave.DAVE_PROTOCOL_VERSION > 0)) throw new Error('DAVE protocol support unavailable');
const session = new dave.DAVESession(dave.DAVE_PROTOCOL_VERSION, '123456789012345678', '234567890123456789');
console.log('DAVE native session created; protocol', dave.DAVE_PROTOCOL_VERSION);
const bot = new SinusBot({ url: process.env.SINUSBOT_URL, username: 'admin', password: process.env.SINUSBOT_PASSWORD });
await bot.login();
// A self-generated, quiet 440 Hz tone: no external music or download dependency.
const rate = 48000, seconds = 8, size = rate * seconds * 2;
const wav = Buffer.alloc(44 + size);
wav.write('RIFF'); wav.writeUInt32LE(36 + size, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(size, 40);
for (let i = 0; i < rate * seconds; i++) wav.writeInt16LE(Math.round(1800 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
let files = await bot.request('bot/files');
let track = files.find(f => f.filename === 'bridge-test-tone.wav');
if (!track) {
const response = await fetch(`${bot.url}/api/v1/bot/upload?filename=bridge-test-tone.wav`, {
  method: 'POST', headers: { Authorization: `bearer ${bot.token}`, 'Content-Type': 'application/octet-stream' }, body: wav,
});
if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
track = await response.json();
}
if (!track) throw new Error('Test tone not found');
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 20000);
try {
  const pendingStream = bot.openStream(controller.signal);
  pendingStream.catch(() => {});
  await delay(500);
  const played = await bot.request(`bot/i/${bot.instanceId}/play/byId/${track.uuid}`, { method: 'POST' });
  console.log('Playback:', played);
  const resource = createAudioResource(Readable.fromWeb(await pendingStream), { inputType: StreamType.OggOpus });
  let packets = 0, bytes = 0, nonSilent = 0, squares = 0, samples = 0, crossings = 0, previous = 0;
  const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  try {
  for await (const packet of resource.playStream) {
    packets++; bytes += packet.length;
    if (packet.length > 3) nonSilent++;
    const pcm = decoder.decode(packet);
    for (let i = 0; i < pcm.length; i += 4) {
      const value = pcm.readInt16LE(i);
      squares += value * value; samples++;
      if (previous <= 0 && value > 0) crossings++;
      previous = value;
    }
    if (packets >= 100) break;
  }
  } finally { decoder.delete(); }
  const rms = Math.sqrt(squares / samples), hz = crossings / (samples / rate);
  if (nonSilent < 50) throw new Error(`Insufficient audio: ${packets} packets, ${nonSilent} non-silence packets`);
  if (rms < 100 || hz < 400 || hz > 480) throw new Error(`Wrong decoded tone: RMS=${rms}, Hz=${hz}`);
  console.log(`PASS: ${packets} Opus packets, ${bytes} bytes; decoded RMS ${rms.toFixed(1)}, frequency ${hz.toFixed(1)} Hz, with the old Discord backend disconnected.`);
} finally {
  clearTimeout(timer); controller.abort();
}
