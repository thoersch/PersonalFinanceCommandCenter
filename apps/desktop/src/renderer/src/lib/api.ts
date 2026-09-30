import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityItem,
  AiProviderCatalogEntry,
  AppSettingsDto,
  CreatePositionInput,
  DashboardSummary,
  HeatmapDto,
  OpportunityDetail,
  OpportunityListItem,
  PositionAlert,
  PositionDto,
  Priority,
  ProviderConfigDto,
  ResearchJobDto,
  RoleAssignmentDto,
  SourceCatalogEntry,
  SourceConfigDto,
  Stage,
  UpdateProviderInput,
  UpdateSourceInput,
  AI_ROLES,
} from '@ff/shared';

let config = { apiUrl: 'http://localhost:3000', token: '' };

export async function loadConfig() {
  if (window.ff) config = await window.ff.getConfig();
  else {
    try {
      const saved = localStorage.getItem('ff-config');
      if (saved) config = JSON.parse(saved);
    } catch {
      /* browser storage unavailable */
    }
  }
  return config;
}

export async function saveConfig(next: { apiUrl: string; token: string }) {
  if (window.ff) config = await window.ff.setConfig(next);
  else {
    config = { ...next, apiUrl: next.apiUrl.replace(/\/+$/, '') };
    try {
      localStorage.setItem('ff-config', JSON.stringify(config));
    } catch {
      /* ignore */
    }
  }
  return config;
}

export const getConfig = () => config;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${config.apiUrl}${path.startsWith('/health') ? '' : '/api'}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? text);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg || res.statusText);
  }
  return text ? JSON.parse(text) : (undefined as T);
}

const body = (b: unknown) => JSON.stringify(b);
const LIVE = 15_000;

// ---------- queries ----------

export const useSummary = () => useQuery({ queryKey: ['summary'], queryFn: () => api<DashboardSummary>('/dashboard/summary'), refetchInterval: LIVE });
export const useActivity = () => useQuery({ queryKey: ['activity'], queryFn: () => api<ActivityItem[]>('/dashboard/activity'), refetchInterval: 5_000 });
export const useAlerts = () => useQuery({ queryKey: ['alerts'], queryFn: () => api<PositionAlert[]>('/dashboard/alerts'), refetchInterval: LIVE });
export const useHeatmap = () => useQuery({ queryKey: ['heatmap'], queryFn: () => api<HeatmapDto>('/dashboard/heatmap'), refetchInterval: 60_000 });

export const useOpportunities = (f: { stage?: Stage | ''; q?: string } = {}) =>
  useQuery({
    queryKey: ['opportunities', f],
    queryFn: () => {
      const p = new URLSearchParams();
      if (f.stage) p.set('stage', f.stage);
      if (f.q) p.set('q', f.q);
      return api<OpportunityListItem[]>(`/opportunities?${p}`);
    },
    refetchInterval: LIVE,
  });

export const useOpportunity = (ticker: string | undefined) =>
  useQuery({
    queryKey: ['opportunity', ticker],
    queryFn: () => api<OpportunityDetail>(`/opportunities/${ticker}`),
    enabled: !!ticker,
    refetchInterval: LIVE,
  });

export const usePositions = (includeClosed = false) =>
  useQuery({ queryKey: ['positions', includeClosed], queryFn: () => api<PositionDto[]>(`/positions?includeClosed=${includeClosed}`), refetchInterval: LIVE });

export const useJobs = (status: string) =>
  useQuery({ queryKey: ['jobs', status], queryFn: () => api<ResearchJobDto[]>(`/jobs?status=${status}&limit=200`), refetchInterval: 4_000 });

export const useCatalog = () =>
  useQuery({
    queryKey: ['catalog'],
    queryFn: () =>
      api<{ providers: AiProviderCatalogEntry[]; roles: typeof AI_ROLES; sources: SourceCatalogEntry[] }>('/settings/catalog'),
    staleTime: Infinity,
  });
