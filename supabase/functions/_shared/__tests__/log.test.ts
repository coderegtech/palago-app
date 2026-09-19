/**
 * The Edge Function logger, run under Jest: it uses only web and `node:`
 * APIs that Node and Deno share, so its redaction and request context can be
 * proven without an edge runtime.
 */

import { log, redact, withLogging } from '../log.ts';

function captured(spy: jest.SpyInstance): Record<string, unknown>[] {
  return spy.mock.calls.map(([line]) => JSON.parse(line as string));
}

describe('redact', () => {
  it('never writes a credential, whatever it is called', () => {
    const out = redact({
      token: 'abc',
      paymentToken: 'def',
      password: 'hunter2',
      authorization: 'Bearer x',
      apikey: 'sb_publishable_x',
      nested: { refresh_token: 'r' },
    });
    expect(JSON.stringify(out)).not.toMatch(/abc|def|hunter2|Bearer|sb_publishable|"r"/);
  });

  it('keeps only the domain of an e-mail address', () => {
    expect(redact({ email: 'maria@palago.test' })).toEqual({ email: '***@palago.test' });
  });

  it('keeps only the tail of a payment reference', () => {
    expect(redact({ reference: 'PAY-2026-000123' })).toEqual({ reference: 'PAY-2026-…123' });
  });

  it('turns an Error into its name and message', () => {
    expect(redact({ error: new TypeError('boom') })).toEqual({
      error: { name: 'TypeError', message: 'boom' },
    });
  });

  it('truncates a long string instead of flooding the log', () => {
    const body = 'x'.repeat(2_000);
    expect((redact({ body }).body as string).length).toBeLessThan(510);
  });
});

describe('withLogging', () => {
  let out: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let err: jest.SpyInstance;

  beforeEach(() => {
    out = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const internal = () => new Response('{"success":false}', { status: 500 });

  it('stamps every line of a request, and the response, with one id', async () => {
    const handler = withLogging(
      'get-payment',
      () => {
        log.info('looked_up', { reference: 'PAY-2026-000001' });
        return new Response('{}', { status: 200 });
      },
      internal,
    );

    const response = await handler(new Request('http://x', { method: 'POST' }));
    const lines = captured(out);
    const id = response.headers.get('x-request-id');

    expect(id).toBeTruthy();
    expect(lines.map((l) => l.event)).toEqual(['looked_up', 'request']);
    expect(lines.every((l) => l.requestId === id && l.fn === 'get-payment')).toBe(true);
    expect(lines[1]).toMatchObject({ status: 200, method: 'POST' });
    expect(typeof lines[1].durationMs).toBe('number');
  });

  it('keeps concurrent requests apart', async () => {
    const handler = withLogging(
      'validate-qr',
      async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        log.info('work');
        return new Response('{}');
      },
      internal,
    );

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => handler(new Request('http://x', { method: 'POST' }))),
    );
    const ids = new Set(responses.map((r) => r.headers.get('x-request-id')));
    expect(ids.size).toBe(5);

    // Each request's own lines carry its own id: two per request, never mixed.
    const lines = captured(out);
    for (const id of ids) {
      expect(lines.filter((l) => l.requestId === id)).toHaveLength(2);
    }
  });

  it('logs a refusal as a warning with its code', async () => {
    const handler = withLogging(
      'manage-staff',
      () => new Response('{}', { status: 403, headers: { 'x-palago-code': 'FORBIDDEN' } }),
      internal,
    );
    await handler(new Request('http://x', { method: 'POST' }));
    expect(captured(warn)[0]).toMatchObject({ event: 'request', status: 403, code: 'FORBIDDEN' });
  });

  it('answers an unhandled throw with the internal-error response, and says where', async () => {
    const handler = withLogging(
      'send-push',
      () => {
        throw new Error('kaboom');
      },
      internal,
    );
    const response = await handler(new Request('http://x', { method: 'POST' }));
    expect(response.status).toBe(500);
    const lines = captured(err);
    expect(lines[0]).toMatchObject({ event: 'unhandled', error: { message: 'kaboom' } });
    expect(lines[1]).toMatchObject({ event: 'request', status: 500 });
  });

  it('accepts a well-formed caller id and refuses anything else', async () => {
    const handler = withLogging('get-payment', () => new Response('{}'), internal);

    const kept = await handler(
      new Request('http://x', { method: 'POST', headers: { 'x-request-id': 'client-abc12345' } }),
    );
    expect(kept.headers.get('x-request-id')).toBe('client-abc12345');

    const replaced = await handler(
      new Request('http://x', {
        method: 'POST',
        headers: { 'x-request-id': '"},{"event":"forged' },
      }),
    );
    expect(replaced.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
