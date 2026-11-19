const $=s=>document.querySelector(s), el=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e;};
let auth,library={tracks:[],playlists:[]},lookup=new Map(),status={},view='music',list='all',page=0,selected=new Set(),renderKey='',busy=false;
const can=p=>auth?.permissions.includes(p);
const time=ms=>{const n=Math.max(0,Math.floor((ms||0)/1000));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');};
function notice(s,error=false){$('#notice').textContent=s;$('#notice').classList.toggle('error',error);$('#notice').hidden=false;clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('#notice').hidden=true,7000);}
async function api(route,data,method){
  const options={method:method||(data===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-CSRF-Token':auth?.csrf||''}};
  if(data!==undefined)options.body=JSON.stringify(data);
  const res=await fetch('/api/'+route,options),body=await res.json();
  if(res.status===401){auth=null;showLogin();}
  if(!res.ok)throw Error(body.error||'Verzoek mislukt');return body;
}
const action=fn=>(...args)=>{try{return Promise.resolve(fn(...args)).catch(e=>notice(e.message,true));}catch(e){notice(e.message,true);}};
function button(label,fn,title){const b=el('button',label);if(title)b.title=title;b.onclick=action(fn);return b;}
function showLogin(){$('#loginPanel').hidden=false;$('#app').hidden=true;$('#mainNav').hidden=true;$('#brand').textContent='Discord-Music';}
async function load(){auth=await api('session');library=can('list')?await api('library'):{tracks:[],playlists:[]};lookup=new Map(library.tracks.map(t=>[t.id,t]));$('#loginPanel').hidden=true;$('#app').hidden=false;$('#mainNav').hidden=false;$('#uploadLabel').hidden=!can('upload');$('#newPlaylist').hidden=!can('createPlaylist');$('#instanceForm').hidden=!can('settings');$('#usersPanel').hidden=!can('users');$('#addSelected').hidden=!can('editPlaylist');$('#queueSelected').hidden=!can('queue');sidebar();await poll();render();}
function sidebar(){
  $('#playlists').replaceChildren(...library.playlists.map(p=>{const b=button(p.name,()=>choose(p.id));b.classList.toggle('active',list===p.id);return b;}));
  $('#addTarget').replaceChildren(...library.playlists.map(p=>{const o=el('option',p.name);o.value=p.id;return o;}));
}
function choose(id){list=id;view='music';page=0;selected.clear();$('#search').value='';sidebar();showView();render();}
function showView(){$('#musicPanel').hidden=view!=='music';$('#settingsPanel').hidden=view!=='settings';if(view==='settings'){ $('#instanceName').value=status.name||'';if(can('users'))loadUsers().catch(e=>notice(e.message,true));if(can('settings'))api('migration').then(m=>$('#migrationInfo').textContent=m.fresh?'Nieuwe bibliotheek':`Migratie gecontroleerd: ${m.tracks} nummers, ${m.playlists} playlists en ${m.playlistItems} playlistvermeldingen.`).catch(()=>{});}}
function items(){
  const p=library.playlists.find(p=>p.id===list),ids=list==='queue'?status.queue:p?.items;
  let rows=ids?ids.map((id,index)=>({track:lookup.get(id),index})).filter(x=>x.track):library.tracks.filter(t=>t.type!=='folder').map((track,index)=>({track,index}));
  const query=$('#search').value.toLocaleLowerCase();if(query)rows=rows.filter(({track:t})=>[t.title,t.artist,t.album].some(v=>v.toLocaleLowerCase().includes(query)));
  const key=$('#sort').value;if(key!=='original')rows.sort((a,b)=>(a.track[key]||'').localeCompare(b.track[key]||''));return rows;
}
function render(){
  const p=library.playlists.find(p=>p.id===list),all=items();page=Math.max(0,Math.min(page,Math.ceil(all.length/75)-1));
  const rows=all.slice(page*75,(page+1)*75);$('#listTitle').textContent=p?.name||(list==='queue'?'Wachtrij':'Alle muziek');$('#listCount').textContent=all.length+' nummers';$('#renamePlaylist').hidden=!p||!can('editPlaylist');$('#deletePlaylist').hidden=!p||!can('deletePlaylist');$('#tracks').replaceChildren();
  for(const {track:t,index}of rows){
    const tr=el('tr');tr.classList.toggle('current',status.current===t.id);
    const check=el('input');check.type='checkbox';check.checked=selected.has(t.id);check.setAttribute('aria-label','Selecteer '+t.title);check.onchange=()=>check.checked?selected.add(t.id):selected.delete(t.id);
    const cover=el('img');cover.src=t.cover?'/api/covers/'+t.id:'/icon.svg';cover.alt='';cover.loading='lazy';
    for(const child of [check,cover]){const td=el('td');td.append(child);tr.append(td);}
    for(const v of [t.title,t.artist,t.album,time(t.duration)])tr.append(el('td',v));
    const td=el('td'),actions=el('div',undefined,'rowActions');
    if(can('play'))actions.append(button('▶',()=>playRow(t.id,index), 'Speel '+t.title));
    if(p&&can('editPlaylist')){
      actions.append(button('↑',async()=>{if(index<1)return;const ids=[...p.items];[ids[index-1],ids[index]]=[ids[index],ids[index-1]];await api('playlists/'+p.id,{items:ids},'PATCH');await refreshLibrary();},'Omhoog'));
      actions.append(button('×',async()=>{const ids=[...p.items];ids.splice(index,1);await api('playlists/'+p.id,{items:ids},'PATCH');await refreshLibrary();},'Uit playlist verwijderen'));
    }else if(list==='queue'&&can('queue')){
      actions.append(button('×',async()=>{const ids=[...status.queue];ids.splice(index,1);status=await api('queue',{items:ids});render();},'Uit wachtrij'));
    }else if(list==='all'){
      if(can('edit'))actions.append(button('✎',async()=>{const title=prompt('Titel',t.title);if(title===null)return;const artist=prompt('Artiest',t.artist);if(artist===null)return;const album=prompt('Album',t.album);if(album===null)return;await api('tracks/'+t.id,{title,artist,album},'PATCH');await refreshLibrary();},'Metadata aanpassen'));
      if(can('delete'))actions.append(button('×',async()=>{if(confirm('Dit nummer uit de bibliotheek en playlists verwijderen? Het audiobestand blijft bewaard.')){await api('tracks/'+t.id,{},'DELETE');await refreshLibrary();}},'Verwijderen'));
    }
    td.append(actions);tr.append(td);tr.ondblclick=action(()=>can('play')&&playRow(t.id,index));$('#tracks').append(tr);
  }
  $('#pageCount').textContent=`${page+1} / ${Math.max(1,Math.ceil(all.length/75))}`;$('#prevPage').disabled=page===0;$('#nextPage').disabled=(page+1)*75>=all.length;$('#selectAll').checked=false;
}
async function playRow(id,index){status=await api('play',library.playlists.some(p=>p.id===list)?{playlist:list,index}:{id,restart:true});updatePlayer();}
async function refreshLibrary(){library=await api('library');lookup=new Map(library.tracks.map(t=>[t.id,t]));sidebar();render();}
function updatePlayer(){
  const t=lookup.get(status.current);$('#brand').textContent=status.name||'Discord-Music';$('#nowTitle').textContent=t?.title||'Kies een nummer';$('#nowArtist').textContent=t?.artist||'';$('#nowCover').src=t?.cover?'/api/covers/'+t.id:'/icon.svg';
  $('#playPause').textContent=status.playing?'Ⅱ':'▶';$('#playPause').setAttribute('aria-label',status.playing?'Pauzeren':'Afspelen');
  $('#elapsed').textContent=time(status.position);$('#duration').textContent=time(t?.duration);if(document.activeElement!==$('#seek'))$('#seek').value=t?.duration?Math.min(100,status.position/t.duration*100):0;
  if(document.activeElement!==$('#volume'))$('#volume').value=status.volume;$('#volumeText').textContent=status.volume+'%';
  $('#shuffle').classList.toggle('active',!!status.shuffle);$('#repeat').textContent='Herhaal: '+({off:'uit',all:'alles',one:'nummer'}[status.repeat]||'uit');$('#queueCount').textContent=status.queue?.length||0;
  $('#connectionStatus').textContent=(status.discordReady?'Discord verbonden':'Discord niet verbonden')+' · '+(status.connected?'In spraakkanaal':'Buiten spraakkanaal')+' · '+status.listeners+' luisteraars'+(status.error?' · '+status.error:'');
  for(const id of ['playPause','next','previous','seek','shuffle','repeat'])$('#'+id).disabled=!can('play');$('#volume').disabled=!can('volume');
  const key=status.current+JSON.stringify(status.queue);if(key!==renderKey){renderKey=key;render();}
}
async function poll(){if(!auth||busy)return;busy=true;try{status=await api('status');updatePlayer();}finally{busy=false;}}
$('#login').onsubmit=action(async e=>{e.preventDefault();auth=await api('login',Object.fromEntries(new FormData(e.target)));await load();e.target.reset();});
$('#logout').onclick=action(async()=>{await api('logout',{});auth=null;showLogin();});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;showView();});
$('#allMusic').onclick=()=>choose('all');$('#queueView').onclick=()=>choose('queue');
$('#search').oninput=()=>{page=0;render();};$('#sort').onchange=()=>{page=0;render();};$('#prevPage').onclick=()=>{page--;render();};$('#nextPage').onclick=()=>{page++;render();};
$('#selectAll').onchange=e=>{for(const {track}of items().slice(page*75,(page+1)*75))e.target.checked?selected.add(track.id):selected.delete(track.id);render();};
$('#newPlaylist').onclick=action(async()=>{const name=prompt('Naam van de playlist');if(!name)return;const p=await api('playlists',{name});await refreshLibrary();choose(p.id);});
$('#renamePlaylist').onclick=action(async()=>{const p=library.playlists.find(p=>p.id===list),name=prompt('Nieuwe naam',p.name);if(name){await api('playlists/'+p.id,{name},'PATCH');await refreshLibrary();}});
$('#deletePlaylist').onclick=action(async()=>{if(!confirm('Deze playlist verwijderen? De muziek blijft behouden.'))return;await api('playlists/'+list,{},'DELETE');list='all';await refreshLibrary();});
$('#addSelected').onclick=action(async()=>{const p=library.playlists.find(p=>p.id===$('#addTarget').value);if(!p||!selected.size)throw Error('Selecteer nummers en een playlist');await api('playlists/'+p.id,{items:[...p.items,...selected]},'PATCH');selected.clear();await refreshLibrary();notice('Nummers toegevoegd');});
$('#queueSelected').onclick=action(async()=>{if(!selected.size)throw Error('Selecteer nummers');status=await api('queue',{items:[...status.queue,...selected]});selected.clear();updatePlayer();render();});
$('#upload').onchange=action(async e=>{for(const file of e.target.files){notice('Uploaden: '+file.name);const res=await fetch('/api/upload?name='+encodeURIComponent(file.name),{method:'POST',headers:{'X-CSRF-Token':auth.csrf},body:file});const data=await res.json();if(!res.ok)throw Error(data.error);}e.target.value='';await refreshLibrary();notice('Upload voltooid');});
$('#playPause').onclick=action(async()=>{status=await api(status.playing?'pause':'play',{});updatePlayer();});
for(const key of ['next','previous'])$('#'+key).onclick=action(async()=>{status=await api(key,{});updatePlayer();});
$('#volume').oninput=e=>$('#volumeText').textContent=e.target.value+'%';
$('#volume').onchange=action(async e=>{status=await api('volume',{volume:Number(e.target.value)});updatePlayer();});
$('#seek').onchange=action(async e=>{status=await api('seek',{position:Number(e.target.value)/100*(lookup.get(status.current)?.duration||0)});updatePlayer();});
$('#shuffle').onclick=action(async()=>{status=await api('mode',{repeat:status.repeat,shuffle:!status.shuffle});updatePlayer();});
$('#repeat').onclick=action(async()=>{status=await api('mode',{shuffle:status.shuffle,repeat:{off:'all',all:'one',one:'off'}[status.repeat]});updatePlayer();});
$('#instanceForm').onsubmit=action(async e=>{e.preventDefault();status=await api('settings',{name:$('#instanceName').value});updatePlayer();notice('Naam opgeslagen');});
$('#passwordForm').onsubmit=action(async e=>{e.preventDefault();await api('password',Object.fromEntries(new FormData(e.target)));auth=null;e.target.reset();showLogin();notice('Wachtwoord gewijzigd; log opnieuw in');});
$('#newUser').onsubmit=action(async e=>{e.preventDefault();await api('users',Object.fromEntries(new FormData(e.target)));e.target.reset();await loadUsers();});
const rights={Inloggen:1,Bibliotheek:2,Uploaden:4,Verwijderen:8,Metadata:16,'Playlist maken':32,'Playlist verwijderen':64,'Playlist wijzigen':128,Gebruikers:512,Afspelen:4096,Wachtrij:8192,Instellingen:65536};
async function loadUsers(){
  const users=await api('users');$('#users').replaceChildren(...users.map(u=>{
    const box=el('div',undefined,'user');box.append(el('strong',u.name+(u.admin?' · beheerder':'')));
    if(!u.admin){const controls=el('div');for(const [name,bit]of Object.entries(rights)){const label=el('label'),check=el('input');check.type='checkbox';check.checked=!!(u.privileges&bit);check.dataset.bit=bit;label.append(check,document.createTextNode(name));controls.append(label);}box.append(controls,button('Rechten opslaan',async()=>{let privileges=0;controls.querySelectorAll('input:checked').forEach(c=>privileges|=Number(c.dataset.bit));await api('users/'+u.id,{privileges},'PATCH');notice('Rechten opgeslagen');}),button(u.locked?'Deblokkeren':'Blokkeren',async()=>{await api('users/'+u.id,{locked:!u.locked},'PATCH');await loadUsers();}));}
    box.append(button('Wachtwoord instellen',async()=>{const password=prompt('Nieuw wachtwoord voor '+u.name);if(password){await api('users/'+u.id,{password},'PATCH');notice('Wachtwoord bijgewerkt');}}));return box;
  }));
}
setInterval(()=>poll().catch(()=>{}),1200);load().catch(()=>showLogin());
