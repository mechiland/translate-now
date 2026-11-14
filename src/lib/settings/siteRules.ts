import type { DisplayMode, Settings, SiteMode, SiteRule } from './schema';

/** Normalize user input like "https://www.example.com/path" -> "www.example.com". */
export function normalizePattern(input: string): string {
  let p = input.trim().toLowerCase();
  const exact = p.startsWith('=');
  if (exact) p = p.slice(1);
  p = p.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  p = p.split(/[/?#]/)[0] ?? '';
  p = p.replace(/:\d+$/, '');
  p = p.replace(/\.$/, '');
  return exact ? `=${p}` : p;
}

/**
 * Specificity of a match, or -1 if the pattern doesn't match.
 * Higher = more specific. Exact ("=host") beats plain host beats wildcard.
 */
export function matchScore(pattern: string, host: string): number {
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = normalizePattern(pattern);
  if (!p) return -1;
  if (p.startsWith('=')) {
    return p.slice(1) === h ? 3000 + p.length : -1;
  }
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    // Ties with a plain pattern of the same base go to the explicit wildcard.
    return h.endsWith(`.${base}`) ? 1000 + base.length * 2 + 1 : -1;
  }
  if (h === p) return 2000 + p.length;
  if (h.endsWith(`.${p}`)) return 1000 + p.length * 2;
  return -1;
}

export function findSiteRule(rules: SiteRule[], host: string): SiteRule | undefined {
  let best: SiteRule | undefined;
  let bestScore = -1;
  for (const rule of rules) {
    const score = matchScore(rule.pattern, host);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

export interface EffectiveSiteConfig {
  rule?: SiteRule;
  mode: SiteMode;
  styleId: string;
  displayMode: DisplayMode;
  selectionEnabled: boolean;
}

export function effectiveSiteConfig(settings: Settings, host: string): EffectiveSiteConfig {
  const rule = findSiteRule(settings.siteRules, host);
  return {
    rule,
    mode: rule?.mode ?? 'default',
    styleId: rule?.styleId || settings.styleId,
    displayMode: rule?.displayMode ?? settings.displayMode,
    selectionEnabled: rule?.selection ?? settings.selection.enabled,
  };
}

/** Return a new rule list with the rule for `pattern` updated (or created / removed if empty). */
export function upsertSiteRule(
  rules: SiteRule[],
  pattern: string,
  patch: Partial<Omit<SiteRule, 'pattern'>>,
): SiteRule[] {
  const p = normalizePattern(pattern);
  const idx = rules.findIndex((r) => normalizePattern(r.pattern) === p);
  const existing: SiteRule = idx >= 0 ? rules[idx]! : { pattern: p, mode: 'default' };
  const updated: SiteRule = { ...existing, ...patch, pattern: p };
  for (const key of Object.keys(updated) as (keyof SiteRule)[]) {
    if (updated[key] === undefined) delete updated[key];
  }
  const isEmpty =
    updated.mode === 'default' &&
    updated.styleId === undefined &&
    updated.displayMode === undefined &&
    updated.selection === undefined;
  const next = rules.slice();
  if (idx >= 0) {
    if (isEmpty) next.splice(idx, 1);
    else next[idx] = updated;
  } else if (!isEmpty) {
    next.push(updated);
  }
  return next;
}
