import { useEffect, useState } from 'react';
import { createT, resolveUiLang, type MessageKey } from '@/lib/i18n';
import { Logo } from '@/lib/ui/Logo';
import { useSettings } from '@/lib/ui/useSettings';
import { ProvidersSection } from './sections/Providers';
import { TranslationSection } from './sections/Translation';
import { DisplaySection, SelectionSection } from './sections/Display';
import { SitesSection } from './sections/Sites';
import { AboutSection, DataSection, ShortcutsSection } from './sections/Misc';
import type { SectionProps } from './sections/types';

const SECTIONS: { id: string; key: MessageKey; Component: (p: SectionProps) => React.ReactNode }[] =
  [
    { id: 'providers', key: 'navProviders', Component: ProvidersSection },
    { id: 'translation', key: 'navTranslation', Component: TranslationSection },
    { id: 'display', key: 'navDisplay', Component: DisplaySection },
    { id: 'selection', key: 'navSelection', Component: SelectionSection },
    { id: 'sites', key: 'navSites', Component: SitesSection },
    { id: 'shortcuts', key: 'navShortcuts', Component: ShortcutsSection },
    { id: 'data', key: 'navData', Component: DataSection },
    { id: 'about', key: 'navAbout', Component: AboutSection },
  ];

function currentHash(): string {
  const h = location.hash.replace(/^#/, '');
  return SECTIONS.some((s) => s.id === h) ? h : 'providers';
}

export default function App() {
  const [settings, update] = useSettings();
  const [section, setSection] = useState(currentHash);

  useEffect(() => {
    const onHash = () => setSection(currentHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const uiLang = settings?.uiLang;
  useEffect(() => {
    if (uiLang) document.documentElement.lang = resolveUiLang(uiLang) === 'zh' ? 'zh-CN' : 'en';
  }, [uiLang]);

  if (!settings) return null;
  const t = createT(settings.uiLang);
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;
  const Component = active.Component;

  return (
    <div className="layout">
      <aside className="side">
        <div className="brand">
          <Logo size={24} />
          {t('appName')}
        </div>
        <nav>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={s.id === section ? 'on' : ''}>
              {t(s.key)}
            </a>
          ))}
        </nav>
      </aside>
      <main className="content">
        <h2>{t(active.key)}</h2>
        <Component settings={settings} update={update} t={t} />
      </main>
    </div>
  );
}
