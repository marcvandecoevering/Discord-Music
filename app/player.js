import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { safeFile } from './store.js';

export class Player extends EventEmitter {
  constructor(store,voice) {
    super();this.store=store;this.voice=voice;this.playing=false;this.serial=Promise.resolve();this.generation=0;this.error=null;
    voice.on('empty',()=>{this.cancel();voice.leave();this.run(()=>this.pause());});
    voice.on('lost',()=>{this.cancel();this.run(()=>this.pause());});
    voice.on('end',()=>this.run(()=>this.next(true)).catch(e=>this.fail(e)));
    voice.on('error',e=>this.fail(e));
    this.timer=setInterval(()=>{if(this.playing){this.store.instance.position=this.position();this.started=Date.now();this.store.save();}},5000);
  }
  run(fn){const next=this.serial.then(fn);this.serial=next.catch(()=>{});return next;}
  position(){return this.store.instance.position+(this.playing?Date.now()-this.started:0);}
  status(){const s=this.store.instance;return {name:s.name,instanceId:s.id,playing:this.playing,current:s.current,position:this.position(),volume:s.volume,shuffle:s.shuffle,repeat:s.repeat,queue:s.queue,playlist:s.playlist,connected:this.voice.connected,listeners:this.voice.listeners,error:this.error,discordReady:this.voice.ready};}
  cancel(){this.generation++;this.child?.kill('SIGKILL');this.child=null;this.voice.stop();}
  pause(){const p=this.position();this.playing=false;this.store.instance.position=p;this.cancel();this.store.save();}
  fail(error){this.error=error.message||'Playback failed';this.pause();this.emit('errorState',this.error);}
  async play(id,position) {
    const ticket=++this.generation;
    if(!this.voice.ready)throw Error('Discord is not connected');
    if(!this.voice.listeners){this.pause();this.voice.leave();throw Error('Join the voice channel before starting music');}
    const s=this.store.instance,track=this.store.track(id||s.current);
    if(!track||!track.file)throw Error('Choose an audio track');
    const file=safeFile(this.store.root,track.file);
    const offset=position??(s.current===track.id?this.position():0);
    await this.voice.join();
    if(ticket!==this.generation||!this.voice.listeners){this.voice.leave();return;}
    this.pause();s.current=track.id;s.position=Math.max(0,Math.min(offset,track.duration||offset));this.error=null;
    const child=spawn('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-ss',String(s.position/1000),'-protocol_whitelist','file,pipe','-i',file,'-vn','-f','s16le','-ar','48000','-ac','2','pipe:1'],{stdio:['ignore','pipe','pipe']});
    this.child=child;let errors='';
    child.stderr.on('data',b=>{errors=(errors+b.toString()).slice(-500);});
    child.on('error',e=>{if(this.child===child)this.fail(e);});
    child.on('close',code=>{if(this.child===child&&code!==0&&code!==null)this.fail(Error('Audio could not be decoded'));});
    this.started=Date.now();this.playing=true;this.voice.play(child.stdout,s.volume/100);this.store.save();
  }
  async next(automatic=false) {
    const s=this.store.instance;this.pause();
    if(!this.voice.listeners){this.voice.leave();return;}
    if(automatic&&s.repeat==='one')return this.play(s.current,0);
    let id=s.queue.shift();
    const list=this.store.data.playlists.find(p=>p.id===s.playlist)?.items||[];
    if(!id&&list.length){
      let index=s.shuffle?Math.floor(Math.random()*list.length):(s.index??-1)+1;
      if(index>=list.length&&s.repeat==='all')index=0;
      if(index<list.length){id=list[index];s.index=index;}
    }
    if(id)await this.play(id,0);
    this.store.save();
  }
  async previous(){const s=this.store.instance,list=this.store.data.playlists.find(p=>p.id===s.playlist)?.items||[];s.index=Math.max(0,(s.index||0)-1);await this.play(list[s.index]||s.current,0);}
  async seek(ms){if(!Number.isFinite(ms)||ms<0)throw Error('Invalid position');const s=this.store.instance;if(this.playing)await this.play(s.current,ms);else{s.position=Math.min(ms,this.store.track(s.current)?.duration||ms);this.store.save();}}
  volume(value){if(!Number.isFinite(value)||value<0||value>100)throw Error('Volume must be 0–100');this.store.instance.volume=value;this.voice.volume(value/100);this.store.save();}
  close(){clearInterval(this.timer);this.pause();this.voice.close();}
}
