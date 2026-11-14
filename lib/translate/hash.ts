/** SHA-256 hex digest via WebCrypto (available in service workers, pages, Node 20+). */
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface CacheKeyParts {
  text: string;
  targetLang: string;
  protocol: string;
  baseURL: string;
  model: string;
  styleInstruction: string;
  glossary: string;
  /** "page" or "selection": prompts differ, so cache entries differ. */
  kind: string;
}

export function cacheKey(p: CacheKeyParts): Promise<string> {
  return sha256(
    JSON.stringify([
      p.kind,
      p.text,
      p.targetLang,
      p.protocol,
      p.baseURL.replace(/\/+$/, ''),
      p.model,
      p.styleInstruction,
      p.glossary,
    ]),
  );
}
