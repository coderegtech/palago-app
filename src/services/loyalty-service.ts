/**
 * Loyalty data access.
 *
 * Points are earned server-side when a trip completes — there is no "award
 * points" call here and there must never be one. The client can read a balance
 * and spend it on a reward; it cannot create points, and it cannot say what a
 * reward is worth.
 */

import { fromRpcError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { DiscountType, LoyaltyTransactionType, OperatorStatus } from '@/constants/enums';
import type { Centavos, UUID } from '@/types/models';

export interface LoyaltySummary {
  pointsBalance: number;
  /** Only ever grows. Spending points does not undo having earned them. */
  lifetimePoints: number;
}

export interface LoyaltyEntry {
  id: UUID;
  type: LoyaltyTransactionType;
  /** Signed: credits positive, debits negative. Sums to the balance. */
  points: number;
  balanceAfter: number;
  reference: string | null;
  description: string | null;
  bookingId: UUID | null;
  createdAt: string;
}

export interface RewardOption {
  id: UUID;
  code: string;
  name: string;
  description: string | null;
  pointsRequired: number;
  discountType: DiscountType;
  /** Centavos for FIXED, basis points for PERCENTAGE. */
  discountValue: number;
  maxDiscount: Centavos | null;
  status: OperatorStatus;
}

export interface RedemptionResult {
  bookingId: UUID;
  bookingReference: string;
  rewardCode: string;
  rewardName: string;
  pointsUsed: number;
  pointsBalance: number;
  discount: Centavos;
  subtotal: Centavos;
  totalAmount: Centavos;
}

export const loyaltyService = {
  async getSummary(): Promise<LoyaltySummary | null> {
    const { data, error } = await supabase
      .from('loyalty_accounts')
      .select('points_balance, lifetime_points')
      .maybeSingle();

    if (error) throw toAppError(error);
    if (!data) return null;

    return { pointsBalance: data.points_balance, lifetimePoints: data.lifetime_points };
  },

  async listTransactions(limit = 50): Promise<LoyaltyEntry[]> {
    const { data, error } = await supabase
      .from('loyalty_transactions')
      .select('id, type, points, balance_after, reference, description, booking_id, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw toAppError(error);

    return (data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      points: row.points,
      balanceAfter: row.balance_after,
      reference: row.reference,
      description: row.description,
      bookingId: row.booking_id,
      createdAt: row.created_at,
    }));
  },

  /** The catalogue, cheapest first, so a saver sees the nearest goal. */
  async listRewards(): Promise<RewardOption[]> {
    const { data, error } = await supabase
      .from('rewards')
      .select('id, code, name, description, points_required, discount_type, discount_value, max_discount, status')
      .eq('status', 'ACTIVE')
      .order('points_required');

    if (error) throw toAppError(error);

    return (data ?? []).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      pointsRequired: row.points_required,
      discountType: row.discount_type,
      discountValue: row.discount_value,
      maxDiscount: row.max_discount,
      status: row.status,
    }));
  },

  /**
   * Apply a reward to a booking.
   *
   * Only two ids cross the wire. The discount is computed from the reward row
   * server-side, capped at the fare, and written together with the new total —
   * so there is no request shape in which a client asks for money off.
   */
  async redeem(bookingId: UUID, rewardId: UUID): Promise<RedemptionResult> {
    const { data, error } = await supabase.rpc('redeem_reward', {
      p_booking_id: bookingId,
      p_reward_id: rewardId,
    });

    if (error) throw fromRpcError(error);
    return data as unknown as RedemptionResult;
  },

  async cancelRedemption(bookingId: UUID) {
    const { data, error } = await supabase.rpc('cancel_reward_redemption', {
      p_booking_id: bookingId,
    });

    if (error) throw fromRpcError(error);
    return data as unknown as {
      bookingId: UUID;
      pointsReturned: number;
      totalAmount: Centavos;
    };
  },
};
