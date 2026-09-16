/**
 * Selling a seat at a counter.
 *
 * The passenger in front of the clerk may have no smartphone and no account, so
 * a counter booking belongs to the trip rather than to a login: `walkIn` leaves
 * it ownerless and records the clerk instead. Staff pick the seat here, which is
 * the one place seat choice is allowed — passengers never choose.
 *
 * Cash is the only payment in this build that corresponds to real money. The
 * server records who took it; the app only reports what the server decided, and
 * has no way to mark anything paid itself.
 */

import { ErrorCode } from '@/constants/errors';
import { AppError, fromRpcError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Centavos, UUID } from '@/types/models';
import type { PassengerType } from '@/constants/enums';

/** Matches `public.payment_method`. */
export type PaymentMethod =
  | 'CASH'
  | 'TEST_GCASH'
  | 'TEST_MAYA'
  | 'TEST_CARD'
  | 'TEST_BANK'
  | 'TEST_WALLET';

/** Matches `public.booking_source`. */
export type BookingSource = 'MOBILE_APP' | 'WEB' | 'OPERATOR' | 'TERMINAL';

/**
 * What the clerk can take at the counter, in the order they are offered.
 *
 * `TEST_WALLET` is deliberately absent: a wallet belongs to an account holder
 * and is theirs to spend, so the server refuses it here. A passenger pays from
 * their own wallet, signed in as themselves.
 */
/**
 * What the clerk sees, and what it actually is.
 *
 * The labels are the real-world names a passenger would say out loud — nobody
 * at a counter asks to pay by "Test GCash". `real` is what decides behaviour,
 * and only CASH is true: everything else is simulated and moves no money.
 *
 * That distinction is NOT left to the label. Choosing a simulated method raises
 * "TEST PAYMENT — NO REAL MONEY WILL BE CHARGED" on the screen before the clerk
 * can confirm, and CASH raises a different warning naming the amount, because
 * the tap is the record that notes changed hands. Removing either of those
 * warnings is what would make a simulated receipt indistinguishable from a real
 * one — the names alone never were the safeguard.
 */
export const COUNTER_METHODS: { value: PaymentMethod; label: string; real: boolean }[] = [
  { value: 'CASH', label: 'Cash', real: true },
  { value: 'TEST_GCASH', label: 'GCash', real: false },
  { value: 'TEST_MAYA', label: 'Maya', real: false },
  { value: 'TEST_CARD', label: 'Card', real: false },
  { value: 'TEST_BANK', label: 'Bank transfer', real: false },
];

export interface CounterPassengerInput {
  name: string;
  phone?: string;
  /** Optional, like the app's own form. `create_booking` already stores it. */
  email?: string;
  type: PassengerType;
}

export interface CounterSale {
  bookingId: UUID;
  reference: string;
  totalAmount: Centavos;
  seatCount: number;
}

export interface CounterPaymentResult {
  bookingId: UUID;
  reference: string;
  status: string;
  alreadyPaid: boolean;
  method: PaymentMethod;
  amount: Centavos;
  receiptNumber: string;
  paidAt: string;
}

export const counterService = {
  /**
   * The operator's own name, for the printed ticket's header.
   *
   * Read from `trip_search` because `operator_trip_overview` does not carry it
   * and reshaping a view for one label on one ticket is the wrong trade.
   */
  async operatorNameForTrip(tripId: UUID): Promise<string> {
    const { data, error } = await supabase
      .from('trip_search')
      .select('operator_name')
      .eq('id', tripId)
      .maybeSingle();

    if (error) throw fromRpcError(error);
    return data?.operator_name ?? '';
  },

  /**
   * Open a counter booking and hold the chosen seats. Not paid yet: the fare is
   * taken in a separate, deliberate step, the way it happens at a counter.
   */
  async sell(input: {
    tripId: UUID;
    passengers: CounterPassengerInput[];
    seatIds: UUID[];
    source: BookingSource;
  }): Promise<CounterSale> {
    if (input.seatIds.length !== input.passengers.length) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Choose one seat for each passenger.',
      );
    }

    const { data, error } = await supabase.rpc('create_booking', {
      p_trip_id: input.tripId,
      p_passengers: input.passengers.map((p) => ({
        name: p.name.trim(),
        phone: p.phone?.trim() || null,
        // Was hard-coded null while the counter form had no email field. It has
        // one now — the app's own — and `create_booking` has always read this key.
        email: p.email?.trim() || null,
        type: p.type,
      })),
      p_seat_ids: input.seatIds,
      p_walk_in: true,
      p_source: input.source,
      p_ticket_type: 'PRINTED',
    });

    if (error) throw fromRpcError(error);
    return data as unknown as CounterSale;
  },

  /**
   * Record that the fare was received. Idempotent: pressing it twice returns
   * the first receipt rather than taking the money again.
   */
  async takePayment(bookingId: UUID, method: PaymentMethod): Promise<CounterPaymentResult> {
    const { data, error } = await supabase.rpc('record_counter_payment', {
      p_booking_id: bookingId,
      p_method: method,
    });

    if (error) throw fromRpcError(error);
    return data as unknown as CounterPaymentResult;
  },
};
