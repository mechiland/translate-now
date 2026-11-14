import type { MessageKey } from '@/lib/i18n';
import type { TranslationTheme, UiLang } from '@/lib/settings/schema';
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
    <div>
      <div className="field">
        <span className="label">{t('displayMode')}</span>
        <div className="seg">
          {(['bilingual', 'translation-only'] as const).map((m) => (
            <button
              key={m}
              className={settings.displayMode === m ? 'on' : ''}
              onClick={() => void update((s) => void (s.displayMode = m))}
            >
              {m === 'bilingual' ? t('displayBilingual') : t('displayTranslationOnly')}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">{t('displayTheme')}</span>
        <div className="radio-list">
          {THEMES.map((th) => (
            <label key={th}>
              <input
                type="radio"
                name="theme"
                checked={settings.theme === th}
                onChange={() => void update((s) => void (s.theme = th))}
              />
              {t(`theme_${th}` as MessageKey)}
            </label>
          ))}
        </div>
      </div>
      <h3>{t('preview')}</h3>
      <div className="preview">
        {!only && <p>{t('previewSource')}</p>}
        <p style={{ marginTop: only ? 0 : '0.3em' }}>
          <span style={only ? {} : PREVIEW_STYLE[settings.theme]}>{t('previewTranslation')}</span>
        </p>
      </div>
      <h3>{t('uiLang')}</h3>
      <div className="field">
        <span className="label">{t('uiLang')}</span>
        <select
          value={settings.uiLang}
          onChange={(e) => void update((s) => void (s.uiLang = e.target.value as UiLang))}
        >
          <option value="auto">{t('uiLangAuto')}</option>
          <option value="zh">简体中文</option>
          <option value="en">English</option>
        </select>
      </div>
    </div>
  );
}

export function SelectionSection({ settings, update, t }: SectionProps) {
  return (
    <div>
      <div className="field">
        <span className="label">{t('selectionEnabled')}</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.selection.enabled}
            onChange={(e) => void update((s) => void (s.selection.enabled = e.target.checked))}
          />
          {settings.selection.enabled ? t('on') : t('off')}
        </label>
      </div>
      <div className="field">
        <span className="label">{t('selectionTrigger')}</span>
        <div className="radio-list">
          <label>
            <input
              type="radio"
              name="trigger"
              checked={settings.selection.trigger === 'icon'}
              onChange={() => void update((s) => void (s.selection.trigger = 'icon'))}
            />
            {t('selectionTriggerIcon')}
          </label>
          <label>
            <input
              type="radio"
              name="trigger"
              checked={settings.selection.trigger === 'auto'}
              onChange={() => void update((s) => void (s.selection.trigger = 'auto'))}
            />
            {t('selectionTriggerAuto')}
          </label>
        </div>
      </div>
      <p className="muted">{t('selectionHint')}</p>
    </div>
  );
}
