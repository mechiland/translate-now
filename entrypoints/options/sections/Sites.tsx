import { useState } from 'react';
import type { MessageKey } from '@/lib/i18n';
import type { DisplayMode, SiteMode, SiteRule } from '@/lib/settings/schema';
import { normalizePattern, upsertSiteRule } from '@/lib/settings/siteRules';
import { allStyles } from '@/lib/settings/styles';
import type { SectionProps } from './types';

export function SitesSection({ settings, update, t }: SectionProps) {
  const [pattern, setPattern] = useState('');
  const styles = allStyles(settings);

  const patchRule = (rule: SiteRule, patch: Partial<SiteRule>) =>
    void update((s) => {
      s.siteRules = s.siteRules.map((r) =>
        r.pattern === rule.pattern ? stripUndefined({ ...r, ...patch }) : r,
      );
    });

  const add = () => {
    const p = normalizePattern(pattern);
    if (!p || p === '=' || p === '*.') return;
    void update((s) => {
      s.siteRules = upsertSiteRule(s.siteRules, p, { mode: 'always' });
    });
    setPattern('');
  };

  return (
    <div>
      <p className="intro">{t('sitesIntro')}</p>
      {settings.siteRules.length === 0 ? (
        <p className="muted">{t('sitesEmpty')}</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>{t('sitePattern')}</th>
              <th>{t('siteMode')}</th>
              <th>{t('siteStyle')}</th>
              <th>{t('siteDisplay')}</th>
              <th>{t('siteSelection')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {settings.siteRules.map((rule) => (
              <tr key={rule.pattern}>
                <td>
                  <code>{rule.pattern}</code>
                </td>
                <td>
                  <select
                    value={rule.mode}
                    onChange={(e) => patchRule(rule, { mode: e.target.value as SiteMode })}
                  >
                    <option value="default">{t('popupSiteDefault')}</option>
                    <option value="always">{t('popupSiteAlways')}</option>
                    <option value="never">{t('popupSiteNever')}</option>
                  </select>
                </td>
                <td>
                  <select
                    value={rule.styleId ?? ''}
                    onChange={(e) => patchRule(rule, { styleId: e.target.value || undefined })}
                  >
                    <option value="">{t('siteFollowGlobal')}</option>
                    {styles.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.builtin ? t(`style_${st.id}` as MessageKey) : st.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={rule.displayMode ?? ''}
                    onChange={(e) =>
                      patchRule(rule, {
                        displayMode: (e.target.value || undefined) as DisplayMode | undefined,
                      })
                    }
                  >
                    <option value="">{t('siteFollowGlobal')}</option>
                    <option value="bilingual">{t('displayBilingual')}</option>
                    <option value="translation-only">{t('displayTranslationOnly')}</option>
                  </select>
                </td>
                <td>
                  <select
                    value={rule.selection === undefined ? '' : rule.selection ? 'on' : 'off'}
                    onChange={(e) =>
                      patchRule(rule, {
                        selection: e.target.value === '' ? undefined : e.target.value === 'on',
                      })
                    }
                  >
                    <option value="">{t('siteFollowGlobal')}</option>
                    <option value="on">{t('on')}</option>
                    <option value="off">{t('off')}</option>
                  </select>
                </td>
                <td>
                  <button
                    className="btn small danger"
                    onClick={() =>
                      void update(
                        (s) =>
                          void (s.siteRules = s.siteRules.filter(
                            (r) => r.pattern !== rule.pattern,
                          )),
                      )
                    }
                  >
                    {t('delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="actions">
        <input
          type="text"
          value={pattern}
          placeholder="example.com"
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn" onClick={add} disabled={!pattern.trim()}>
          + {t('siteAdd')}
        </button>
      </div>
    </div>
  );
}

function stripUndefined(rule: SiteRule): SiteRule {
  const out = { ...rule };
  for (const k of Object.keys(out) as (keyof SiteRule)[]) if (out[k] === undefined) delete out[k];
  return out;
}
