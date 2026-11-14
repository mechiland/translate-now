import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { SettingsCard } from '@/components/app/settings-card';
import { SimpleSelect } from '@/components/app/simple-select';
import type { MessageKey } from '@/lib/i18n';
import { LANGUAGES, sameLanguage } from '@/lib/languages';
import type { GlossaryEntry, TranslationStyle } from '@/lib/settings/schema';
import { BUILTIN_STYLES } from '@/lib/settings/styles';
import type { SectionProps } from './types';

export function TranslationSection({ settings, update, t }: SectionProps) {
  return (
    <>
      <SettingsCard>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="target">{t('targetLang')}</FieldLabel>
          <SimpleSelect
            id="target"
            value={settings.targetLang}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
            onChange={(v) => void update((s) => void (s.targetLang = v))}
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="auto-foreign">{t('autoForeign')}</FieldLabel>
            <FieldDescription>{t('autoForeignHint')}</FieldDescription>
          </FieldContent>
          <Switch
            id="auto-foreign"
            checked={settings.autoTranslateForeign}
            onCheckedChange={(on) => void update((s) => void (s.autoTranslateForeign = on))}
          />
        </Field>
      </SettingsCard>

      <SettingsCard title={t('neverLangs')} description={t('neverLangsHint')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {LANGUAGES.filter((l) => !sameLanguage(l.code, settings.targetLang)).map((l) => (
            <Field key={l.code} orientation="horizontal">
              <Checkbox
                id={`never-${l.code}`}
                checked={settings.neverTranslateLangs.includes(l.code)}
                onCheckedChange={(on) =>
                  void update((s) => {
                    s.neverTranslateLangs = on
                      ? [...s.neverTranslateLangs, l.code]
                      : s.neverTranslateLangs.filter((c) => c !== l.code);
                  })
                }
              />
              <FieldLabel htmlFor={`never-${l.code}`} className="font-normal">
                {l.name}
              </FieldLabel>
            </Field>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('styleTitle')}
        action={
          <Button
            variant="ghost"
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
            <HugeiconsIcon icon={Add01Icon} />
            {t('styleAdd')}
          </Button>
        }
      >
        <RadioGroup
          value={settings.styleId}
          onValueChange={(v) => void update((s) => void (s.styleId = String(v)))}
          className="gap-4"
        >
          {BUILTIN_STYLES.map((st) => (
            <Field key={st.id} orientation="horizontal">
              <RadioGroupItem value={st.id} id={`style-${st.id}`} />
              <FieldContent>
                <FieldLabel htmlFor={`style-${st.id}`}>
                  {t(`style_${st.id}` as MessageKey)}
                </FieldLabel>
                <FieldDescription>{st.instruction}</FieldDescription>
              </FieldContent>
            </Field>
          ))}
          {settings.customStyles.map((st) => (
            <CustomStyleRow
              key={st.id}
              style={st}
              t={t}
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
        </RadioGroup>
      </SettingsCard>

      <SettingsCard title={t('glossaryTitle')} description={t('glossaryHint')}>
        <Glossary
          entries={settings.glossary}
          t={t}
          onChange={(g) => void update((s) => void (s.glossary = g))}
        />
      </SettingsCard>
    </>
  );
}

function CustomStyleRow(props: {
  style: TranslationStyle;
  t: SectionProps['t'];
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
    <Field orientation="horizontal">
      <RadioGroupItem value={style.id} aria-label={name} />
      <FieldContent className="gap-2">
        <FieldTitle className="w-full">
          <Input
            value={name}
            aria-label={t('styleName')}
            placeholder={t('styleName')}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
          />
          <Button
            variant="ghost"
            size="icon"
            color="red"
            aria-label={t('delete')}
            title={t('delete')}
            onClick={props.onDelete}
          >
            <HugeiconsIcon icon={Delete02Icon} />
          </Button>
        </FieldTitle>
        <Textarea
          rows={2}
          value={instruction}
          aria-label={t('styleInstructionPlaceholder')}
          placeholder={t('styleInstructionPlaceholder')}
          onChange={(e) => setInstruction(e.target.value)}
          onBlur={commit}
        />
      </FieldContent>
    </Field>
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
  const edit = (i: number, patch: Partial<GlossaryEntry>) =>
    setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="flex flex-col gap-3">
      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('glossarySource')}</TableHead>
              <TableHead>{t('glossaryTarget')}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Input
                    value={r.source}
                    aria-label={t('glossarySource')}
                    onChange={(e) => edit(i, { source: e.target.value })}
                    onBlur={() => commit(rows)}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={r.target}
                    aria-label={t('glossaryTarget')}
                    onChange={(e) => edit(i, { target: e.target.value })}
                    onBlur={() => commit(rows)}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    color="red"
                    aria-label={t('delete')}
                    title={t('delete')}
                    onClick={() => commit(rows.filter((_, j) => j !== i))}
                  >
                    <HugeiconsIcon icon={Delete02Icon} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div>
        <Button variant="soft" onClick={() => setRows([...rows, { source: '', target: '' }])}>
          <HugeiconsIcon icon={Add01Icon} />
          {t('add')}
        </Button>
      </div>
    </div>
  );
}
