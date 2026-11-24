import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon';
import AlertCircleIcon from '@hugeicons/core-free-icons/AlertCircleIcon';
import LinkSquare02Icon from '@hugeicons/core-free-icons/LinkSquare02Icon';
import ViewIcon from '@hugeicons/core-free-icons/ViewIcon';
import ViewOffIcon from '@hugeicons/core-free-icons/ViewOffIcon';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Choice } from '@/components/app/choice';
import { ConfirmButton } from '@/components/app/confirm-button';
import { SettingsCard } from '@/components/app/settings-card';
import { SimpleSelect } from '@/components/app/simple-select';
import { errorText } from '@/lib/i18n';
import { sendToBackground } from '@/lib/messaging';
import { PROVIDER_PRESETS, getPreset } from '@/lib/providers/presets';
import type { ProviderProfile } from '@/lib/settings/schema';
import type { SectionProps } from './types';

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; text: string }
  | { kind: 'err'; text: string };

function StatusAlert({ status, testId }: { status: Status; testId: string }) {
  if (status.kind !== 'ok' && status.kind !== 'err') return null;
  return (
    <Alert
      data-testid={testId}
      data-status={status.kind}
      color={status.kind === 'ok' ? 'green' : 'red'}
    >
      <HugeiconsIcon icon={status.kind === 'ok' ? CheckmarkCircle02Icon : AlertCircleIcon} />
      <AlertDescription className="break-all">{status.text}</AlertDescription>
    </Alert>
  );
}

