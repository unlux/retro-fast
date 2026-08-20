/**
 * Jira fetch wrapper: base URL, Basic auth, error mapping, 429 retry.
 *
 * Every Jira call in the app goes through `jiraFetch`. It never proxies an
 * arbitrary path from user input and never puts the token in a response — the
 * token stays inside the Worker.
 *
 * Config comes from the Worker environment. On Cloudflare that is
 * `import { env } from 'cloudflare:workers'` — note that `Astro.locals.runtime.env`
 * was *removed* in Astro v6 / @astrojs/cloudflare v14 and now throws on access,
 * so routes read config via `readJiraConfig()` below rather than from locals.
 */

/** Credentials + base URL, validated once per request. */
export interface JiraConfig {
  site: string;
  email: string;
  token: string;
}

/** Why a Jira call failed, in the terms the UI cares about. */
export type JiraErrorKind =
  /** Missing/blank JIRA_SITE, JIRA_EMAIL or JIRA_API_TOKEN — Jira never called. */
  | 'unconfigured'
  /** 401: token invalid, expired, or revoked. The one the UI calls out by name. */
  | 'unauthorized'
  /** 403: authenticated but not permitted (board visibility, licence). */
  | 'forbidden'
  /** 404: board or resource doesn't exist. */
  | 'not-found'
  /** 429 that outlived its retries. */
  | 'rate-limited'
  /** 5xx, or any other non-2xx status. */
  | 'upstream'
  /** Network failure, timeout, or unparseable JSON. */
  | 'network';

export class JiraError extends Error {
  readonly kind: JiraErrorKind;
  readonly status: number | undefined;

  constructor(kind: JiraErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'JiraError';
    this.kind = kind;
    this.status = status;
  }

  /** HTTP status this error should surface as from our own API routes. */
  get httpStatus(): number {
    switch (this.kind) {
      case 'unconfigured':
        return 503;
      case 'unauthorized':
        return 401;
      case 'forbidden':
        return 403;
      case 'not-found':
        return 404;
      case 'rate-limited':
        return 429;
      default:
        return 502;
    }
  }
}

/**
 * Pull Jira config out of the Worker env.
 * Throws `unconfigured` rather than calling Jira with empty credentials, so a
 * deployment missing its secrets gives a clear message instead of a 401.
 */
export function readJiraConfig(env: Env | undefined): JiraConfig {
  const site = String(env?.JIRA_SITE ?? '').trim().replace(/\/+$/, '');
  const email = String(env?.JIRA_EMAIL ?? '').trim();
  const token = String(env?.JIRA_API_TOKEN ?? '').trim();

  const missing: string[] = [];
  if (site === '') missing.push('JIRA_SITE');
  if (email === '') missing.push('JIRA_EMAIL');
  if (token === '') missing.push('JIRA_API_TOKEN');

  if (missing.length > 0) {
    throw new JiraError('unconfigured', `Jira is not configured: missing ${missing.join(', ')}.`);
  }

  return { site, email, token };
}

/** `Basic base64(email:token)`. Built per request; never logged or returned. */
function authHeader(config: JiraConfig): string {
  return `Basic ${btoa(`${config.email}:${config.token}`)}`;
}

/**
 * `Retry-After` in milliseconds. Jira sends either delta-seconds or an HTTP
 * date; both are accepted. Returns `null` when absent or unusable, and clamps
 * so a hostile/garbled header can't stall a request past the Worker's budget.
 */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const value = header.trim();
  if (value === '') return null;

  let ms: number;
  if (/^\d+$/.test(value)) {
    ms = Number(value) * 1000;
  } else {
    const at = Date.parse(value);
    if (Number.isNaN(at)) return null;
    ms = at - now;
  }

  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.min(ms, MAX_RETRY_WAIT_MS);
}

/** Upper bound on a single honored Retry-After wait. */
const MAX_RETRY_WAIT_MS = 5000;
/** Fallback wait when a 429 arrives with no usable Retry-After. */
const DEFAULT_RETRY_WAIT_MS = 1000;
/** Retro cadence means rate limits are near-impossible; one retry is plenty. */
const MAX_RETRIES = 2;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface JiraFetchOptions {
  /** Query parameters; `undefined` values are dropped. */
  search?: Record<string, string | number | undefined>;
  /** Overrides retry count in tests. */
  maxRetries?: number;
  /** Injectable for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * GET a Jira path and parse JSON.
 *
 * `path` is always a literal from our own code (never user input) and is
 * resolved against `JIRA_SITE`. Non-2xx responses become `JiraError` with a
 * mapped `kind`; 429s are retried while `Retry-After` allows.
 */
export async function jiraFetch<T>(
  config: JiraConfig,
  path: string,
  options: JiraFetchOptions = {},
): Promise<T> {
  const url = new URL(path, `${config.site}/`);
  for (const [key, value] of Object.entries(options.search ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const doFetch = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;

  let attempt = 0;
  for (;;) {
    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        headers: {
          Authorization: authHeader(config),
          Accept: 'application/json',
        },
      });
    } catch (cause) {
      throw new JiraError('network', `Could not reach Jira: ${describe(cause)}`);
    }

    if (response.status === 429 && attempt < maxRetries) {
      attempt += 1;
      await sleep(retryAfterMs(response.headers.get('Retry-After')) ?? DEFAULT_RETRY_WAIT_MS);
      continue;
    }

    if (!response.ok) throw await toJiraError(response);

    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw new JiraError('network', `Jira returned unparseable JSON: ${describe(cause)}`);
    }
  }
}

/** Map an error response to a `JiraError`, folding in Jira's own message. */
async function toJiraError(response: Response): Promise<JiraError> {
  const detail = await errorDetail(response);

  switch (response.status) {
    case 401:
      // Called out separately everywhere: it is the one failure a human can
      // fix, and the fix (rotate the token) is not obvious from "502".
      return new JiraError(
        'unauthorized',
        'Jira rejected the credentials — the API token is invalid or has expired.',
        401,
      );
    case 403:
      return new JiraError('forbidden', `Jira denied access${detail}.`, 403);
    case 404:
      return new JiraError('not-found', `Jira resource not found${detail}.`, 404);
    case 429:
      return new JiraError('rate-limited', 'Jira is rate limiting this token.', 429);
    default:
      return new JiraError('upstream', `Jira returned ${response.status}${detail}.`, response.status);
  }
}

/** Best-effort ": reason" suffix from Jira's error body; never throws. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { errorMessages?: unknown; message?: unknown };
    const messages = Array.isArray(body.errorMessages)
      ? body.errorMessages.filter((m): m is string => typeof m === 'string')
      : [];
    const first = messages[0] ?? (typeof body.message === 'string' ? body.message : '');
    return first ? `: ${first}` : '';
  } catch {
    return '';
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Days until the configured token expiry, or `null` when unset/unparseable.
 * Negative means already expired. The UI banners at < 30 days.
 *
 * A bare `YYYY-MM-DD` is a *calendar date*: the token is good all through that
 * day, so any moment on it counts as 0 days left rather than -1. Both sides are
 * therefore compared as UTC days. A value with a time is a real instant and
 * keeps timestamp arithmetic.
 */
export function daysUntilExpiry(expiry: string | undefined, now: Date = new Date()): number | null {
  const value = String(expiry ?? '').trim();
  if (value === '') return null;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const at = Date.parse(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(at)) return null;

  const from = dateOnly
    ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    : now.getTime();

  return Math.floor((at - from) / 86_400_000);
}
