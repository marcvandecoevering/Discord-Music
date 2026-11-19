import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export const PRIV = { login:1, list:2, upload:4, delete:8, edit:16, createPlaylist:32, deletePlaylist:64, editPlaylist:128, users:512, play:4096, volume:4096, queue:8192, settings:65536 };
export function passwordHash(password) {
  const salt=randomBytes(16).toString('hex');
  return {scheme:'scrypt',salt,hash:scryptSync(password,salt,32).toString('hex')};
}
export function verifyPassword(password,user) {
  const hash=user.scheme==='legacy-sha256'
    ? createHash('sha256').update(Buffer.from(user.salt,'hex')).update(password).digest()
    : scryptSync(password,user.salt,32);
  const expected=Buffer.from(user.hash,'hex');
  return hash.length===expected.length && timingSafeEqual(hash,expected);
}
export function safeFile(root,relative) {
  if (typeof relative!=='string' || !relative || relative.includes('\0')) throw Error('Invalid file');
  const resolved=path.resolve(root,relative), prefix=path.resolve(root)+path.sep;
  if (!resolved.startsWith(prefix)) throw Error('Invalid file path');
  const real=fs.realpathSync(resolved);
  if (!real.startsWith(fs.realpathSync(root)+path.sep)) throw Error('Invalid file link');
  return real;
}
export class Store {
  constructor(root,options={}) {
    this.root=path.resolve(root);fs.mkdirSync(this.root,{recursive:true});
    this.dir=options.stateDir||path.join(this.root,'discord-music');fs.mkdirSync(this.dir,{recursive:true});
    this.db=new DatabaseSync(path.join(this.dir,'library.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
    const row=this.db.prepare('SELECT value FROM state WHERE id=1').get();
    if(row) this.data=JSON.parse(row.value);
    else {
      const legacy=path.join(this.root,'db');
      const sources=fs.existsSync(legacy)?fs.readdirSync(legacy).filter(x=>x.endsWith('.sqlite')&&x!=='global.sqlite'):[];
      if(sources.length>1) throw Error('Multiple legacy libraries: choose one before migration');
      try { this.data=sources.length?this.importLegacy(path.join(legacy,sources[0]),options):{
        version:2,tracks:[],playlists:[],users:[],instances:[{id:randomUUID(),name:'Discord-Music',volume:100,shuffle:false,repeat:'off',queue:[],current:null,position:0}],settings:{}
      }; } catch(error){this.db.close();throw error;}
      const adminPassword=options.adminPassword;
      if(!this.data.users.some(x=>x.admin&&!x.locked)) {
        if(!adminPassword) throw Error('Set DISCORD_MUSIC_ADMIN_PASSWORD on first installation');
        this.data.users.push({id:randomUUID(),name:'admin',admin:true,locked:false,privileges:2147483647,...passwordHash(adminPassword)});
      } else if(adminPassword) {
        // Compatibility with the previous container's runtime admin password.
        const admin=this.data.users.find(x=>x.name==='admin'&&x.admin);
        if(admin) Object.assign(admin,passwordHash(adminPassword));
      }
      this.save();
    }
    this.instance=this.data.instances.find(x=>x.id===options.instanceId)||this.data.instances[0];
    if(options.instanceId&&!this.data.instances.some(x=>x.id===options.instanceId)) throw Error('Configured instance does not exist');
    if(this.data.instances.length>1&&!options.instanceId) throw Error('Set DISCORD_MUSIC_INSTANCE_ID to choose an instance');
    if(!this.instance) throw Error('No music instance');
  }
  save(){this.db.prepare('INSERT INTO state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(this.data));}
  close(){this.db.close();}
  importLegacy(filename,options) {
    const source=new DatabaseSync(filename,{readOnly:true});source.exec('BEGIN');
    const botId=path.basename(filename,'.sqlite'), all=t=>source.prepare('SELECT * FROM '+t).all();
    const decode=x=>JSON.parse(typeof x==='string'?x:Buffer.from(x).toString());
    try {
      if(source.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw Error('Legacy database integrity check failed');
      const stamp=new Date().toISOString().replaceAll(':','-');
      const backup=path.join(this.dir,'backups',stamp);fs.mkdirSync(backup,{recursive:true});
      // A logical snapshot inside the read transaction includes any committed WAL data.
      const tables={};for(const table of ['storage_files','playlists','playlists_files','users','instances','scriptdata'])tables[table]=all(table);
      fs.writeFileSync(path.join(backup,'legacy-snapshot.json'),JSON.stringify(tables),{mode:0o600});
      for(const n of ['config.ini','discord-music-instance-names.json'])if(fs.existsSync(path.join(this.root,n)))fs.copyFileSync(path.join(this.root,n),path.join(backup,n));
      const tracks=tables.storage_files.map(row=>{
        const t=decode(row.trackinfo), relative=t.path?'store/'+botId+'/'+t.path:null;
        if(relative && row.type!=='folder') safeFile(this.root,relative);
        const cover=t.thumbnail&&fs.existsSync(path.join(this.root,'cache',path.basename(t.thumbnail)))?'cache/'+path.basename(t.thumbnail):null;
        return {id:row.uuid,title:String(t.title||row.title||t.filename||''),artist:String(t.artist||row.artist||''),album:String(t.album||row.album||''),filename:t.filename||'',duration:Number(t.duration||0),parent:t.parent||'',type:row.type||'file',file:relative,cover,playcount:row.playcount||0,metadata:t};
      });
      const ids=new Set(tracks.map(x=>x.id));
      const playlists=tables.playlists.map(p=>({id:p.uuid,name:p.name,items:tables.playlists_files.filter(x=>x.playlist===p.uuid).sort((a,b)=>a.position-b.position).map(x=>{
        if(x.file&&ids.has(x.file))return x.file;
        throw Error('Playlist contains an unavailable item: '+p.name);
      })}));
      const aliases=fs.existsSync(path.join(this.root,'discord-music-instance-names.json'))?JSON.parse(fs.readFileSync(path.join(this.root,'discord-music-instance-names.json'))):{};
      const instances=tables.instances.map(row=>{
        const s=decode(row.config), queue=s.queue||[];
        const items=queue.map(x=>typeof x==='string'?x.replace(/^track:\/\//,''):(x.uuid||x.file||x.track?.uuid));
        if(items.some(x=>!ids.has(x)))throw Error('Legacy queue contains an unsupported item; migration stopped');
        return {id:row.uuid,name:aliases[row.uuid]??s.name??'Discord-Music',volume:Math.max(0,Math.min(100,Number(s.volume??100))),shuffle:!!s.shuffle,repeat:s.repeat?'all':'off',queue:items,current:ids.has(s.currentTrack?.uuid)?s.currentTrack.uuid:null,position:Number(s.currentPosition||0),playlist:s.currentPlaylist||null,index:s.currentPlaylistTrack??-1,legacySettings:s};
      });
      const users=tables.users.map(u=>({id:u.uuid,name:u.name,admin:!!u.isadmin,locked:!!u.locked,privileges:u.privileges,scheme:'legacy-sha256',salt:u.salt,hash:u.password,instancePrivileges:Object.fromEntries(instances.map(i=>[i.id,i.legacySettings.userPrivileges?.[u.uuid]||0]))}));
      const report={time:stamp,source:botId,tracks:tracks.length,playlists:playlists.length,playlistItems:playlists.reduce((n,p)=>n+p.items.length,0),users:users.filter(x=>!x.locked).length,missingFiles:0,originalFilesUnchanged:true};
      fs.writeFileSync(path.join(this.dir,'migration-report.json'),JSON.stringify(report,null,2));
      return {version:2,tracks,playlists,users,instances,settings:{},migration:report};
    } finally {source.exec('ROLLBACK');source.close();}
  }
  track(id){return this.data.tracks.find(t=>t.id===id);}
  can(user,permission){return !!user&&!user.locked&&(user.admin||!!((user.privileges|(user.instancePrivileges?.[this.instance.id]||0))&PRIV[permission]));}
}
