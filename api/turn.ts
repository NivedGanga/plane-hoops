import type { IncomingMessage, ServerResponse } from 'node:http';

// No provider secret is ever exposed through Vite's client-side environment.
// Metered warns that new credentials can take up to two minutes to propagate.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') { res.statusCode = 405; res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  const domain = process.env.METERED_DOMAIN;
  const secret = process.env.METERED_SECRET_KEY;
  if (!domain || !secret || !/^[a-z0-9-]+\.metered\.live$/i.test(domain)) {
    res.statusCode = 200; res.end(JSON.stringify({ iceServers: [], fallback: 'stun-only' })); return;
  }
  try {
    const createUrl = new URL(`https://${domain}/api/v1/turn/credential`);
    createUrl.searchParams.set('secretKey', secret);
    const created = await fetch(createUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiryInSeconds: 14400, label: 'plane-hoops' }) });
    if (!created.ok) throw new Error('TURN credential creation failed');
    const credential = await created.json() as { apiKey?: string };
    if (!credential.apiKey) throw new Error('TURN credential missing API key');
    const getUrl = new URL(`https://${domain}/api/v1/turn/credentials`);
    getUrl.searchParams.set('apiKey', credential.apiKey);
    const result = await fetch(getUrl);
    if (!result.ok) throw new Error('TURN server discovery failed');
    const iceServers = await result.json() as unknown;
    if (!Array.isArray(iceServers)) throw new Error('Invalid TURN response');
    res.statusCode = 200; res.end(JSON.stringify({ iceServers, expiresInSeconds: 14400 }));
  } catch {
    // Do not disclose the provider's URL, key, response body or credentials in errors.
    res.statusCode = 200; res.end(JSON.stringify({ iceServers: [], fallback: 'stun-only' }));
  }
}
