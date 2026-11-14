import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Choice } from '@/components/app/choice';
import { SettingsCard } from '@/components/app/settings-card';
import { SimpleSelect } from '@/components/app/simple-select';
import type { MessageKey } from '@/lib/i18n';
import {
  HOVER_MODIFIERS,
  type DisplayMode,
  type HoverModifier,
  type TranslationTheme,
  type UiLang,
} from '@/lib/settings/schema';
import type { SectionProps } from './types';

const THEMES: TranslationTheme[] = [
  'none',
  'dimmed',
  'underline',
  'background',
  'border',
  'italic',
];

const PREVIEW_STYLE: Record<TranslationTheme, React.CSSProperties> = {
  none: {},
  dimmed: { opacity: 0.78 },
  underline: {
    textDecoration: 'underline dashed rgba(120,120,120,.6)',
    textUnderlineOffset: '0.25em',
  },
  background: { background: 'rgba(255,214,10,.18)' },
  border: {
    borderInlineStart: '3px solid rgba(59,130,246,.55)',
    paddingInlineStart: '0.6em',
    display: 'block',
  },
  italic: { fontStyle: 'italic' },
};

export function DisplaySection({ settings, update, t }: SectionProps) {
  const only = settings.displayMode === 'translation-only';
  return (
    <>
      <SettingsCard>
        <Field orientation="horizontal">
          <FieldLabel>{t('displayMode')}</FieldLabel>
          <Choice<DisplayMode>
            label={t('displayMode')}
            value={settings.displayMode}
            options={[
              { value: 'bilingual', label: t('displayBilingual') },
              { value: 'translation-only', label: t('displayTranslationOnly') },
            ]}
            onChange={(m) => void update((s) => void (s.displayMode = m))}
          />
        </Field>
        <Field>
          <FieldLabel>{t('displayTheme')}</FieldLabel>
          <RadioGroup
            value={settings.theme}
            onValueChange={(v) => void update((s) => void (s.theme = v as TranslationTheme))}
            className="grid-cols-2 sm:grid-cols-3"
          >
            {THEMES.map((th) => (
              <Field key={th} orientation="horizontal">
                <RadioGroupItem value={th} id={`theme-${th}`} />
                <FieldLabel htmlFor={`theme-${th}`} className="font-normal">
                  {t(`theme_${th}` as MessageKey)}
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
        </Field>
      </SettingsCard>

      <SettingsCard title={t('preview')}>
        <div className="rounded-lg bg-muted p-4 text-base leading-relaxed">
          {!only && <p className="m-0">{t('previewSource')}</p>}
          <p className="m-0 mt-1.5">
            <span style={only ? {} : PREVIEW_STYLE[settings.theme]}>{t('previewTranslation')}</span>
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title={t('uiLang')}>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="ui-lang">{t('uiLang')}</FieldLabel>
          <SimpleSelect
            id="ui-lang"
            value={settings.uiLang}
            options={[
              { value: 'auto', label: t('uiLangAuto') },
              { value: 'zh', label: '简体中文' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(v) => void update((s) => void (s.uiLang = v as UiLang))}
          />
        </Field>
      </SettingsCard>
    </>
  );
}

const HOVER_LABEL: Record<HoverModifier, MessageKey> = {
  off: 'hoverOff',
  ctrl: 'hoverCtrl',
  alt: 'hoverAlt',
  shift: 'hoverShift',
};

export function SelectionSection({ settings, update, t }: SectionProps) {
  return (
    <>
      <SettingsCard title={t('popupSelection')} description={t('selectionHint')}>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="sel-enabled">{t('selectionEnabled')}</FieldLabel>
          <Switch
            id="sel-enabled"
            checked={settings.selection.enabled}
            onCheckedChange={(on) => void update((s) => void (s.selection.enabled = on))}
          />
        </Field>
        <Field>
          <FieldLabel>{t('selectionTrigger')}</FieldLabel>
          <RadioGroup
            value={settings.selection.trigger}
            onValueChange={(v) =>
              void update((s) => void (s.selection.trigger = v === 'auto' ? 'auto' : 'icon'))
            }
          >
            {(['icon', 'auto'] as const).map((v) => (
              <Field key={v} orientation="horizontal">
                <RadioGroupItem value={v} id={`trigger-${v}`} />
                <FieldLabel htmlFor={`trigger-${v}`} className="font-normal">
                  {v === 'icon' ? t('selectionTriggerIcon') : t('selectionTriggerAuto')}
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
        </Field>
      </SettingsCard>

      <SettingsCard title={t('hoverTitle')}>
        <Field>
          <FieldContent>
            <FieldLabel>{t('hoverModifier')}</FieldLabel>
            <FieldDescription>{t('hoverHint')}</FieldDescription>
          </FieldContent>
          <Choice<HoverModifier>
            label={t('hoverModifier')}
            value={settings.hover.modifier}
            options={HOVER_MODIFIERS.map((m) => ({ value: m, label: t(HOVER_LABEL[m]) }))}
            onChange={(m) => void update((s) => void (s.hover.modifier = m))}
          />
        </Field>
      </SettingsCard>
    </>
  );
}
