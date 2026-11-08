import http from 'node:http';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

// Only these two upstream routes are proxied here. Authorization stays with SinusBot.
const path = '/data/discord-music-instance-names.json';
const names = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : {};
http.createServer(async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
    res.end(JSON.stringify(data));
  };
  try {
    const route = req.url.split('?')[0];
    const id = /^\/api\/v1\/bot\/i\/([\da-f-]{36})\/settings$/.exec(route)?.[1];
    const list = route === '/api/v1/bot/instances';
    if ((!id && !list) || (req.method !== 'GET' && !(id && req.method === 'POST'))) return send(404, {});
    const upstream = async (endpoint, body) => {
      const response = await fetch('http://127.0.0.1:8087'+endpoint, {
        headers:{Authorization:req.headers.authorization || '', 'Content-Type':'application/json'},
        method:body ? 'POST':'GET', body:body && JSON.stringify(body), signal:AbortSignal.timeout(15000)
      });
      if (!response.ok) throw Object.assign(new Error(), {status:response.status});
      return response.json();
    };
    const data = await upstream(route);
    if (req.method === 'GET') {
      if (list && Array.isArray(data)) for (const i of data) if (Object.hasOwn(names,i.uuid)) i.name=names[i.uuid];
      if (id && Object.hasOwn(names,id)) data.name=names[id];
      return send(200,data);
    }
    const user = await upstream('/api/v1/bot/user');
    if (!((user.privileges | user.instancePrivileges?.[id]) & 65536)) return send(403,{error:'Permission denied'});
    let raw='';
    for await (const chunk of req) { raw+=chunk; if (raw.length>262144) return send(413,{}); }
    const body=JSON.parse(raw);
    if (!Object.hasOwn(body,'name')) return send(200,await upstream(route,body));
    if (typeof body.name!=='string' || body.name.length>256) return send(400,{error:'Invalid instance name'});
    const name=body.name.trim();
    const changed=Object.keys(body).some(k => k!=='name' && !isDeepStrictEqual(body[k],data[k]));
    if (changed) {
      const result=await upstream(route,{...body,name:data.name});
      if (result?.success===false) return send(422,result);
    }
    const updated={...names,[id]:name};
    fs.writeFileSync(path+'.tmp',JSON.stringify(updated),{mode:0o600});
    fs.renameSync(path+'.tmp',path);
    names[id]=name;
    send(200,{success:true});
  } catch(e) { send(e.status || 500,{error:'Unable to load or save instance settings'}); }
}).listen(8089,'127.0.0.1');
