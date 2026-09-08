/**
 * Money helpers.
 *
 * All amounts in PalaGo are integer centavos. These helpers are for display and
 * for converting at the edges (user input, seed data). Never use them to decide
 * what a booking costs — the server computes and verifies every total.
 */

import { CURRENCY_SYMBOL } from '@/constants/config';
import type { Centavos } from '@/types/models';

/** ₱450.00 → 45000 */
export function pesosToCentavos(pesos: number): Centavos {
  return Math.round(pesos * 100);
}

/** 45000 → 450 */
export function centavosToPesos(centavos: Centavos): number {
  return centavos / 100;
}

/** 45000 → "₱450.00" */
export function formatMoney(centavos: Centavos, options?: { symbol?: boolean }): string {
  const showSymbol = options?.symbol ?? true;
  const formatted = new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centavosToPesos(centavos));

  return showSymbol ? `${CURRENCY_SYMBOL}${formatted}` : formatted;
}
