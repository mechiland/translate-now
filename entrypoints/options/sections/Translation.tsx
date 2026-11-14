import { useEffect, useState } from 'react';
import type { MessageKey } from '@/lib/i18n';
import { LANGUAGES, sameLanguage } from '@/lib/languages';
import type { GlossaryEntry, TranslationStyle } from '@/lib/settings/schema';
import { BUILTIN_STYLES } from '@/lib/settings/styles';
import type { SectionProps } from './types';

export function TranslationSection({ settings, update, t }: SectionProps) {
  return (
    <div>
      <div className="field">
        <label htmlFor="target">{t('targetLang')}</label>
        <select
          id="target"
          value={settings.targetLang}
          onChange={(e) => void update((s) => void (s.targetLang = e.target.value))}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="label">{t('autoForeign')}</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.autoTranslateForeign}
            onChange={(e) => void update((s) => void (s.autoTranslateForeign = e.target.checked))}
          />
          {settings.autoTranslateForeign ? t('on') : t('off')}
        </label>
        <div className="hint">{t('autoForeignHint')}</div>
      </div>

      <h3>{t('neverLangs')}</h3>
      <p className="intro small">{t('neverLangsHint')}</p>
      <div className="langs">
        {LANGUAGES.filter((l) => !sameLanguage(l.code, settings.targetLang)).map((l) => (
          <label key={l.code} className="switch">
            <input
              type="checkbox"
              checked={settings.neverTranslateLangs.includes(l.code)}
              onChange={(e) =>
                void update((s) => {
                  s.neverTranslateLangs = e.target.checked
                    ? [...s.neverTranslateLangs, l.code]
                    : s.neverTranslateLangs.filter((c) => c !== l.code);
                })
              }
            />
            {l.name}
          </label>
        ))}
      </div>

      <h3>{t('styleTitle')}</h3>
      <div className="styles" role="radiogroup">
        {BUILTIN_STYLES.map((st) => (
          <label key={st.id} className="style-item">
            <input
              type="radio"
              name="style"
              checked={settings.styleId === st.id}
              onChange={() => void update((s) => void (s.styleId = st.id))}
            />
            <div>
              <div>{t(`style_${st.id}` as MessageKey)}</div>
              <div className="desc">{st.instruction}</div>
            </div>
          </label>
        ))}
        {settings.customStyles.map((st) => (
          <CustomStyleRow
            key={st.id}
            style={st}
            selected={settings.styleId === st.id}
            t={t}
            onSelect={() => void update((s) => void (s.styleId = st.id))}
            onChange={(next) =>
              void update((s) => {
                s.customStyles = s.customStyles.map((c) => (c.id === st.id ? next : c));
              })
            }
            onDelete={() =>
              void update((s) => {
                s.customStyles = s.customStyles.filter((c) => c.id !== st.id);
                if (s.styleId === st.id) s.styleId = 'standard';
                s.siteRules = s.siteRules.map((r) =>
                  r.styleId === st.id ? { ...r, styleId: undefined } : r,
                );
              })
            }
          />
        ))}
      </div>
      <div className="actions">
        <button
          className="btn"
          onClick={() =>
            void update((s) => {
              s.customStyles.push({
                id: `custom-${Math.random().toString(36).slice(2, 8)}`,
                name: `${t('styleCustom')} ${s.customStyles.length + 1}`,
                instruction: '',
              });
            })
          }
        >
          + {t('styleAdd')}
        </button>
      </div>

      <h3>{t('glossaryTitle')}</h3>
      <p className="intro small">{t('glossaryHint')}</p>
      <Glossary
        entries={settings.glossary}
        t={t}
        onChange={(g) => void update((s) => void (s.glossary = g))}
      />
    </div>
  );
}

function CustomStyleRow(props: {
  style: TranslationStyle;
  selected: boolean;
  t: SectionProps['t'];
  onSelect: () => void;
  onChange: (s: TranslationStyle) => void;
  onDelete: () => void;
}) {
  const { style, t } = props;
  const [name, setName] = useState(style.name);
  const [instruction, setInstruction] = useState(style.instruction);
  useEffect(() => {
    setName(style.name);
    setInstruction(style.instruction);
  }, [style.name, style.instruction]);
  const commit = () => {
    if (name !== style.name || instruction !== style.instruction)
      props.onChange({ ...style, name, instruction });
  };
  return (
    <div className="style-item">
      <input
        type="radio"
        name="style"
        checked={props.selected}
        onChange={props.onSelect}
        aria-label={name}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="inline">
          <input
            type="text"
            value={name}
            placeholder={t('styleName')}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
          />
          <button className="btn small danger" onClick={props.onDelete}>
            {t('delete')}
          </button>
        </div>
        <textarea
          rows={2}
          value={instruction}
          placeholder={t('styleInstructionPlaceholder')}
          onChange={(e) => setInstruction(e.target.value)}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

function Glossary(props: {
  entries: GlossaryEntry[];
  t: SectionProps['t'];
  onChange: (g: GlossaryEntry[]) => void;
}) {
  const { t } = props;
  const [rows, setRows] = useState(props.entries);
  useEffect(() => setRows(props.entries), [props.entries]);
  const commit = (next: GlossaryEntry[]) => {
    const cleaned = next.filter((r) => r.source.trim() || r.target.trim());
    if (JSON.stringify(cleaned) !== JSON.stringify(props.entries)) props.onChange(cleaned);
  };
  return (
    <div>
      {rows.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>{t('glossarySource')}</th>
              <th>{t('glossaryTarget')}</th>
              <th style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="text"
                    value={r.source}
                    onChange={(e) =>
                      setRows(rows.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)))
                    }
                    onBlur={() => commit(rows)}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={r.target}
                    onChange={(e) =>
                      setRows(rows.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))
                    }
                    onBlur={() => commit(rows)}
                  />
                </td>
                <td>
                  <button
                    className="btn small danger"
                    onClick={() => commit(rows.filter((_, j) => j !== i))}
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
        <button className="btn" onClick={() => setRows([...rows, { source: '', target: '' }])}>
          + {t('add')}
        </button>
      </div>
    </div>
  );
}
