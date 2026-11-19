// Run against a disposable server with DISCORD_DISABLED=1 and the test password.
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:8080';
let cookie='',csrf='';
async function req(route,body,method,headers={}) {
 const response=await fetch(base+'/api/'+route,{method:method||(body===undefined?'GET':'POST'),headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return {response,data:await response.json()};
}
assert.equal((await req('library')).response.status,401);
let r=await req('login',{name:'admin',password:process.env.TEST_PASSWORD||'integration-test'});
assert.equal(r.response.status,200);cookie=r.response.headers.get('set-cookie').split(';')[0];csrf=r.data.csrf;
assert.equal((await req('settings',{name:'bad'},undefined,{'X-CSRF-Token':'wrong'})).response.status,403);
assert.equal((await req('settings',{name:'bad'},undefined,{Origin:'https://evil.example'})).response.status,403);
// 0.3-second mono PCM WAV, decoded by ffprobe on upload and FFmpeg during playback tests.
const wav=Buffer.alloc(44+24000*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<24000;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/48000)*2000),44+i*2);
const uploaded=await fetch(base+'/api/upload?name=tone.wav',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:wav});
assert.equal(uploaded.status,201);const track=await uploaded.json();assert(track.duration>=490);
const playlist=(await req('playlists',{name:'Integration'})).data;
r=await req('playlists/'+playlist.id,{items:[track.id,track.id]},'PATCH');assert.deepEqual(r.data.items,[track.id,track.id]);
assert.equal((await req('play',{id:track.id})).response.status,400);
await req('queue',{items:[track.id]});await req('volume',{volume:38});await req('settings',{name:'Integration Room'});
const state=(await req('status')).data;assert.equal(state.playing,false);assert.equal(state.volume,38);assert.equal(state.name,'Integration Room');
assert.equal((await req('tracks/'+track.id,{title:'Edited title'},'PATCH')).data.title,'Edited title');
const user=(await req('users',{name:'listener-'+Date.now(),password:'test-pass'})).data;
await req('users/'+user.id,{privileges:3},'PATCH');
const adminCookie=cookie,adminCSRF=csrf;
r=await req('login',{name:user.name,password:'test-pass'});cookie=r.response.headers.get('set-cookie').split(';')[0];csrf=r.data.csrf;
assert.equal((await req('users')).response.status,403);assert.equal((await req('volume',{volume:99})).response.status,403);
assert.equal((await req('library')).response.status,200);
cookie=adminCookie;csrf=adminCSRF;
await req('tracks/'+track.id,{},'DELETE');assert.deepEqual((await req('library')).data.playlists.find(p=>p.id===playlist.id).items,[]);
console.log('PASS: authentication, CSRF, permissions, upload, metadata, duplicate playlist entries, queue, settings, safe deletion.');
