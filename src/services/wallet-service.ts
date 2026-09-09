/**
 * The mock wallet's data access.
 *
 * Reads come straight from `wallets` and `wallet_transactions`, both restricted
 * by RLS to the caller's own rows. Writes do not exist: there is no client path
 * to a balance or a ledger entry, because the two must move together under one
 * lock. Everything that changes money goes through a SECURITY DEFINER RPC.
 *
 * Every centavo here is test money. PalaGo charges nothing real — the UI must
 * say so wherever a figure appears.
 */

import { fromRpcError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { WalletTransactionType } from '@/constants/enums';
import type { Centavos, UUID } from '@/types/models';

export interface WalletSummary {
  id: UUID;
  balance: Centavos;
  currency: string;
  updatedAt: string;
}

export interface WalletEntry {
  id: UUID;
  type: WalletTransactionType;
  /** Signed: credits positive, debits negative. Sums to the balance. */
  amount: Centavos;
  balanceAfter: Centavos;
  reference: string | null;
  description: string | null;
  bookingId: UUID | null;
  createdAt: string;
}

export interface TopUpResult {
  alreadyApplied: boolean;
  transactionId: UUID;
  amount: Centavos;
  balance: Centavos;
  currency: string;
}

export interface WalletPaymentResult {
  alreadyPaid: boolean;
  bookingReference: string;
  bookingStatus: string;
  paymentReference: string;
  receiptNumber: string;
  amount: Centavos;
  currency: string;
  walletBalance: Centavos;
}

export const walletService = {
  /**
   * The caller's wallet.
   *
   * `maybeSingle`, not `single`: a wallet is created by trigger with the
   * profile, but a caller whose profile has just been deleted would otherwise
   * meet a hard error instead of an empty state.
   */
  async getWallet(): Promise<WalletSummary | null> {
    const { data, error } = await supabase
      .from('wallets')
      .select('id, balance, currency, updated_at')
      .maybeSingle();

    if (error) throw toAppError(error);
    if (!data) return null;

    return {
      id: data.id,
      balance: data.balance,
      currency: data.currency,
      updatedAt: data.updated_at,
    };
  },

  async listTransactions(limit = 50): Promise<WalletEntry[]> {
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('id, type, amount, balance_after, reference, description, booking_id, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw toAppError(error);

    return (data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      amount: row.amount,
      balanceAfter: row.balance_after,
      reference: row.reference,
      description: row.description,
      bookingId: row.booking_id,
      createdAt: row.created_at,
    }));
  },

  /**
   * Add test money.
   *
   * `idempotencyKey` is generated per attempt by the caller so a retry after a
   * dropped response credits once. Without it a flaky connection is a way to
   * mint balance by tapping twice.
   */
  async topUp(amount: Centavos, idempotencyKey: string): Promise<TopUpResult> {
    const { data, error } = await supabase.rpc('top_up_wallet', {
      p_amount: amount,
      p_idempotency_key: idempotencyKey,
    });

    if (error) throw fromRpcError(error);
    return data as unknown as TopUpResult;
  },

  /**
   * Pay a booking from the balance.
   *
   * Only the booking id is sent. The server re-derives the amount from the
   * booking, so there is no request shape in which a client names a price.
   */
  async payBooking(bookingId: UUID): Promise<WalletPaymentResult> {
    const { data, error } = await supabase.rpc('pay_booking_with_wallet', {
      p_booking_id: bookingId,
    });

    if (error) throw fromRpcError(error);
    return data as unknown as WalletPaymentResult;
  },
};