export const useProviders = () => useQuery({ queryKey: ['providers'], queryFn: () => api<ProviderConfigDto[]>('/settings/providers') });
export const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => api<RoleAssignmentDto[]>('/settings/roles') });
export const useSources = () => useQuery({ queryKey: ['sources'], queryFn: () => api<SourceConfigDto[]>('/settings/sources'), refetchInterval: 20_000 });
export const useAppSettings = () => useQuery({ queryKey: ['app-settings'], queryFn: () => api<AppSettingsDto>('/settings/app') });

// ---------- mutations ----------

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export function useMutations() {
  const inv = useInvalidate();
  const m = <A, R>(fn: (a: A) => Promise<R>, keys: string[]) =>
    useMutation<R, Error, A>({ mutationFn: fn, onSuccess: () => inv(...keys) });
  return {
    setOppPriority: m((a: { ticker: string; priority: Priority }) => api(`/opportunities/${a.ticker}/priority`, { method: 'PUT', body: body({ priority: a.priority }) }), ['opportunities', 'opportunity', 'jobs']),
    patchOpp: m((a: { ticker: string; watch?: boolean; dismissed?: boolean }) => api(`/opportunities/${a.ticker}`, { method: 'PATCH', body: body({ watch: a.watch, dismissed: a.dismissed }) }), ['opportunities', 'opportunity']),
    researchNow: m((ticker: string) => api(`/opportunities/${ticker}/research`, { method: 'POST' }), ['jobs', 'activity', 'summary']),
    track: m((a: { ticker: string }) => api<OpportunityDetail>('/opportunities', { method: 'POST', body: body(a) }), ['opportunities', 'jobs']),
    sweep: m(() => api('/sweep', { method: 'POST' }), ['jobs', 'activity', 'summary']),
    createPosition: m((a: CreatePositionInput) => api<PositionDto>('/positions', { method: 'POST', body: body(a) }), ['positions', 'opportunities', 'opportunity', 'summary', 'jobs']),
    closePosition: m((a: { id: string; exitPrice: number }) => api(`/positions/${a.id}/close`, { method: 'POST', body: body({ exitPrice: a.exitPrice }) }), ['positions', 'summary', 'alerts']),
    deletePosition: m((id: string) => api(`/positions/${id}`, { method: 'DELETE' }), ['positions', 'summary', 'alerts']),
    reviewPosition: m((id: string) => api(`/positions/${id}/review`, { method: 'POST' }), ['jobs', 'activity']),
    setJobPriority: m((a: { id: string; priority: Priority }) => api(`/jobs/${a.id}/priority`, { method: 'PUT', body: body({ priority: a.priority }) }), ['jobs']),
    cancelJob: m((id: string) => api(`/jobs/${id}/cancel`, { method: 'POST' }), ['jobs']),
    retryJob: m((id: string) => api(`/jobs/${id}/retry`, { method: 'POST' }), ['jobs']),
    updateProvider: m((a: { id: string } & UpdateProviderInput) => {
      const { id, ...rest } = a;
      return api(`/settings/providers/${id}`, { method: 'PATCH', body: body(rest) });
    }, ['providers']),
    testProvider: m((id: string) => api<{ ok: boolean; message: string; models: string[] }>(`/settings/providers/${id}/test`, { method: 'POST' }), ['providers']),
    updateRole: m((a: RoleAssignmentDto) => {
      const { role, ...rest } = a;
      return api(`/settings/roles/${role}`, { method: 'PUT', body: body(rest) });
    }, ['roles']),
    updateSource: m((a: { id: string } & UpdateSourceInput) => {
      const { id, ...rest } = a;
      return api(`/settings/sources/${id}`, { method: 'PATCH', body: body(rest) });
    }, ['sources']),
    runSource: m((id: string) => api(`/sources/${id}/run`, { method: 'POST' }), ['sources', 'jobs', 'activity']),
    updateApp: m((a: Partial<AppSettingsDto>) => api('/settings/app', { method: 'PUT', body: body(a) }), ['app-settings', 'summary']),
  };
}
