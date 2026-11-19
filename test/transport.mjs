import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { createAudioResource,StreamType } from '@discordjs/voice';
import { Player } from '../app/player.js';
class Sink extends EventEmitter {
 ready=true;listeners=1;connected=false;joins=0;packets=0;
 async join(){if(this.connected)return;this.joins++;this.connected=true;}
 play(stream,volume){this.resource=createAudioResource(stream,{inputType:StreamType.Raw,inlineVolume:true});this.resource.volume.setVolume(volume);}
 stop(){this.resource?.playStream.destroy();this.resource=null;}
 volume(v){this.resource?.volume.setVolume(v);}
 leave(){this.connected=false;this.stop();}
 close(){this.leave();}
}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dm-audio-'));
try{
 assert.equal(spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=10',path.join(root,'tone.wav')]).status,0);
 const voice=new Sink(),store={root,instance:{current:'a',position:1000,volume:60,queue:['b'],repeat:'off'},data:{playlists:[]},track(id){return {id,file:'tone.wav',duration:10000};},save(){}};
 const p=new Player(store,voice);
 try{
 await p.play();await wait(150);assert(p.playing);assert(voice.connected);assert.equal(voice.joins,1);assert(voice.resource.read());
 await p.seek(4000);assert(p.position()>=4000);p.volume(35);assert.equal(voice.resource.volume.volume,.35);
 voice.listeners=0;voice.emit('empty');await p.serial;assert(!p.playing);assert(!voice.connected);const paused=p.position();assert(paused>=4000);
 voice.listeners=1;await wait(20);assert.equal(voice.joins,1);assert(!p.playing);
 await p.play();assert.equal(voice.joins,2);assert(p.position()>=paused);
 await p.next();assert.equal(store.instance.current,'b');assert.equal(store.instance.queue.length,0);
 }finally{p.close();}
 console.log('PASS: explicit join, Opus output, seek, volume, leave/pause on empty, no auto-rejoin, resume position and queue advance.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
