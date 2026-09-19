/**
 * Structured logging for PalaGo Edge Functions.
 *
 * Every line is one JSON object — `{ ts, level, fn, requestId, event, … }` —
 * so the Supabase log explorer can filter on a field instead of grepping
 * prose, and every line one request wrote shares its `requestId`. The same id
 * goes back to the caller in the `x-request-id` response header, so "it failed
 * at 14:02" from a user becomes one query, not an afternoon.
 *
 * Context is carried by AsyncLocalStorage rather than threaded through every
 * helper: `failFromRpc` in http.ts, three calls deep, logs against the right
 * request without being handed a logger. A module-level "current request"
 * would not do — one isolate serves concurrent requests, and they would
 * overwrite each other's id.
 *
 * Redaction happens here, once, not at each call site: a key that names a
 * credential is replaced, an e-mail keeps only its domain, and a payment
 * reference keeps only its tail. Payment tokens are the credential for the
 * public payment page and must never reach a log; see docs/observability.md.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

interface Context {
  fn: string;
  requestId: string;
}

const storage = new AsyncLocalStorage<Context>();

const SECRET_KEY = /token|password|secret|authorization|apikey|api_key|signature|cookie/i;
const EMAIL = /^[^@\s]+@([^@\s]+)$/;
const PAYMENT_REFERENCE = /^(PAY|PG|RCP)-\d{4}-\d+$/;

function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    const email = EMAIL.exec(value);
    if (email) return `***@${email[1]}`;
    if (PAYMENT_REFERENCE.test(value)) return `${value.slice(0, value.lastIndexOf('-') + 1)}…${value.slice(-3)}`;
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactValue(key, v));
  if (value && typeof value === 'object') return redact(value as Fields);
  return value;
}

export function redact(fields: Fields): Fields {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, redactValue(k, v)]));
}

function write(level: Level, event: string, fields: Fields = {}) {
  const context = storage.getStore();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    fn: context?.fn ?? 'unknown',
    requestId: context?.requestId ?? null,
    event,
    ...redact(fields),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
};

/** The id of the request being served, for a response body that wants it. */
export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

// Accept a caller's id only if it looks like one — it is echoed into logs and
// a header, so it must not be a vehicle for anything else.
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Wrap a handler: assign a request id, time the request, log one `request`
 * line with its outcome, and turn an unhandled throw into the standard
 * INTERNAL_ERROR envelope instead of the runtime's bare 500.
 */
export function withLogging(
  fn: string,
  handler: (request: Request) => Promise<Response> | Response,
  internalError: () => Response,
): (request: Request) => Promise<Response> {
  return (request) => {
    const incoming = request.headers.get('x-request-id');
    const requestId = incoming && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();

    return storage.run({ fn, requestId }, async () => {
      const started = performance.now();
      let response: Response;
      try {
        response = await handler(request);
      } catch (error) {
        log.error('unhandled', {
          error,
          stack: error instanceof Error ? error.stack?.split('\n').slice(0, 6).join('\n') : undefined,
        });
        response = internalError();
      }

      const headers = new Headers(response.headers);
      headers.set('x-request-id', requestId);

      if (request.method !== 'OPTIONS') {
        const status = response.status;
        write(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'request', {
          method: request.method,
          status,
          code: headers.get('x-palago-code') ?? undefined,
          durationMs: Math.round(performance.now() - started),
        });
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
  };
}
