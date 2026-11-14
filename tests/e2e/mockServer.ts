import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

export type MockMode = 'ok' | '429-twice' | '401' | 'slow';

export interface MockServer {
  url: string;
  port: number;
  requests: { system: string; user: string; auth?: string }[];
  setMode(mode: MockMode): void;
  close(): Promise<void>;
}

/** Deterministic fake translation: "[ZH] " + original text. */
export function fakeTranslate(text: string): string {
  return `[ZH] ${text}`;
}

export async function startMockServer(fixturesDir: string): Promise<MockServer> {
  let mode: MockMode = 'ok';
  let rateLimitedLeft = 0;
  const requests: MockServer['requests'] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    if (url.pathname === '/v1/models') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'mock-model-2' }] }));
      return;
    }
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        const json = JSON.parse(body) as { messages: { role: string; content: string }[] };
        const system = json.messages.find((m) => m.role === 'system')?.content ?? '';
        const user = json.messages.find((m) => m.role === 'user')?.content ?? '';
        requests.push({ system, user, auth: req.headers.authorization });
        const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
          res.writeHead(status, { ...cors, 'Content-Type': 'application/json', ...headers });
          res.end(JSON.stringify(payload));
        };
        if (mode === '401') return send(401, { error: { message: 'Invalid API key' } });
        if (mode === '429-twice' && rateLimitedLeft > 0) {
          rateLimitedLeft--;
          return send(429, { error: { message: 'Rate limited' } }, { 'Retry-After': '0' });
        }
        const segs = [...user.matchAll(/<seg id="(\d+)">([\s\S]*?)<\/seg>/g)];
        const content = segs.length
          ? segs.map((m) => `<seg id="${m[1]}">${fakeTranslate(m[2]!)}</seg>`).join('\n')
          : fakeTranslate(user);
        const reply = () => send(200, { choices: [{ message: { role: 'assistant', content } }] });
        if (mode === 'slow') setTimeout(reply, 400);
        else reply();
      });
      return;
    }
    // Static fixtures
    const file = path.join(fixturesDir, url.pathname === '/' ? 'page.html' : url.pathname);
    if (file.startsWith(fixturesDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(file));
      return;
    }
    res.writeHead(404).end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    setMode(m) {
      mode = m;
      rateLimitedLeft = m === '429-twice' ? 2 : 0;
    },
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        // The browser keeps connections alive; don't wait for it to hang up.
        server.closeAllConnections();
      }),
  };
}
