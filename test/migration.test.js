import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { Store,verifyPassword } from '../app/store.js';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dm-import-'));
 fs.mkdirSync(path.join(root,'db'));fs.mkdirSync(path.join(root,'store','bot'),{recursive:true});fs.writeFileSync(path.join(root,'store','bot','audio'),'fixture');fs.mkdirSync(path.join(root,'cache'));fs.writeFileSync(path.join(root,'cache','cover.jpg'),'cover');
 const db=new DatabaseSync(path.join(root,'db','bot.sqlite'));
 db.exec("CREATE TABLE storage_files(uuid,trackinfo,type,artist,title,album,playcount);CREATE TABLE playlists(uuid,name);CREATE TABLE playlists_files(playlist,file,position);CREATE TABLE instances(uuid,config);CREATE TABLE users(uuid,name,isadmin,locked,privileges,salt,password);CREATE TABLE scriptdata(uuid,data)");
 db.prepare('INSERT INTO storage_files VALUES(?,?,?,?,?,?,?)').run('track',JSON.stringify({title:'Title',path:'audio',thumbnail:'cover.jpg',duration:10000}), 'file','','','',0);
 db.prepare('INSERT INTO playlists VALUES(?,?)').run('playlist','Favorites');
 for(const pos of [1,0])db.prepare('INSERT INTO playlists_files VALUES(?,?,?)').run('playlist','track',pos);
 db.prepare('INSERT INTO instances VALUES(?,?)').run('instance',JSON.stringify({name:'Old',volume:42,currentTrack:{uuid:'track'},currentPosition:1250,queue:['track'],shuffle:true,repeat:true}));
 const salt='aa'.repeat(16),hash=createHash('sha256').update(Buffer.from(salt,'hex')).update('secret').digest('hex');
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run('user','gtr',1,0,2147483647,salt,hash);db.close();
 fs.writeFileSync(path.join(root,'discord-music-instance-names.json'),JSON.stringify({instance:'Music room'}));
 return root;
}
test('imports order, duplicates, aliases, users, settings and original file references; restart is idempotent',()=>{
 const root=fixture();try{
 const original=fs.readFileSync(path.join(root,'db','bot.sqlite')),s=new Store(root);
 assert.equal(s.data.tracks.length,1);assert.deepEqual(s.data.playlists[0].items,['track','track']);
 assert.equal(s.instance.name,'Music room');assert.equal(s.instance.volume,42);assert.equal(s.instance.position,1250);assert.equal(s.instance.repeat,'all');assert.deepEqual(s.instance.queue,['track']);
 assert(verifyPassword('secret',s.data.users[0]));assert(!verifyPassword('wrong',s.data.users[0]));
 assert.equal(s.data.tracks[0].cover,'cache/cover.jpg');s.instance.name='Saved';s.save();s.close();
 const second=new Store(root);assert.equal(second.instance.name,'Saved');assert.equal(second.data.tracks.length,1);second.close();
 assert.deepEqual(fs.readFileSync(path.join(root,'db','bot.sqlite')),original);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('missing audio prevents committing an incomplete migration',()=>{
 const root=fixture();try{fs.unlinkSync(path.join(root,'store','bot','audio'));assert.throws(()=>new Store(root));const d=new DatabaseSync(path.join(root,'discord-music','library.sqlite'));assert.equal(d.prepare('SELECT count(*) n FROM state').get().n,0);d.close();}finally{fs.rmSync(root,{recursive:true,force:true});}
});
