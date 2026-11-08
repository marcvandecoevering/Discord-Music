import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SinusBot } from './sinusbot.js';

async function fixture(t, { instances = [{ uuid: 'instance-1' }], redirect = false } = {}) {
  const server = http.createServer((req, res) => {
    const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (req.url === '/api/v1/botId') return json({ defaultBotId: 'bot-1' });
    if (req.url === '/api/v1/bot/login' && req.method === 'POST') return json({ token: 'auth-token' });
    if (req.headers.authorization !== 'bearer auth-token') { res.writeHead(401); return res.end(); }
    if (req.url === '/api/v1/bot/instances') return json(instances);
    if (req.url === '/api/v1/bot/i/instance-1/streamToken' && req.method === 'POST') return json({ token: 'stream-token' });
    if (req.url === '/api/v1/b/bot-1/i/instance-1/stream/stream-token') {
      if (redirect) { res.writeHead(302, { Location: 'http://127.0.0.1:1/' }); return res.end(); }
      return res.end('OggS-test');
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return new SinusBot({ url: `http://127.0.0.1:${server.address().port}`, username: 'admin', password: 'test-password' });
}
test('Uses authenticated POST token endpoint and bot-ID stream route', async t => {
  const bot = await fixture(t);
  await bot.login();
  const stream = await bot.openStream(AbortSignal.timeout(1000));
  assert.equal(await new Response(stream).text(), 'OggS-test');
});
test('Does not select an arbitrary instance when multiple exist', async t => {
  const bot = await fixture(t, { instances: [{ uuid: 'one' }, { uuid: 'two' }] });
  await assert.rejects(bot.login(), /SINUSBOT_INSTANCE_ID/);
});
test('Refuses audio redirects so authentication stays on the configured server', async t => {
  const bot = await fixture(t, { redirect: true });
  await bot.login();
  await assert.rejects(bot.openStream(AbortSignal.timeout(1000)));
});
