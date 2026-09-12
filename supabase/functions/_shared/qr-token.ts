/**
 * Boarding-pass tokens.
 *
 * The boarding QR must be usable offline by a scanner that has just read it,
 * and must not be forgeable by whoever holds it. So the token is an
 * HMAC-SHA256 signature over a tiny payload, using a secret held only in Edge
 * Function environment (`QR_SIGNING_SECRET`) — never in the app bundle.
 *
 * Signature proves AUTHENTICITY. It says nothing about whether the ticket is
 * still good: a cancelled, refunded or already-boarded booking has a perfectly
 * valid signature. Revocation is the database's job, checked by
 * `validate_booking_qr` on every scan. Both are required.
 *
 * Format: base64url(payload).base64url(hmac)
 *
 * The payload holds only a booking id, its reference, and issue/expiry times.
 * No passenger names, no seat numbers, no contact details — anything in a QR is
 * readable by anyone who photographs the screen.
 */

export interface BoardingTokenPayload {
  /** Booking id. */
  bid: string;
  /** Booking reference, so a mismatch is detectable without a lookup. */
  ref: string;
  /** Issued at, seconds since epoch. */
  iat: number;
  /** Expires at, seconds since epoch. */
  exp: number;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export function requireSigningSecret(): string {
  const secret = Deno.env.get('QR_SIGNING_SECRET');
  if (!secret || secret.length < 32) {
    // Failing closed: a short or missing secret would produce tokens that look
    // fine and are trivially forgeable.
    throw new Error('QR_SIGNING_SECRET must be set and at least 32 characters.');
  }
  return secret;
}

export async function signBoardingToken(
  payload: BoardingTokenPayload,
  secret: string,
): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

export type VerifyResult =
  | { ok: true; payload: BoardingTokenPayload }
  | { ok: false; reason: 'INVALID_QR' | 'QR_EXPIRED' };

export async function verifyBoardingToken(
  token: string,
  secret: string,
): Promise<VerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'INVALID_QR' };

  const [body, signature] = parts;

  let valid: boolean;
  try {
    const signatureBytes = fromBase64Url(signature);
    // One spelling per signature. `atob` ignores the unused low bits of the
    // final character, so without this a 32-byte HMAC ending in "A" is equally
    // accepted ending in "B", "C" or "D". Not a forgery — the bytes are the
    // same — but a verifier should accept exactly one encoding of what it
    // issued. (It is also what made the suite's "tampered signature" check fail
    // one run in sixteen.)
    if (toBase64Url(signatureBytes) !== signature) {
      return { ok: false, reason: 'INVALID_QR' };
    }
    const key = await hmacKey(secret);
    // crypto.subtle.verify compares in constant time, so this does not leak
    // how much of a forged signature was correct.
    valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(body));
  } catch {
    return { ok: false, reason: 'INVALID_QR' };
  }

  if (!valid) return { ok: false, reason: 'INVALID_QR' };

  let payload: BoardingTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return { ok: false, reason: 'INVALID_QR' };
  }

  if (!payload.bid || !payload.ref || !payload.exp) {
    return { ok: false, reason: 'INVALID_QR' };
  }

  // Expiry is checked after the signature: an expired token that was never
  // authentic is simply invalid, and saying "expired" would confirm we issued it.
  if (Math.floor(Date.now() / 1000) > payload.exp) {
    return { ok: false, reason: 'QR_EXPIRED' };
  }

  return { ok: true, payload };
}
