import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes,randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { Store,passwordHash,verifyPassword,safeFile } from './store.js';
import { Player } from './player.js';
import { Voice,DisabledVoice } from './voice.js';

const root=process.env.DATA_DIR||'/data';
const store=new Store(root,{adminPassword:process.env.DISCORD_MUSIC_ADMIN_PASSWORD,instanceId:process.env.DISCORD_MUSIC_INSTANCE_ID||undefined});
const voice=process.env.DISCORD_DISABLED==='1'?new DisabledVoice():new Voice();
const player=new Player(store,voice);
player.on('errorState',()=>console.error('Playback stopped; see authenticated player status.'));
voice.connect().then(()=>console.log('Discord-Music ready; waiting for a playback action.')).catch(()=>{player.error='Discord login failed. Check the container configuration.';console.error(player.error);});
const sessions=new Map(), attempts=new Map();
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
function cookie(req){return /(?:^|; )dm_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];}
function identity(req){const session=sessions.get(cookie(req));if(!session||session.expires<Date.now())return null;const user=store.data.users.find(x=>x.id===session.user);return store.can(user,'login')?{user,session}:null;}
async function body(req,max=1_000_000){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>max)throw Object.assign(Error('Request too large'),{status:413});parts.push(part);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
function need(user,permission){if(!store.can(user,permission))throw Object.assign(Error('Permission denied'),{status:403});}
function text(value,max=256){if(typeof value!=='string'||value.length>max)throw Error('Invalid text');return value.trim();}
const userInfo=u=>({id:u.id,name:u.name,admin:u.admin,privileges:u.privileges,locked:u.locked});
const trackInfo=t=>{const {metadata,file,...safe}=t;return {...safe,cover:!!t.cover};};
function checkedItems(items){if(!Array.isArray(items)||items.length>50000||items.some(id=>!store.track(id)?.file))throw Error('Invalid track list');return [...items];}
function probe(file){
  return new Promise((resolve,reject)=>{
    const child=spawn('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',file],{stdio:['ignore','pipe','ignore']});let output='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Audio inspection timed out'));},30000);
    child.stdout.on('data',b=>{output+=b;if(output.length>4_000_000)child.kill('SIGKILL');});
    child.on('error',()=>{clearTimeout(timer);reject(Error('Audio inspector unavailable'));});
    child.on('close',code=>{clearTimeout(timer);try{const result=JSON.parse(output);if(code||!result.streams.some(s=>s.codec_type==='audio'))throw Error();resolve(result);}catch{reject(Error('This is not a supported audio file'));}});
  });
}
let uploading=false;
async function upload(req,url){
  if(uploading)throw Error('Another upload is still processing');
  uploading=true;const id=randomUUID(),relative='discord-music/media/'+id,file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});
  let bytes=0;
  try{
    req.on('data',b=>{bytes+=b.length;if(bytes>250*1024*1024)req.destroy(Error('Maximum file size is 250 MB'));});
    await pipeline(req,fs.createWriteStream(file,{flags:'wx',mode:0o600}));
    const info=await probe(file),tags=info.format.tags||{},filename=text(url.searchParams.get('name')||'Audio',256);
    const t={id,title:tags.title||filename,artist:tags.artist||'',album:tags.album||'',filename,duration:Math.round(Number(info.format.duration||0)*1000),file:relative,type:'file',parent:'',cover:null,playcount:0};
    store.data.tracks.push(t);store.save();return trackInfo(t);
  }catch(e){fs.rmSync(file,{force:true});throw e;}
  finally{uploading=false;}
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url=new URL(req.url,'http://localhost'),route=url.pathname,write=!['GET','HEAD'].includes(req.method);
    if(req.headers.origin){const o=new URL(req.headers.origin);if(o.host!==req.headers.host)throw Object.assign(Error('Origin rejected'),{status:403});}
    if(route==='/health'&&req.method==='GET')return json(res,200,{ready:true,version:'2.0.0-beta.1',discord:voice.ready});
    if(route==='/api/login'&&req.method==='POST'){
      const ip=req.socket.remoteAddress,a=attempts.get(ip)||{count:0,time:Date.now()};
      if(Date.now()-a.time>60000){a.count=0;a.time=Date.now();}
      if(a.count++>=12)throw Object.assign(Error('Wait a minute before trying again'),{status:429});
      attempts.set(ip,a);
      const input=await body(req,4096),name=text(input.name,80),password=input.password;
      if(typeof password!=='string'||password.length>1024)throw Error('Invalid password');
      const user=store.data.users.find(x=>x.name.toLowerCase()===name.toLowerCase()&&!x.locked);
      const valid=user&&verifyPassword(password,user);
      if(!valid||!store.can(user,'login'))return json(res,401,{error:'Incorrect credentials or login not permitted'});
      if(user.scheme==='legacy-sha256'){Object.assign(user,passwordHash(password));store.save();}
      const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
      sessions.set(token,{user:user.id,csrf,expires:Date.now()+12*3600000});
      res.setHeader('Set-Cookie','dm_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'+(process.env.SECURE_COOKIES==='1'?'; Secure':''));
      return json(res,200,{user:userInfo(user),csrf});
    }
    if(route.startsWith('/api/')){
      const auth=identity(req);if(!auth)return json(res,401,{error:'Sign in'});
      const {user,session}=auth;
      if(write&&req.headers['x-csrf-token']!==session.csrf)return json(res,403,{error:'Refresh this page before saving'});
      if(route==='/api/session'&&req.method==='GET')return json(res,200,{user:userInfo(user),csrf:session.csrf,permissions:Object.keys((await import('./store.js')).PRIV).filter(k=>store.can(user,k))});
      if(route==='/api/logout'&&req.method==='POST'){sessions.delete(cookie(req));res.setHeader('Set-Cookie','dm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
      if(route==='/api/library'&&req.method==='GET'){need(user,'list');return json(res,200,{tracks:store.data.tracks.map(trackInfo),playlists:store.data.playlists});}
      if(route==='/api/status'&&req.method==='GET')return json(res,200,player.status());
      if(route==='/api/migration'&&req.method==='GET'){need(user,'settings');return json(res,200,store.data.migration||{fresh:true});}
      if(route==='/api/upload'&&req.method==='POST'){need(user,'upload');return json(res,201,await upload(req,url));}
      if(route.startsWith('/api/covers/')&&req.method==='GET'){
        need(user,'list');const track=store.track(route.slice(12));if(!track?.cover)return json(res,404,{error:'No cover'});
        const file=safeFile(store.root,track.cover);res.writeHead(200,{'Content-Type':file.endsWith('.png')?'image/png':'image/jpeg','Cache-Control':'private, max-age=3600'});fs.createReadStream(file).pipe(res);return;
      }
      const input=write?await body(req):{};
      if(route==='/api/play'&&req.method==='POST'){
        need(user,'play');return await player.run(async()=>{
          if(input.playlist){const p=store.data.playlists.find(x=>x.id===input.playlist);if(!p||!Number.isInteger(input.index)||!p.items[input.index])throw Error('Playlist item not found');await player.play(p.items[input.index],0);store.instance.playlist=p.id;store.instance.index=input.index;store.save();}
          else {await player.play(input.id,input.restart?0:undefined);if(input.id){store.instance.playlist=null;store.instance.index=-1;store.save();}}
          json(res,200,player.status());
        });
      }
      if(['/api/pause','/api/next','/api/previous','/api/seek'].includes(route)&&req.method==='POST'){
        need(user,'play');return await player.run(async()=>{if(route.endsWith('/pause'))player.pause();if(route.endsWith('/next'))await player.next();if(route.endsWith('/previous'))await player.previous();if(route.endsWith('/seek'))await player.seek(input.position);json(res,200,player.status());});
      }
      if(route==='/api/volume'&&req.method==='POST'){need(user,'volume');player.volume(input.volume);return json(res,200,player.status());}
      if(route==='/api/queue'&&req.method==='POST'){need(user,'queue');store.instance.queue=checkedItems(input.items);store.save();return json(res,200,player.status());}
      if(route==='/api/mode'&&req.method==='POST'){need(user,'play');if(!['off','all','one'].includes(input.repeat)||typeof input.shuffle!=='boolean')throw Error('Invalid play mode');Object.assign(store.instance,{shuffle:input.shuffle,repeat:input.repeat});store.save();return json(res,200,player.status());}
      if(route==='/api/settings'&&req.method==='POST'){need(user,'settings');store.instance.name=text(input.name);store.save();return json(res,200,player.status());}
      if(route==='/api/playlists'&&req.method==='POST'){need(user,'createPlaylist');const p={id:randomUUID(),name:text(input.name),items:[]};if(!p.name)throw Error('Name required');store.data.playlists.push(p);store.save();return json(res,201,p);}
      const playlist=/^\/api\/playlists\/([\da-f-]{36})$/.exec(route);
      if(playlist){
        const p=store.data.playlists.find(x=>x.id===playlist[1]);if(!p)return json(res,404,{error:'Playlist not found'});
        if(req.method==='DELETE'){need(user,'deletePlaylist');store.data.playlists=store.data.playlists.filter(x=>x!==p);store.save();return json(res,200,{ok:true});}
        if(req.method==='PATCH'){need(user,'editPlaylist');if(input.name!==undefined){const n=text(input.name);if(!n)throw Error('Name required');p.name=n;}if(input.items!==undefined)p.items=checkedItems(input.items);store.save();return json(res,200,p);}
      }
      const track=/^\/api\/tracks\/([\da-f-]{36})$/.exec(route);
      if(track&&req.method==='DELETE'){
        need(user,'delete');const id=track[1];if(store.instance.current===id){player.pause();store.instance.current=null;}
        store.data.tracks=store.data.tracks.filter(t=>t.id!==id);for(const p of store.data.playlists)p.items=p.items.filter(x=>x!==id);store.instance.queue=store.instance.queue.filter(x=>x!==id);store.save();return json(res,200,{ok:true});
      }
      if(track&&req.method==='PATCH'){need(user,'edit');const t=store.track(track[1]);if(!t)return json(res,404,{});for(const k of ['title','artist','album'])if(input[k]!==undefined)t[k]=text(input[k]);store.save();return json(res,200,trackInfo(t));}
      if(route==='/api/users'){
        need(user,'users');
        if(req.method==='GET')return json(res,200,store.data.users.filter(u=>!u.name.startsWith('$$')).map(userInfo));
        if(req.method==='POST'){const name=text(input.name,80);if(!name||store.data.users.some(u=>u.name.toLowerCase()===name.toLowerCase()))throw Error('Choose a unique username');if(typeof input.password!=='string'||input.password.length<3)throw Error('Password must contain at least 3 characters');const u={id:randomUUID(),name,locked:false,admin:false,privileges:1|2|4096|8192,...passwordHash(input.password)};store.data.users.push(u);store.save();return json(res,201,userInfo(u));}
      }
      const target=/^\/api\/users\/([\da-f-]{36})$/.exec(route);
      if(target&&req.method==='PATCH'){
        need(user,'users');const u=store.data.users.find(x=>x.id===target[1]);if(!u)throw Error('User not found');
        if(u.admin&&input.locked)throw Error('Administrator cannot be locked');
        if(input.password!==undefined){if(typeof input.password!=='string'||input.password.length<3)throw Error('Password too short');Object.assign(u,passwordHash(input.password));for(const [k,v]of sessions)if(v.user===u.id)sessions.delete(k);}
        if(input.privileges!==undefined){if(!Number.isInteger(input.privileges)||input.privileges<0||input.privileges>2147483647)throw Error('Invalid permissions');u.privileges=input.privileges;u.instancePrivileges={};}
        if(input.locked!==undefined)u.locked=!!input.locked;
        store.save();return json(res,200,userInfo(u));
      }
      if(route==='/api/password'&&req.method==='POST'){if(typeof input.password!=='string'||input.password.length<3||!verifyPassword(input.current||'',user))throw Error('Check the current and new password');Object.assign(user,passwordHash(input.password));store.save();for(const[k,v]of sessions)if(v.user===user.id)sessions.delete(k);return json(res,200,{ok:true});}
      return json(res,404,{error:'Not found'});
    }
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
    const assets={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/icon.svg':'icon.svg','/icon.png':'icon.png'};
    const asset=assets[route];if(!asset)return json(res,404,{error:'Not found'});
    res.setHeader('Content-Type',asset.endsWith('.html')?'text/html; charset=utf-8':asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':asset.endsWith('.svg')?'image/svg+xml':'image/png');
    res.setHeader('Cache-Control','no-cache');fs.createReadStream(path.join(publicDir,asset)).pipe(res);
  }catch(error){if(!res.headersSent)json(res,error.status||400,{error:error.message||'Request failed'});else res.destroy();}
});
server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('Discord-Music independent web player listening'));
const cleanup=setInterval(()=>{const now=Date.now();for(const[k,v]of sessions)if(v.expires<now)sessions.delete(k);for(const[k,v]of attempts)if(now-v.time>60000)attempts.delete(k);},60000);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(cleanup);player.close();server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(0),3000).unref();});
