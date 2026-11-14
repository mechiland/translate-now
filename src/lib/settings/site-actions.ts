import type { DisplayMode, Settings, SiteMode } from './schema';
import { findSiteRule, upsertSiteRule } from './siteRules';

/** Change display mode: updates the site's override if it has one, else the global setting. */
export function setDisplayMode(s: Settings, host: string, mode: DisplayMode): void {
  const rule = findSiteRule(s.siteRules, host);
  if (rule?.displayMode !== undefined) {
    s.siteRules = upsertSiteRule(s.siteRules, rule.pattern, { displayMode: mode });
  } else {
    s.displayMode = mode;
  }
}

export function setStyle(s: Settings, host: string, styleId: string): void {
  const rule = findSiteRule(s.siteRules, host);
  if (rule?.styleId !== undefined) {
    s.siteRules = upsertSiteRule(s.siteRules, rule.pattern, { styleId });
  } else {
    s.styleId = styleId;
  }
}

export function setSiteMode(s: Settings, host: string, mode: SiteMode): void {
  const rule = findSiteRule(s.siteRules, host);
  s.siteRules = upsertSiteRule(s.siteRules, rule?.pattern ?? host, { mode });
}

export function setSiteSelection(s: Settings, host: string, enabled: boolean): void {
  const rule = findSiteRule(s.siteRules, host);
  const value = enabled === s.selection.enabled ? undefined : enabled;
  s.siteRules = upsertSiteRule(s.siteRules, rule?.pattern ?? host, { selection: value });
}
