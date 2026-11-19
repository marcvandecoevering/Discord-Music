import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createAudioResource,StreamType } from '@discordjs/voice';
import dave from '@snazzah/davey';
assert(dave.DAVE_PROTOCOL_VERSION>0);
const child=spawn('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-f','s16le','-ar','48000','-ac','2','pipe:1']);
const resource=createAudioResource(child.stdout,{inputType:StreamType.Raw,inlineVolume:true});resource.volume.setVolume(.5);
let packets=0,bytes=0;
for await(const packet of resource.playStream){packets++;bytes+=packet.length;}
assert(packets>=45&&bytes>1000);
console.log('PASS: FFmpeg PCM → Opus, volume control,',packets,'packets; DAVE protocol',dave.DAVE_PROTOCOL_VERSION);
