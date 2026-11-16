import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import AiNetworkIcon from '@hugeicons/core-free-icons/AiNetworkIcon';
import CursorTextIcon from '@hugeicons/core-free-icons/CursorTextIcon';
import Database01Icon from '@hugeicons/core-free-icons/Database01Icon';
import InformationCircleIcon from '@hugeicons/core-free-icons/InformationCircleIcon';
import KeyboardIcon from '@hugeicons/core-free-icons/KeyboardIcon';
import LanguageSquareIcon from '@hugeicons/core-free-icons/LanguageSquareIcon';
import PaintBrush04Icon from '@hugeicons/core-free-icons/PaintBrush04Icon';
import WebDesign01Icon from '@hugeicons/core-free-icons/WebDesign01Icon';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toast';
import { createT, resolveUiLang, type MessageKey } from '@/lib/i18n';
import { AppTheme } from '@/components/app/app-theme';
import { Logo } from '@/components/app/logo';
import { useSettings } from '@/hooks/use-settings';
import { ProvidersSection } from './sections/Providers';
import { TranslationSection } from './sections/Translation';
import { DisplaySection, SelectionSection } from './sections/Display';
import { SitesSection } from './sections/Sites';
import { AboutSection, DataSection, ShortcutsSection } from './sections/Misc';
import type { SectionProps } from './sections/types';

const SECTIONS: {
  id: string;
  key: MessageKey;
  icon: IconSvgElement;
  Component: (p: SectionProps) => React.ReactNode;
}[] = [
  { id: 'providers', key: 'navProviders', icon: AiNetworkIcon, Component: ProvidersSection },
  {
    id: 'translation',
    key: 'navTranslation',
    icon: LanguageSquareIcon,
    Component: TranslationSection,
  },
  { id: 'display', key: 'navDisplay', icon: PaintBrush04Icon, Component: DisplaySection },
  { id: 'selection', key: 'navSelection', icon: CursorTextIcon, Component: SelectionSection },
  { id: 'sites', key: 'navSites', icon: WebDesign01Icon, Component: SitesSection },
  { id: 'shortcuts', key: 'navShortcuts', icon: KeyboardIcon, Component: ShortcutsSection },
  { id: 'data', key: 'navData', icon: Database01Icon, Component: DataSection },
  { id: 'about', key: 'navAbout', icon: InformationCircleIcon, Component: AboutSection },
];

function currentHash(): string {
  const h = location.hash.replace(/^#/, '');
  return SECTIONS.some((s) => s.id === h) ? h : 'providers';
}

export default function App() {
  return (
    <AppTheme className="min-h-svh">
      <Toaster>
        <Options />
      </Toaster>
    </AppTheme>
  );
}

function Options() {
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
    <SidebarProvider>
      <Sidebar collapsible="none" className="sticky top-0 h-svh border-r">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5 text-base font-semibold">
            <Logo size={24} />
            {t('appName')}
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {SECTIONS.map((s) => (
                  <SidebarMenuItem key={s.id}>
                    <SidebarMenuButton isActive={s.id === section} render={<a href={`#${s.id}`} />}>
                      <HugeiconsIcon icon={s.icon} />
                      <span>{t(s.key)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <p className="m-0 px-2 text-xs text-muted-foreground">
            v{browser.runtime.getManifest().version}
          </p>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 pt-8 pb-16">
          <h1 className="m-0 text-2xl font-semibold">{t(active.key)}</h1>
          <Component settings={settings} update={update} t={t} />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
