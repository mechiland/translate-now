import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, Delete02Icon, WebDesign01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SettingsCard } from '@/components/app/settings-card';
import { SimpleSelect } from '@/components/app/simple-select';
import type { MessageKey } from '@/lib/i18n';
import type { DisplayMode, SiteMode, SiteRule } from '@/lib/settings/schema';
import { normalizePattern, upsertSiteRule } from '@/lib/settings/siteRules';
import { allStyles } from '@/lib/settings/styles';
import type { SectionProps } from './types';

/** Select value for "follow the global setting" (Select values can't be empty). */
const INHERIT = 'inherit';

export function SitesSection({ settings, update, t }: SectionProps) {
  const [pattern, setPattern] = useState('');
  const inherit = { value: INHERIT, label: t('siteFollowGlobal') };
  const styleOptions = [
    inherit,
    ...allStyles(settings).map((st) => ({
      value: st.id,
      label: st.builtin ? t(`style_${st.id}` as MessageKey) : st.name,
    })),
  ];

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
    <>
      <p className="m-0 text-sm text-muted-foreground">{t('sitesIntro')}</p>
      <SettingsCard>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            value={pattern}
            placeholder="example.com"
            aria-label={t('sitePattern')}
            onChange={(e) => setPattern(e.target.value)}
          />
          <Button type="submit" disabled={!pattern.trim()}>
            <HugeiconsIcon icon={Add01Icon} />
            {t('siteAdd')}
          </Button>
        </form>
        {settings.siteRules.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={WebDesign01Icon} />
              </EmptyMedia>
              <EmptyTitle>{t('navSites')}</EmptyTitle>
              <EmptyDescription>{t('sitesEmpty')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('sitePattern')}</TableHead>
                <TableHead>{t('siteMode')}</TableHead>
                <TableHead>{t('siteStyle')}</TableHead>
                <TableHead>{t('siteDisplay')}</TableHead>
                <TableHead>{t('siteSelection')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {settings.siteRules.map((rule) => (
                <TableRow key={rule.pattern}>
                  <TableCell className="font-mono text-xs">{rule.pattern}</TableCell>
                  <TableCell>
                    <SimpleSelect
                      size="sm"
                      label={t('siteMode')}
                      value={rule.mode}
                      options={[
                        { value: 'default', label: t('popupSiteDefault') },
                        { value: 'always', label: t('popupSiteAlways') },
                        { value: 'never', label: t('popupSiteNever') },
                      ]}
                      onChange={(v) => patchRule(rule, { mode: v as SiteMode })}
                    />
                  </TableCell>
                  <TableCell>
                    <SimpleSelect
                      size="sm"
                      label={t('siteStyle')}
                      value={rule.styleId ?? INHERIT}
                      options={styleOptions}
                      onChange={(v) => patchRule(rule, { styleId: v === INHERIT ? undefined : v })}
                    />
                  </TableCell>
                  <TableCell>
                    <SimpleSelect
                      size="sm"
                      label={t('siteDisplay')}
                      value={rule.displayMode ?? INHERIT}
                      options={[
                        inherit,
                        { value: 'bilingual', label: t('displayBilingual') },
                        { value: 'translation-only', label: t('displayTranslationOnly') },
                      ]}
                      onChange={(v) =>
                        patchRule(rule, {
                          displayMode: v === INHERIT ? undefined : (v as DisplayMode),
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <SimpleSelect
                      size="sm"
                      label={t('siteSelection')}
                      value={rule.selection === undefined ? INHERIT : rule.selection ? 'on' : 'off'}
                      options={[
                        inherit,
                        { value: 'on', label: t('on') },
                        { value: 'off', label: t('off') },
                      ]}
                      onChange={(v) =>
                        patchRule(rule, { selection: v === INHERIT ? undefined : v === 'on' })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      color="red"
                      aria-label={t('delete')}
                      title={t('delete')}
                      onClick={() =>
                        void update(
                          (s) =>
                            void (s.siteRules = s.siteRules.filter(
                              (r) => r.pattern !== rule.pattern,
                            )),
                        )
                      }
                    >
                      <HugeiconsIcon icon={Delete02Icon} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SettingsCard>
    </>
  );
}

function stripUndefined(rule: SiteRule): SiteRule {
  const out = { ...rule };
  for (const k of Object.keys(out) as (keyof SiteRule)[]) if (out[k] === undefined) delete out[k];
  return out;
}
