export class SinusBot {
  constructor({ url, username, password, instanceId }) {
    this.url = url.replace(/\/$/, '');
    this.username = username;
    this.password = password;
    this.instanceId = instanceId;
  }
  async request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${this.url}/api/v1/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `bearer ${this.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`SinusBot API ${response.status} (${path.split('/').slice(0, 2).join('/')})`);
    return response.json();
  }
  async login() {
    const { defaultBotId } = await this.request('botId');
    this.botId = defaultBotId;
    const result = await this.request('bot/login', {
      method: 'POST', body: { username: this.username, password: this.password, botId: defaultBotId },
    });
    if (!result.token) throw new Error('SinusBot login returned no token');
    this.token = result.token;
    const instances = await this.request('bot/instances');
    if (!this.instanceId && instances.length === 1) this.instanceId = instances[0].uuid;
    if (!instances.some(i => i.uuid === this.instanceId)) throw new Error('Select a valid SINUSBOT_INSTANCE_ID');
  }
  async openStream(signal) {
    const { token } = await this.request(`bot/i/${this.instanceId}/streamToken`, { method: 'POST' });
    if (!token) throw new Error('SinusBot returned no stream token');
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 10000);
    let response;
    try {
      response = await fetch(`${this.url}/api/v1/b/${this.botId}/i/${this.instanceId}/stream/${encodeURIComponent(token)}`, {
        signal: AbortSignal.any([signal, timeout.signal]), redirect: 'error',
        headers: { Authorization: `bearer ${this.token}` },
      });
    } finally { clearTimeout(timer); }
    if (!response.ok || !response.body) throw new Error(`SinusBot audio stream HTTP ${response.status}`);
    return response.body;
  }
}