export function ProvidersSection({ settings, update, t }: SectionProps) {
  const [selectedId, setSelectedId] = useState(settings.activeProviderId);
  const selected = settings.providers.find((p) => p.id === selectedId) ?? settings.providers[0]!;
  const [draft, setDraft] = useState<ProviderProfile>(selected);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [modelsStatus, setModelsStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    setDraft(selected);
    setModels([]);
    setStatus({ kind: 'idle' });
    setModelsStatus({ kind: 'idle' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.id]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(selected);
  const preset = getPreset(draft.presetId);

  const patch = (p: Partial<ProviderProfile>) => setDraft((d) => ({ ...d, ...p }));

  const changePreset = (presetId: string) => {
    const next = getPreset(presetId);
    const oldPreset = getPreset(draft.presetId);
    patch({
      presetId,
      protocol: next.protocol,
      baseURL: next.baseURL || draft.baseURL,
      name: !draft.name || draft.name === oldPreset.name ? next.name : draft.name,
    });
  };

  const save = () =>
    update((s) => {
      s.providers = s.providers.map((p) => (p.id === draft.id ? draft : p));
    });

  const add = async () => {
    const preset = PROVIDER_PRESETS[0]!;
    const profile: ProviderProfile = {
      id: newId(),
      name: preset.name,
      presetId: preset.id,
      protocol: preset.protocol,
      baseURL: preset.baseURL,
      apiKey: '',
      model: '',
    };
    await update((s) => void s.providers.push(profile));
    setSelectedId(profile.id);
  };

  const remove = async () => {
    if (settings.providers.length <= 1) return;
    await update((s) => {
      s.providers = s.providers.filter((p) => p.id !== draft.id);
      if (s.activeProviderId === draft.id) s.activeProviderId = s.providers[0]!.id;
    });
    setSelectedId(settings.providers.find((p) => p.id !== draft.id)!.id);
  };

  const test = async () => {
    setStatus({ kind: 'busy' });
    const res = await sendToBackground({ type: 'provider:test', profile: draft });
    setStatus(
      res.ok
        ? { kind: 'ok', text: t('providerTestOk', res.ms, res.sample) }
        : { kind: 'err', text: `${errorText(t, res.error.kind)} — ${res.error.message}` },
    );
  };

  const fetchModels = async () => {
    setModelsStatus({ kind: 'busy' });
    const res = await sendToBackground({ type: 'provider:models', profile: draft });
    if (res.ok) {
      setModels(res.models);
      setModelsStatus({ kind: 'ok', text: t('providerModelsFetched', res.models.length) });
    } else {
      setModelsStatus({
        kind: 'err',
        text: `${errorText(t, res.error.kind)} — ${res.error.message}`,
      });
    }
  };

  return (
    <>
      <p className="m-0 text-sm text-muted-foreground">{t('providersIntro')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Choice
          label={t('navProviders')}
          className="flex-wrap"
          value={selected.id}
          onChange={setSelectedId}
          options={settings.providers.map((p) => ({
            value: p.id,
            label: (
              <>
                {p.name || getPreset(p.presetId).name}
                {p.id === settings.activeProviderId && (
                  <Badge variant="soft">{t('providerActive')}</Badge>
                )}
              </>
            ),
          }))}
        />
        <Button variant="ghost" onClick={() => void add()}>
          <HugeiconsIcon icon={Add01Icon} />
          {t('providerAdd')}
        </Button>
      </div>

      <SettingsCard>
        <Field>
          <FieldLabel htmlFor="preset">{t('providerPreset')}</FieldLabel>
          <SimpleSelect
            id="preset"
            className="w-full"
            value={draft.presetId}
            options={PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
            onChange={changePreset}
          />
          {preset.hintKey && <FieldDescription>{t(preset.hintKey as 'hintQwen')}</FieldDescription>}
        </Field>
        <Field>
          <FieldLabel htmlFor="pname">{t('providerName')}</FieldLabel>
          <Input id="pname" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="baseurl">{t('providerBaseURL')}</FieldLabel>
          <Input
            id="baseurl"
            type="url"
            value={draft.baseURL}
            placeholder={preset.baseURL || 'https://…/v1'}
            onChange={(e) => patch({ baseURL: e.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="apikey">
            {t('providerKey')}
            {!preset.keyRequired && (
              <span className="font-normal text-muted-foreground">
                ({t('providerKeyOptional')})
              </span>
            )}
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="apikey"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={draft.apiKey}
              onChange={(e) => patch({ apiKey: e.target.value.trim() })}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={showKey ? t('providerHideKey') : t('providerShowKey')}
                title={showKey ? t('providerHideKey') : t('providerShowKey')}
                onClick={() => setShowKey((v) => !v)}
              >
                <HugeiconsIcon icon={showKey ? ViewOffIcon : ViewIcon} />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {preset.keyURL && (
            <FieldDescription>
              <a
                href={preset.keyURL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1"
              >
                {t('providerKeyGet')}
                <HugeiconsIcon icon={LinkSquare02Icon} size={14} />
              </a>
            </FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="model">{t('providerModel')}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="model"
              value={draft.model}
              placeholder={preset.modelPlaceholder}
              spellCheck={false}
              onChange={(e) => patch({ model: e.target.value.trim() })}
            />
            <Button
              variant="soft"
              loading={modelsStatus.kind === 'busy'}
              onClick={() => void fetchModels()}
            >
              {t('providerFetchModels')}
            </Button>
          </div>
          {models.length > 0 && (
            <SimpleSelect
              label={t('providerModel')}
              className="w-full"
              value={models.includes(draft.model) ? draft.model : ''}
              options={[
                ...(models.includes(draft.model) ? [] : [{ value: '', label: '—' }]),
                ...models.map((m) => ({ value: m, label: m })),
              ]}
              onChange={(m) => m && patch({ model: m })}
            />
          )}
          <StatusAlert status={modelsStatus} testId="models-status" />
        </Field>
        <Field>
          <FieldLabel htmlFor="temp">{t('providerTemperature')}</FieldLabel>
          <div>
            <Input
              id="temp"
              type="number"
              min={0}
              max={2}
              step={0.1}
              className="w-32"
              value={draft.temperature ?? ''}
              onChange={(e) =>
                patch({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </div>
          <FieldDescription>{t('providerTemperatureHint')}</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="allow-thinking">{t('providerAllowThinking')}</FieldLabel>
            <FieldDescription>{t('providerAllowThinkingHint')}</FieldDescription>
          </FieldContent>
          <Switch
            id="allow-thinking"
            checked={draft.allowThinking ?? false}
            onCheckedChange={(on) => patch({ allowThinking: on || undefined })}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button disabled={!dirty} onClick={() => void save()}>
            {dirty ? t('save') : t('saved')}
          </Button>
          <Button variant="soft" loading={status.kind === 'busy'} onClick={() => void test()}>
            {t('providerTest')}
          </Button>
          {draft.id !== settings.activeProviderId && (
            <Button
              variant="soft"
              onClick={() =>
                void update((s) => {
                  s.providers = s.providers.map((p) => (p.id === draft.id ? draft : p));
                  s.activeProviderId = draft.id;
                })
              }
            >
              {t('providerUse')}
            </Button>
          )}
          {settings.providers.length > 1 && (
            <ConfirmButton
              title={t('providerDeleteConfirm')}
              confirmLabel={t('delete')}
              cancelLabel={t('cancel')}
              onConfirm={() => void remove()}
            >
              {t('delete')}
            </ConfirmButton>
          )}
        </div>
        <StatusAlert status={status} testId="test-status" />
      </SettingsCard>

      <SettingsCard title={t('batchTitle')}>
        <NumberField
          id="max-chars"
          label={t('batchMaxChars')}
          value={settings.batch.maxChars}
          min={200}
          max={20000}
          step={100}
          onChange={(v) => void update((s) => void (s.batch.maxChars = v))}
        />
        <NumberField
          id="max-segments"
          label={t('batchMaxSegments')}
          value={settings.batch.maxSegments}
          min={1}
          max={100}
          onChange={(v) => void update((s) => void (s.batch.maxSegments = v))}
        />
        <NumberField
          id="concurrency"
          label={t('batchConcurrency')}
          value={settings.batch.concurrency}
          min={1}
          max={20}
          onChange={(v) => void update((s) => void (s.batch.concurrency = v))}
        />
      </SettingsCard>
    </>
  );
}

function NumberField(props: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Input
        id={props.id}
        type="number"
        className="w-32"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          if (Number.isFinite(n) && n >= props.min && n <= props.max) props.onChange(Math.round(n));
          else setText(String(props.value));
        }}
      />
    </Field>
  );
}
