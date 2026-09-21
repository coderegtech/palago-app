/**
 * An estimate of what `create_booking` will charge, for the one screen that
 * must show an amount before the server has priced anything: the counter,
 * where a clerk confirms cash in hand before the sale is recorded.
 *
 * It follows the server's rule exactly —
 *
 *   fare × passengers
 *   − 20% of the fare for each senior/student/PWD line with an ID photo
 *     (plus one line of the booker's own verified kind, when there is one)
 *   + the ₱10 convenience fee
 *
 * — and the counter still compares it with the server's total before taking
 * the money, so a drift between the two stops the sale instead of recording
 * the wrong amount. Everywhere else shows the server's own figures.
 */

import { CONVENIENCE_FEE_CENTAVOS, DISCOUNT_RATE_BPS } from '@/constants/config';
import type { DiscountKind } from '@/services/discount-service';
import type { Centavos } from '@/types/models';
import { requiresIdPhoto } from '@/utils/passenger-proof';

interface Line {
  type: string;
  proofPath?: string | null;
}

export interface PriceEstimate {
  subtotal: Centavos;
  discount: Centavos;
  loyaltyDiscount: Centavos;
  convenienceFee: Centavos;
  totalAmount: Centavos;
}

export function discountPerLine(fare: Centavos): Centavos {
  // `round()` in SQL rounds half away from zero; Math.round does too for
  // positives, which fares always are.
  return Math.round((fare * DISCOUNT_RATE_BPS) / 10_000);
}

export function estimateBookingPrice(
  fare: Centavos,
  passengers: readonly Line[],
  verifiedKind: DiscountKind | null = null,
): PriceEstimate {
  let accountLineUsed = false;
  let discountedLines = 0;

  for (const p of passengers) {
    if (p.proofPath && requiresIdPhoto(p.type)) {
      discountedLines += 1;
    } else if (!accountLineUsed && verifiedKind && p.type === verifiedKind && !p.proofPath) {
      accountLineUsed = true;
      discountedLines += 1;
    }
  }

  const subtotal = fare * passengers.length;
  const discount = discountedLines * discountPerLine(fare);
  const convenienceFee = CONVENIENCE_FEE_CENTAVOS;

  return {
    subtotal,
    discount,
    loyaltyDiscount: 0,
    convenienceFee,
    totalAmount: subtotal - discount + convenienceFee,
  };
}
