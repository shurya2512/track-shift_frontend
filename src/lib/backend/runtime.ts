/**
 * The live policy backend, when one is configured. Without it the app reads the
 * snapshot of the same report tree that ships under `public/diagnostics/reports`, so
 * every stored decision stays readable with no service running.
 */
const API_URL = process.env.NEXT_PUBLIC_POWESHIFT_API_URL;

const REPORTS_ROOT = '/diagnostics/reports';

/** Where a live report path is mirrored in the shipped snapshot. */
export function snapshotPath(path: string): string {
  const rest = path.startsWith(REPORTS_ROOT) ? path.slice(REPORTS_ROOT.length) : path;
  return `${REPORTS_ROOT}${rest === '' || rest === '/' ? '/index.json' : rest}`;
}

/** Which of the two the reports on screen came from. Never guessed by a view. */
export type DiagnosticOrigin = 'live' | 'snapshot';

export interface DiagnosticTrack {
  event_name: string;
  status: 'diagnostic_only' | 'unavailable';
  summary: string;
  mode: 'qualifying' | 'race';
}

export interface DiagnosticCatalog {
  status: 'diagnostic_only';
  physicsAdmission: false;
  /** Whether a live backend answered, or the shipped snapshot did. */
  origin: DiagnosticOrigin;
  qualifying: DiagnosticTrack[];
  race: DiagnosticTrack[];
}

export interface RuntimeRecommendation {
  sequence: number;
  intent: string;
  deployment_fraction: number;
  evidence_status: 'retrospective_inference' | 'unsupported_fallback';
  binding_reasons: string[];
}

export interface LiveObservation {
  sequence: number;
  observed_at_s: number;
  values: number[];
  feature_mask: boolean[];
  action_mask: boolean[];
  deployment_available: boolean;
  news_prior_ids: string[];
}

export interface LiveRecommendation {
  decision_sequence: number;
  source_sequence: number;
  source_observed_at_s: number;
  input_hz: 4;
  decision_hz: 5;
  held_source_frame: boolean;
  recommendation: RuntimeRecommendation;
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Backend returned ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

/**
 * The live backend first where one is configured, and the shipped snapshot otherwise.
 * A live backend that is configured but down falls through rather than failing, so the
 * stored reports stay reachable — the origin is reported, not hidden.
 */
async function readJson(path: string): Promise<{ body: Record<string, unknown>; origin: DiagnosticOrigin }> {
  if (API_URL) {
    try {
      return { body: await getJson(`${API_URL}${path}`), origin: 'live' };
    } catch {
      // Falls through to the snapshot below.
    }
  }
  return { body: await getJson(snapshotPath(path)), origin: 'snapshot' };
}

export function normalizeDiagnosticTracks(
  value: unknown,
  mode: 'qualifying' | 'race',
): DiagnosticTrack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.event_name !== 'string' || typeof row.summary !== 'string') return [];
    const status = row.status === 'unavailable' ? 'unavailable' : 'diagnostic_only';
    return [{ event_name: row.event_name, summary: row.summary, status, mode }];
  });
}

export async function fetchDiagnosticCatalog(): Promise<DiagnosticCatalog> {
  const root = await readJson(REPORTS_ROOT);
  const qualifyingPath = String(root.body.qualifying_index ?? 'qualifying/index.json');
  const racePath = String(root.body.race_index ?? 'race/index.json');
  const [qualifying, race] = await Promise.all([
    readJson(`${REPORTS_ROOT}/${qualifyingPath}`),
    readJson(`${REPORTS_ROOT}/${racePath}`),
  ]);
  return {
    status: 'diagnostic_only',
    physicsAdmission: false,
    origin: root.origin,
    qualifying: normalizeDiagnosticTracks(qualifying.body.tracks, 'qualifying'),
    race: normalizeDiagnosticTracks(race.body.tracks, 'race'),
  };
}

export async function fetchDiagnosticReport<T>(path: string): Promise<T> {
  const { body } = await readJson(`${REPORTS_ROOT}/${path}`);
  return body as T;
}

function websocketUrl(path: string): string {
  if (!API_URL) throw new Error('No policy backend is configured');
  const url = new URL(API_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = path;
  return url.toString();
}

export async function startRegisteredRun(runId: string): Promise<void> {
  if (!API_URL) throw new Error('No policy backend is configured');
  const response = await fetch(`${API_URL}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run_id: runId }),
  });
  if (!response.ok && response.status !== 409) throw new Error(`Run start returned ${response.status}`);
}

export function streamRegisteredRun(
  runId: string,
  onRecommendation: (frame: RuntimeRecommendation) => void,
  onError: () => void,
): () => void {
  const socket = new WebSocket(websocketUrl(`/runs/${encodeURIComponent(runId)}/stream`));
  socket.onmessage = (event) => onRecommendation(JSON.parse(event.data) as RuntimeRecommendation);
  socket.onerror = onError;
  return () => socket.close();
}

export function openLivePolicy(
  runId: string,
  onRecommendation: (frame: LiveRecommendation) => void,
  onError: () => void,
): { send: (observation: LiveObservation) => void; close: () => void } {
  const socket = new WebSocket(websocketUrl(`/runs/${encodeURIComponent(runId)}/live`));
  const pending: LiveObservation[] = [];
  socket.onopen = () => {
    for (const observation of pending.splice(0)) socket.send(JSON.stringify(observation));
  };
  socket.onmessage = (event) => onRecommendation(JSON.parse(event.data) as LiveRecommendation);
  socket.onerror = onError;
  return {
    send: (observation) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(observation));
      else pending.push(observation);
    },
    close: () => socket.close(),
  };
}
