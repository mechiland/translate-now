/** Remove reasoning blocks and markdown fences some models wrap around their output. */
export function cleanModelOutput(raw: string): string {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // An unterminated <think> at the start means the whole thing is reasoning up to the first seg.
  s = s.replace(/^\s*<think>[\s\S]*?(?=<seg\b)/i, '');
  s = s.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(s);
  if (fence) s = fence[1]!.trim();
  return s;
}

/**
 * Parse `<seg id="N">...</seg>` blocks. Returns an array of length `expected`;
 * entries the model failed to return are `undefined`.
 */
export function parseSegments(raw: string, expected: number): (string | undefined)[] {
  const out: (string | undefined)[] = new Array<string | undefined>(expected).fill(undefined);
  const text = cleanModelOutput(raw);
  const re = /<seg\s+id\s*=\s*["']?(\d+)["']?\s*>([\s\S]*?)(?:<\/seg>|(?=<seg\s+id\s*=)|$)/gi;
  let found = 0;
  for (const m of text.matchAll(re)) {
    const id = Number(m[1]);
    const value = m[2]!.trim();
    if (id >= 1 && id <= expected && out[id - 1] === undefined && value.length > 0) {
      out[id - 1] = value;
      found++;
    }
  }
  if (found === 0 && expected === 1) {
    // Model ignored the tag format for a single segment — accept the whole reply.
    const plain = text.replace(/<\/?seg[^>]*>/gi, '').trim();
    if (plain) out[0] = plain;
  }
  return out;
}

export function cleanSelectionOutput(raw: string): string {
  return cleanModelOutput(raw)
    .replace(/<\/?seg[^>]*>/gi, '')
    .trim();
}
