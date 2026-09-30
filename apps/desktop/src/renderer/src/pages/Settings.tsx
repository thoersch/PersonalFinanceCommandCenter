import { FormEvent, useEffect, useState } from 'react';
import type {
  AiProviderCatalogEntry,
  AppSettingsDto,
  ProviderConfigDto,
  RoleAssignmentDto,
  SourceCatalogEntry,
  SourceConfigDto,
} from '@ff/shared';
import { DEFAULT_SUBREDDITS } from '@ff/shared';
import { api, getConfig, saveConfig, useAppSettings, useCatalog, useMutations, useProviders, useRoles, useSources } from '../lib/api';
import { ago } from '../lib/format';
import { ExtLink, Icon, QueryState, Seg, Toggle, useToast } from '../components/ui';

type Tab = 'models' | 'sources' | 'automation' | 'connection';

export function Settings() {
  const [tab, setTab] = useState<Tab>('models');
  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Sources &amp; models</h1>
          <div className="sub">Everything here is saved to the database and picked up by the agent on its next run.</div>
        </div>
        <div className="grow" />
        <Seg
          label="Settings section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'models', label: 'AI models' },
            { value: 'sources', label: 'Data sources' },
            { value: 'automation', label: 'Automation' },
            { value: 'connection', label: 'Connection' },
          ]}
        />
      </header>
      {tab === 'models' && <ModelsTab />}
      {tab === 'sources' && <SourcesTab />}
      {tab === 'automation' && <AutomationTab />}
      {tab === 'connection' && (
        <section className="panel panel-pad" style={{ maxWidth: 560 }}>
          <ConnectionForm />
        </section>
      )}
    </main>
  );
}

// ======================= AI models =======================

function ModelsTab() {
  const catalog = useCatalog();
  const providers = useProviders();
  const roles = useRoles();
  return (
    <QueryState q={{ isLoading: catalog.isLoading || providers.isLoading || roles.isLoading, error: catalog.error || providers.error || roles.error }}>
      {catalog.data && providers.data && roles.data && (
        <div className="stack">
          <section className="panel">
            <div className="panel-head bordered">
              <h2>Role assignments</h2>
              <span className="hint">Pick which provider and model does each kind of work. Prices are used for the daily budget.</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {catalog.data.roles.map((r) => (
                <RoleRow key={r.id} role={r} value={roles.data!.find((x) => x.role === r.id)!} providers={providers.data!} />
              ))}
            </div>
          </section>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16, alignItems: 'start' }}>
            {catalog.data.providers.map((c) => (
              <ProviderCard key={c.id} cat={c} cfg={providers.data!.find((p) => p.id === c.id)!} />
            ))}
          </div>
        </div>
      )}
    </QueryState>
  );
}

function RoleRow({ role, value, providers }: { role: { id: string; name: string; description: string }; value: RoleAssignmentDto; providers: ProviderConfigDto[] }) {
  const { updateRole } = useMutations();
  const toast = useToast();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const models = providers.find((p) => p.id === v.providerId)?.models ?? [];
  const dirty = JSON.stringify(v) !== JSON.stringify(value);
  const listId = `models-${role.id}`;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 180px minmax(200px,1fr) 110px 110px 90px', gap: 12, alignItems: 'end', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
      <div>
        <div style={{ fontWeight: 600 }}>{role.name}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {role.description}
        </div>
      </div>
      <label className="field">
        Provider
        <select className="select input" value={v.providerId ?? ''} onChange={(e) => setV({ ...v, providerId: e.target.value || null, model: null })}>
          <option value="">— none —</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.enabled}>
              {p.name}
              {!p.enabled ? ' (disabled)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Model
        <input className="input mono" list={listId} placeholder={models.length ? 'Choose or type a model id' : 'Type a model id (test the provider to list models)'} value={v.model ?? ''} onChange={(e) => setV({ ...v, model: e.target.value || null })} />
        <datalist id={listId}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="field">
        $ / M input
        <input className="input mono" type="number" min="0" step="any" value={v.inputPricePerMTok ?? ''} onChange={(e) => setV({ ...v, inputPricePerMTok: e.target.value === '' ? null : Number(e.target.value) })} />
      </label>
      <label className="field">
        $ / M output
        <input className="input mono" type="number" min="0" step="any" value={v.outputPricePerMTok ?? ''} onChange={(e) => setV({ ...v, outputPricePerMTok: e.target.value === '' ? null : Number(e.target.value) })} />
      </label>
      <button className="btn primary" type="button" disabled={!dirty || updateRole.isPending} onClick={() => updateRole.mutate(v, { onSuccess: () => toast(`${role.name} saved`) })}>
        Save
      </button>
    </div>
  );
}

