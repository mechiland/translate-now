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

/** Text of the generated test PDF: a heading and paragraphs, each line on its own baseline. */
export const PDF_PARAGRAPHS = [
  ['Introduction'],
  [
    'Recurrent neural networks have been firmly established as state of the art',
    'approaches in sequence modeling and transduction problems such as language',
    'modeling and machine translation.',
  ],
  [
    'In this work we propose the Transformer, a model architecture eschewing',
    'recurrence and instead relying entirely on an attention mechanism.',
  ],
];

/** A minimal one-page PDF (Helvetica text) for the PDF viewer tests. */
export function makePdf(): Buffer {
  const ops: string[] = [];
  let y = 720;
  PDF_PARAGRAPHS.forEach((lines, i) => {
    const size = i === 0 ? 16 : 11;
    for (const line of lines) {
      ops.push(`BT /F1 ${size} Tf 72 ${y} Td (${line}) Tj ET`);
      y -= size * 1.25;
    }
    y -= 14;
  });
  ops.push('BT /F1 10 Tf 300 40 Td (1) Tj ET');
  return pdfFile(ops.join('\n'), { F1: 'Helvetica' });
}

/**
 * A PDF set in Times with what the translation has to carry over: a red notice, a bold
 * run-in heading, a superscript footnote mark, inline code and a bulleted list.
 */
export function makeStyledPdf(): Buffer {
  const ops = [
    '1 0 0 rg BT /R 11 Tf 72 720 Td (Important: the old export format will be removed in the next version.) Tj ET',
    '0 g BT /B 11 Tf 72 690 Td (Encoder:) Tj /R 11 Tf ( The encoder is composed of a stack of identical layers, and each layer) Tj ET',
    'BT /R 11 Tf 72 676 Td (has two sub-layers with small gradients) Tj /R 7 Tf 4 Ts (4) Tj 0 Ts /R 11 Tf (. Use the) Tj /C 10 Tf ( --config ) Tj /R 11 Tf (option.) Tj ET',
    'BT /R 11 Tf 90 640 Td (\\225 In encoder-decoder attention layers, the queries come from the previous) Tj ET',
    'BT /R 11 Tf 99 626 Td (decoder layer, and the memory keys come from the encoder.) Tj ET',
  ];
  return pdfFile(ops.join('\n'), { R: 'Times-Roman', B: 'Times-Bold', C: 'Courier' });
}

function pdfFile(content: string, fonts: Record<string, string>): Buffer {
  const names = Object.keys(fonts);
  const fontRefs = names.map((n, i) => `/${n} ${5 + i} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << ${fontRefs} >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...names.map(
      (n) => `<< /Type /Font /Subtype /Type1 /BaseFont /${fonts[n]} /Encoding /WinAnsiEncoding >>`,
    ),
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
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
    if (url.pathname === '/styled.pdf') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/pdf' });
      res.end(makeStyledPdf());
      return;
    }
    if (url.pathname.endsWith('.pdf') || url.pathname.startsWith('/pdf/')) {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/pdf' });
      res.end(makePdf());
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
