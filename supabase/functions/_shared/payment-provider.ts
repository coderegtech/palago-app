/**
 * The provider-agnostic payment layer.
 *
 * PalaGo talks to this interface, never to a payment company. Today the only
 * implementation is `MockPaymentProvider`, which moves no money — "paying" is a
 * state transition confirmed from a web page.
 *
 * Everything around it is real: the payment record, the server-side validation,
 * the receipt, the audit entry, the notification, the Realtime update. That is
 * the point. Adding Stripe, GCash or Maya later means writing one more
 * implementation of this interface and changing which one is selected — not
 * touching the booking system. See docs/payment-flow.md.
 */

export type ProviderName = 'MOCK' | 'STRIPE' | 'GCASH' | 'MAYA';

export interface CreatePaymentInput {
  bookingId: string;
  /** Centavos. Computed by the database from the trip fare, never by a client. */
  amount: number;
  currency: string;
  reference: string;
  /** Bearer secret that authorises the public payment page. */
  token: string;
}

export interface CreatePaymentOutput {
  /** Where the payer completes the payment. Encoded into the payment QR. */
  paymentUrl: string;
  /** Anything provider-specific worth keeping on the payment record. */
  metadata: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: ProviderName;

  /**
   * Begin a payment. A real provider would call its API here and return the
   * hosted checkout URL it issued.
   */
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentOutput>;

  /**
   * Whether this provider accepts confirmation from the payer's own browser.
   *
   * The mock provider does — that is the whole test flow. **Real providers must
   * return false**: a payment is only confirmed by a signed webhook from the
   * provider, because a request from the payer's browser proves nothing about
   * whether money moved.
   */
  readonly acceptsClientConfirmation: boolean;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name: ProviderName = 'MOCK';
  readonly acceptsClientConfirmation = true;

  constructor(private readonly webBaseUrl: string) {}

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentOutput> {
    // No network call, no funds. The URL is the PalaGo test payment page; the
    // token travels in the query string so the page can authorise itself
    // without a session.
    const url = new URL(`/payment/${encodeURIComponent(input.reference)}`, this.webBaseUrl);
    url.searchParams.set('t', input.token);

    return Promise.resolve({
      paymentUrl: url.toString(),
      metadata: {
        provider: 'MOCK',
        note: 'Test payment. No real money is charged and no provider is contacted.',
      },
    });
  }
}

/**
 * Selects the provider for this deployment.
 *
 * Throws for anything but `mock`, rather than silently falling back: a
 * misconfigured environment must not quietly behave as if it were in test mode
 * — or, worse, appear to be live when nothing is wired.
 */
export function resolveProvider(name: string | undefined, webBaseUrl: string): PaymentProvider {
  const requested = (name ?? 'mock').toLowerCase();

  if (requested !== 'mock') {
    throw new Error(
      `PAYMENT_PROVIDER="${requested}" is not implemented. This build is mock-only; ` +
        'see docs/payment-flow.md for how to add a real provider.',
    );
  }

  return new MockPaymentProvider(webBaseUrl);
}
