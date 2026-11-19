import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Player } from '../app/player.js';
class Fake extends EventEmitter {ready=true;listeners=0;connected=false;joins=0;leaves=0;stop(){} volume(){}close(){}leave(){this.leaves++;this.connected=false;}async join(){this.joins++;this.connected=true;}}
test('no listeners means no join, pause is persisted; returning listener does not trigger a join',async()=>{
 const v=new Fake(),store={instance:{position:2300,volume:70,queue:[]},data:{playlists:[]},save(){},track(){return null;}},p=new Player(store,v);
 try{await assert.rejects(()=>p.play('anything'),/Join the voice channel/);assert.equal(v.joins,0);assert.equal(p.playing,false);v.listeners=1;v.emit('presence');await p.serial;assert.equal(v.joins,0);p.playing=true;p.started=Date.now()-100;v.emit('empty');await p.serial;assert.equal(p.playing,false);assert(store.instance.position>=2400);}finally{p.close();}
});
test('automatic next with no listeners does not discard queued songs',async()=>{
 const v=new Fake(),store={instance:{position:0,queue:['first']},data:{playlists:[]},save(){}},p=new Player(store,v);
 try{await p.next(true);assert.deepEqual(store.instance.queue,['first']);}finally{p.close();}
});
