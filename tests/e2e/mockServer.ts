import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

export type MockMode = 'ok' | '429-twice' | '401' | 'slow' | 'cjk' | 'english';

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

const CJK_POOL =
  '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别手角期根论运农指几九区强放决西被干做必战先回则任取据处府';

/**
 * Deterministic pseudo-Chinese: every Latin or Cyrillic word becomes one to three Chinese characters
 * and the spaces between them go away, so the result has the length and glyphs of a real
 * Chinese translation. Inline <a id>/<m id/> tags, numbers and punctuation are kept.
 */
export function fakeChinese(text: string): string {
  return text
    .split(/(<\/?a(?: id="\d+")?>|<m id="\d+"\/>)/)
    .map((part, i) => {
      if (i % 2) return part;
      const out = part.replace(
        /[\p{Script=Latin}\p{Script=Cyrillic}][\p{L}\p{M}'’-]*/gu,
        (word) => {
          // Acronyms and codes (USD, NBA, TV) stay as they are, like a real translation.
          if (/^[A-Z]{1,4}$/.test(word)) return word;
          let h = 0;
          for (const c of word.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
          const n = Math.min(3, Math.max(1, Math.round(word.length / 3)));
          let s = '';
          for (let k = 0; k < n; k++) s += CJK_POOL[(h + k * 7919) % CJK_POOL.length];
          return s;
        },
      );
      return out
        .replace(/(?<=[\u4e00-\u9fff]) +(?=[\u4e00-\u9fff])/g, '')
        .replace(/(?<=[\u4e00-\u9fff])\. ?/g, '。')
        .replace(/(?<=[\u4e00-\u9fff]), ?/g, '，');
    })
    .join('');
}

/** Pseudo-English with word boundaries and lengths unlike the CJK source text. */
function fakeEnglish(text: string): string {
  const words = ['story', 'chapter', 'library', 'book', 'readers', 'reading'];
  return text
    .split(/(<\/?a(?: id="\d+")?>|<m id="\d+"\/>)/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/[^\P{L}\p{Script=Latin}]{1,3}/gu, (group) => {
            return ` ${words[group.codePointAt(0)! % words.length]}`;
          }),
    )
    .join('')
    .replace(/(^|\n) +/g, '$1');
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
        const fake =
          mode === 'cjk' ? fakeChinese : mode === 'english' ? fakeEnglish : fakeTranslate;
        const segs = [...user.matchAll(/<seg id="(\d+)">([\s\S]*?)<\/seg>/g)];
        const content = segs.length
          ? segs.map((m) => `<seg id="${m[1]}">${fake(m[2]!)}</seg>`).join('\n')
          : fake(user);
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
