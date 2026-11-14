import { useEffect, useState } from 'react';
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
    if (settings.providers.length <= 1 || !confirm(t('providerDeleteConfirm'))) return;
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
    <div>
      <p className="intro">{t('providersIntro')}</p>
      <div className="profiles">
        {settings.providers.map((p) => (
          <button
            key={p.id}
            className={`profile-chip ${p.id === selected.id ? 'sel' : ''}`}
            onClick={() => setSelectedId(p.id)}
          >
            {p.name || getPreset(p.presetId).name}
            {p.id === settings.activeProviderId && (
              <span className="badge">{t('providerActive')}</span>
            )}
          </button>
        ))}
        <button className="btn small" onClick={() => void add()}>
          + {t('providerAdd')}
        </button>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="preset">{t('providerPreset')}</label>
          <select id="preset" value={draft.presetId} onChange={(e) => changePreset(e.target.value)}>
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {preset.hintKey && <div className="hint">{t(preset.hintKey as 'hintQwen')}</div>}
        </div>
        <div className="field">
          <label htmlFor="pname">{t('providerName')}</label>
          <input
            id="pname"
            type="text"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="baseurl">{t('providerBaseURL')}</label>
          <input
            id="baseurl"
            type="url"
            value={draft.baseURL}
            placeholder={preset.baseURL || 'https://…/v1'}
            onChange={(e) => patch({ baseURL: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="apikey">
            {t('providerKey')}{' '}
            {!preset.keyRequired && (
              <span className="muted small">({t('providerKeyOptional')})</span>
            )}
          </label>
          <div className="inline">
            <input
              id="apikey"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={draft.apiKey}
              onChange={(e) => patch({ apiKey: e.target.value.trim() })}
            />
            <button className="btn small" onClick={() => setShowKey((v) => !v)}>
              {showKey ? t('providerHideKey') : t('providerShowKey')}
            </button>
            {preset.keyURL && (
              <a className="link small" href={preset.keyURL} target="_blank" rel="noreferrer">
                {t('providerKeyGet')} ↗
              </a>
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor="model">{t('providerModel')}</label>
          <div className="inline">
            <input
              id="model"
              type="text"
              list="model-list"
              value={draft.model}
              placeholder={preset.modelPlaceholder}
              spellCheck={false}
              onChange={(e) => patch({ model: e.target.value.trim() })}
            />
            <datalist id="model-list">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button
              className="btn small"
              disabled={modelsStatus.kind === 'busy'}
              onClick={() => void fetchModels()}
            >
              {t('providerFetchModels')}
            </button>
          </div>
          {modelsStatus.kind === 'ok' && <div className="hint ok">{modelsStatus.text}</div>}
          {modelsStatus.kind === 'err' && <div className="hint err">{modelsStatus.text}</div>}
        </div>
        <div className="field">
          <label htmlFor="temp">{t('providerTemperature')}</label>
          <input
            id="temp"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={draft.temperature ?? ''}
            onChange={(e) =>
              patch({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          />
          <div className="hint">{t('providerTemperatureHint')}</div>
        </div>

        <div className="actions">
          <button className="btn primary" disabled={!dirty} onClick={() => void save()}>
            {dirty ? t('save') : t('saved')}
          </button>
          <button className="btn" disabled={status.kind === 'busy'} onClick={() => void test()}>
            {status.kind === 'busy' ? t('providerTesting') : t('providerTest')}
          </button>
          {draft.id !== settings.activeProviderId && (
            <button
              className="btn"
              onClick={() =>
                void update((s) => {
                  s.providers = s.providers.map((p) => (p.id === draft.id ? draft : p));
                  s.activeProviderId = draft.id;
                })
              }
            >
              {t('providerUse')}
            </button>
          )}
          {settings.providers.length > 1 && (
            <button className="btn danger" onClick={() => void remove()}>
              {t('delete')}
            </button>
          )}
        </div>
        {status.kind === 'ok' && <div className="result ok">{status.text}</div>}
        {status.kind === 'err' && <div className="result err">{status.text}</div>}
      </div>

      <h3>{t('batchTitle')}</h3>
      <NumberField
        label={t('batchMaxChars')}
        value={settings.batch.maxChars}
        min={200}
        max={20000}
        step={100}
        onChange={(v) => void update((s) => void (s.batch.maxChars = v))}
      />
      <NumberField
        label={t('batchMaxSegments')}
        value={settings.batch.maxSegments}
        min={1}
        max={100}
        onChange={(v) => void update((s) => void (s.batch.maxSegments = v))}
      />
      <NumberField
        label={t('batchConcurrency')}
        value={settings.batch.concurrency}
        min={1}
        max={20}
        onChange={(v) => void update((s) => void (s.batch.concurrency = v))}
      />
    </div>
  );
}

function NumberField(props: {
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
    <div className="field">
      <label>{props.label}</label>
      <input
        type="number"
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
    </div>
  );
}
