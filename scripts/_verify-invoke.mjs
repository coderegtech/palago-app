/**
 * Calling an Edge Function the way the app does — and telling a refusal apart
 * from a runtime that did not answer.
 *
 * Eight suites had their own copy of this. They also shared a failure mode: the
 * local edge runtime occasionally recycles a worker mid-sweep and the gateway
 * answers `503 {"message":"name resolution failed"}` with no `code` field. To a
 * check written as `body?.code === 'UNPAID_BOOKING'` that looks exactly like a
 * security regression, and it shows up as one assertion failing at random in a
 * long run.
 *
 * So: a 502/503/504 is a transport failure, not an answer. It is retried once,
 * briefly, and if it still does not answer the result carries `transportError`
 * so the check says what actually happened instead of blaming the function.
 *
 * This is NOT "warm it and try again" — a 4xx, including every authorisation
 * refusal, is returned immediately and never retried. Only the statuses that
 * mean "nothing ran" are.
 */

const RETRYABLE = new Set([502, 503, 504]);

/**
 * Node's `fetch` has no default timeout.
 *
 * When the local edge-runtime container goes down mid-sweep the connection is
 * accepted and then never answered, and a suite waits on it forever — which is
 * how `db:verify:all` once sat silent for hours looking like a slow test rather
 * than a dead container. Thirty seconds is far longer than any of these
 * functions takes and far shorter than "never".
 */
const TIMEOUT_MS = 30_000;

export function makeInvoke(url, key) {
  return async function invoke(fn, body, accessToken) {
    const send = async () => {
      try {
        return await fetch(`${url}/functions/v1/${fn}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: key,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
          throw new Error(
            `${fn}: no answer in ${TIMEOUT_MS / 1000}s. The edge runtime is not responding — ` +
              'check `pnpm functions:serve` is running, and that only ONE copy of it is (two ' +
              'fight over the container and take it down).',
          );
        }
        throw error;
      }
    };

    let response = await send();

    if (RETRYABLE.has(response.status)) {
      await new Promise((r) => setTimeout(r, 1500));
      response = await send();
    }

    const parsed = await response.json().catch(() => null);

    if (RETRYABLE.has(response.status)) {
      // Thrown, not returned. A body with no `code` in it reads as "the
      // function refused for an unexpected reason" at every call site, so
      // returning it would scatter one infrastructure problem across dozens of
      // unrelated assertions and invite exactly the misdiagnosis AGENTS.md
      // warns about. Stopping says what is wrong, once.
      throw new Error(
        `${fn}: the edge runtime did not answer (HTTP ${response.status}). ` +
          `Is \`pnpm functions:serve\` running? ${JSON.stringify(parsed)}`,
      );
    }

    return { status: response.status, body: parsed };
  };
}