function ProviderCard({ cat, cfg }: { cat: AiProviderCatalogEntry; cfg: ProviderConfigDto }) {
  const { updateProvider, testProvider } = useMutations();
  const toast = useToast();
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl);
  const [adv, setAdv] = useState(false);

  const saveKey = async (e: FormEvent) => {
    e.preventDefault();
    await updateProvider.mutateAsync({ id: cat.id, apiKey: key, enabled: true });
    setKey('');
    const r = await testProvider.mutateAsync(cat.id);
    toast(r.ok ? `${cat.name}: ${r.message}` : `${cat.name}: ${r.message}`, !r.ok);
  };

  return (
    <section className="panel panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-label={cat.name}>
      <div className="row-flex">
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{cat.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {cat.description}
          </div>
        </div>
        <Toggle label={`Enable ${cat.name}`} checked={cfg.enabled} onChange={(v) => updateProvider.mutate({ id: cat.id, enabled: v })} />
      </div>
      <form onSubmit={saveKey} className="row-flex" style={{ gap: 8 }}>
        <label className="sr-only" htmlFor={`key-${cat.id}`}>
          {cat.name} API key
        </label>
        <input
          id={`key-${cat.id}`}
          className="input mono grow"
          type="password"
          autoComplete="off"
          placeholder={cfg.hasApiKey ? `Saved: ${cfg.apiKeyPreview}` : cat.keyRequired ? 'Paste API key' : 'No key needed'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!key || updateProvider.isPending}>
          Save
        </button>
        <button className="btn" type="button" disabled={testProvider.isPending || (!cfg.hasApiKey && cat.keyRequired)} onClick={() => testProvider.mutate(cat.id, { onSuccess: (r) => toast(`${cat.name}: ${r.message}`, !r.ok) })}>
          Test
        </button>
      </form>
      <div className="row-flex" style={{ fontSize: 12, gap: 8 }}>
        <span className={`dot ${cfg.lastTestOk ? '' : 'off'}`} style={cfg.lastTestOk === false ? { background: 'var(--down)' } : undefined} />
        <span className="muted grow ellipsis" title={cfg.lastTestMessage ?? ''}>
          {cfg.lastTestedAt ? `${cfg.lastTestMessage} · ${ago(cfg.lastTestedAt)}` : cfg.hasApiKey ? 'Key saved, not tested' : 'Not configured'}
        </span>
        <ExtLink href={cat.docsUrl}>
          <span className="row-flex" style={{ gap: 4 }}>
            Models <Icon.external />
          </span>
        </ExtLink>
      </div>
      <div>
        <button className="btn ghost sm" type="button" onClick={() => setAdv(!adv)} aria-expanded={adv} style={{ paddingLeft: 0 }}>
          {adv ? '▾' : '▸'} Advanced
        </button>
        {adv && (
          <div className="row-flex" style={{ gap: 8, marginTop: 6 }}>
            <label className="field grow">
              Base URL
              <input className="input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </label>
            {cfg.hasApiKey && (
              <button className="btn danger sm" type="button" style={{ alignSelf: 'end' }} onClick={() => updateProvider.mutate({ id: cat.id, apiKey: null })}>
                Remove key
              </button>
            )}
            <button className="btn sm" type="button" style={{ alignSelf: 'end' }} disabled={baseUrl === cfg.baseUrl} onClick={() => updateProvider.mutate({ id: cat.id, baseUrl })}>
              Save URL
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ======================= Data sources =======================

const CATEGORY_LABEL = { SOCIAL: 'Social chatter', MARKET: 'Market data', NEWS: 'News', FILINGS: 'Filings' } as const;

function SourcesTab() {
  const catalog = useCatalog();
  const sources = useSources();
  return (
    <QueryState q={{ isLoading: catalog.isLoading || sources.isLoading, error: catalog.error || sources.error }}>
      {catalog.data && sources.data && (
        <div className="stack">
          {(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((cat) => (
            <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="label-caps">{CATEGORY_LABEL[cat]}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16, alignItems: 'start' }}>
                {catalog.data!.sources
                  .filter((s) => s.category === cat)
                  .map((s) => (
                    <SourceCard key={s.id} cat={s} cfg={sources.data!.find((x) => x.id === s.id)!} />
                  ))}
              </div>
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Market data: the first enabled source with a key (Polygon → Finnhub → Alpha Vantage) does the price syncing; the others stand by.
          </p>
        </div>
      )}
    </QueryState>
  );
}

function SourceCard({ cat, cfg }: { cat: SourceCatalogEntry; cfg: SourceConfigDto }) {
  const { updateSource, runSource } = useMutations();
  const toast = useToast();
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [interval, setIntervalMin] = useState(cfg.intervalMin);
  useEffect(() => setIntervalMin(cfg.intervalMin), [cfg.intervalMin]);

  const saveCreds = async (e: FormEvent) => {
    e.preventDefault();
    const payload = Object.fromEntries(Object.entries(creds).filter(([, v]) => v !== ''));
    await updateSource.mutateAsync({ id: cat.id, credentials: payload });
    setCreds({});
    toast(`${cat.name} credentials saved`);
  };

  return (
    <section className="panel panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-label={cat.name}>
      <div className="row-flex">
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{cat.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {cat.description}
          </div>
        </div>
        <Toggle label={`Enable ${cat.name}`} checked={cfg.enabled} onChange={(v) => updateSource.mutate({ id: cat.id, enabled: v })} />
      </div>

      {cat.credentialFields.length > 0 && (
        <form onSubmit={saveCreds} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cat.credentialFields.map((f) => (
            <label key={f.key} className="field">
              {f.label}
              <input
                className="input mono"
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={cfg.credentials[f.key]?.set ? `Saved: ${cfg.credentials[f.key].preview ?? '••••'}` : f.optional ? 'Optional' : ''}
                value={creds[f.key] ?? ''}
                onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
              />
            </label>
          ))}
          <div className="row-flex" style={{ gap: 8 }}>
            <button className="btn sm" type="submit" disabled={!Object.values(creds).some(Boolean)}>
              Save credentials
            </button>
            <ExtLink href={cat.signupUrl}>
              <span className="row-flex" style={{ gap: 4, fontSize: 12 }}>
                Get credentials <Icon.external />
              </span>
            </ExtLink>
          </div>
        </form>
      )}

      {cat.id === 'reddit' && <SubredditEditor value={(cfg.options.subreddits as string[]) ?? []} onChange={(subs) => updateSource.mutate({ id: cat.id, options: { subreddits: subs } })} />}
      {cat.id === 'sec-edgar' && (
        <FormsEditor value={(cfg.options.forms as string[]) ?? []} onChange={(forms) => updateSource.mutate({ id: cat.id, options: { forms } })} />
      )}

      <div className="row-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="row-flex muted" style={{ fontSize: 12, gap: 6 }}>
          Every
          <input className="input mono" type="number" min="1" style={{ width: 72, height: 32 }} value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))} onBlur={() => interval !== cfg.intervalMin && updateSource.mutate({ id: cat.id, intervalMin: interval })} />
          min
        </label>
        <div className="grow" />
        <button className="btn sm" type="button" disabled={!cfg.enabled} onClick={() => runSource.mutate(cat.id, { onSuccess: () => toast(`${cat.name} run queued`) })}>
          Run now
        </button>
      </div>
      <div className="row-flex" style={{ fontSize: 12, gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <span className={`dot ${cfg.lastRunOk ? '' : 'off'}`} style={cfg.lastRunOk === false ? { background: 'var(--down)' } : undefined} />
        <span className="muted grow" style={{ overflowWrap: 'anywhere' }}>
          {cfg.lastRunAt ? `${ago(cfg.lastRunAt)} · ${cfg.lastRunMessage}` : 'Never run'}
        </span>
        <span className="mono muted">{cfg.itemsLast24h.toLocaleString()} / 24h</span>
      </div>
    </section>
  );
}

function SubredditEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [add, setAdd] = useState('');
  const suggestions = DEFAULT_SUBREDDITS.filter((s) => !value.includes(s));
  const push = (s: string) => {
    const clean = s.replace(/^\/?r\//i, '').trim();
    if (clean && !value.includes(clean)) onChange([...value, clean]);
    setAdd('');
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="label-caps">Subreddits</div>
      <div className="row-flex" style={{ flexWrap: 'wrap', gap: 6 }}>
        {value.map((s) => (
          <span key={s} className="tag row-flex" style={{ gap: 4, fontSize: 12, padding: '4px 4px 4px 8px' }}>
            r/{s}
            <button type="button" className="btn ghost sm" style={{ height: 20, padding: '0 4px' }} aria-label={`Remove r/${s}`} onClick={() => onChange(value.filter((x) => x !== s))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="row-flex"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          push(add);
        }}
      >
        <label className="sr-only" htmlFor="sub-add">
          Add subreddit
        </label>
        <input id="sub-add" className="input mono grow" list="sub-suggest" placeholder="Add subreddit…" value={add} onChange={(e) => setAdd(e.target.value)} style={{ height: 32 }} />
        <datalist id="sub-suggest">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <button className="btn sm" type="submit" disabled={!add}>
          Add
        </button>
      </form>
    </div>
  );
}

const ALL_FORMS = ['8-K', '4', '10-Q', '10-K', 'S-1', 'S-3', '424B5', 'SC 13D', 'SC 13G', '13F-HR', 'DEF 14A'];
function FormsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="label-caps">Filing types</div>
      <div className="row-flex" style={{ flexWrap: 'wrap', gap: 6 }}>
        {ALL_FORMS.map((f) => (
          <button
            key={f}
            type="button"
            className="prio"
            aria-pressed={value.includes(f)}
            style={value.includes(f) ? { borderColor: 'var(--accent-line)', color: 'var(--accent)' } : undefined}
            onClick={() => onChange(value.includes(f) ? value.filter((x) => x !== f) : [...value, f])}
          >
            {f}
          </button>
        ))}
      </div>
    </div>
  );
}

// ======================= Automation =======================

function AutomationTab() {
  const q = useAppSettings();
  const { updateApp } = useMutations();
  const toast = useToast();
  const [v, setV] = useState<AppSettingsDto | null>(null);
  useEffect(() => {
    if (q.data) setV(q.data);
  }, [q.data]);
  if (!v) return <QueryState q={q}>{null}</QueryState>;
  const num = (k: keyof AppSettingsDto, label: string, hint: string, step = 1) => (
    <label className="field">
      {label}
      <input className="input mono" type="number" step={step} min={0} value={v[k] as number} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
      <span className="faint" style={{ fontSize: 11 }}>
        {hint}
      </span>
    </label>
  );
  return (
    <section className="panel panel-pad" style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="row-flex">
        <div className="grow">
          <div style={{ fontWeight: 600 }}>Autonomous mode</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Ingest, sweep and research on a schedule without being asked.
          </div>
        </div>
        <Toggle label="Autonomous mode" checked={v.autonomous} onChange={(x) => setV({ ...v, autonomous: x })} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 16 }}>
        {num('sweepIntervalMin', 'Sweep every (min)', 'Aggregate signals and decide what to research')}
        {num('dailyBudgetUsd', 'Daily AI budget ($)', 'Jobs pause when reached; 0 = no limit', 0.5)}
        {num('maxDeepDivesPerSweep', 'Deep dives per sweep', 'Top N by priority')}
        {num('deepDiveStaleHours', 'Refresh research after (h)', 'Emerging names refresh twice as often')}
        {num('positionReviewHours', 'Review positions every (h)', 'Hold/sell advice cadence')}
        {num('minMentionsForSignal', 'Min. weekly mentions', 'Threshold to become a signal')}
      </div>
      <label className="field" style={{ maxWidth: 320 }}>
        Risk profile
        <select className="select input" value={v.riskProfile} onChange={(e) => setV({ ...v, riskProfile: e.target.value as AppSettingsDto['riskProfile'] })}>
          <option value="CONSERVATIVE">Conservative</option>
          <option value="BALANCED">Balanced</option>
          <option value="AGGRESSIVE">Aggressive</option>
        </select>
        <span className="faint" style={{ fontSize: 11 }}>
          Passed to the analyst for scoring and hold/sell calls.
        </span>
      </label>
      <div className="row-flex">
        <div className="grow" />
        <button className="btn primary" type="button" disabled={JSON.stringify(v) === JSON.stringify(q.data)} onClick={() => updateApp.mutate(v, { onSuccess: () => toast('Automation settings saved') })}>
          Save changes
        </button>
      </div>
    </section>
  );
}

// ======================= Connection =======================

export function ConnectionForm({ onSaved }: { onSaved?: () => void }) {
  const [url, setUrl] = useState(getConfig().apiUrl);
  const [token, setToken] = useState(getConfig().token);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await saveConfig({ apiUrl: url.trim(), token: token.trim() });
    try {
      await api('/health');
      await api('/dashboard/summary');
      setStatus({ ok: true, text: 'Connected' });
      onSaved?.();
    } catch (err: any) {
      setStatus({ ok: false, text: err.status === 401 ? 'Token rejected by the API' : err.message });
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label className="field">
        API URL
        <input className="input mono" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-app.up.railway.app" />
      </label>
      <label className="field">
        API token (APP_API_TOKEN)
        <input className="input mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      <p className="faint" style={{ margin: 0, fontSize: 12 }}>
        Stored locally on this computer{window.ff ? ', encrypted with your OS keychain when available' : ''}.
      </p>
      <div className="row-flex">
        {status && <span className={status.ok ? 'up' : 'error'}>{status.text}</span>}
        <div className="grow" />
        <button className="btn primary" type="submit">
          Save &amp; connect
        </button>
      </div>
    </form>
  );
}
