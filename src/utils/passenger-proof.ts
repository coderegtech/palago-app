/**
 * Which passengers need an ID photo before a booking can be made.
 *
 * Mirrors `create_booking`: a SENIOR, STUDENT or PWD line is discounted when it
 * carries an uploaded ID photo, OR — for exactly one line — when the booker's
 * own account already has an approved ID of that kind. So a verified senior
 * booking for themselves is not asked for a photo again, while a senior they
 * are booking for is. The server is the authority; this only decides what the
 * form asks for, so the price shown is the price charged.
 */

import { PassengerType } from '@/constants/enums';
import type { DiscountKind } from '@/services/discount-service';

export const ID_PHOTO_TYPES: readonly PassengerType[] = [
  PassengerType.SENIOR,
  PassengerType.STUDENT,
  PassengerType.PWD,
];

export function requiresIdPhoto(type: PassengerType | string | undefined): boolean {
  return ID_PHOTO_TYPES.includes(type as PassengerType);
}

interface Line {
  type: PassengerType | string;
  proofPath?: string | null;
}

/**
 * Indexes of passengers still missing a required photo.
 *
 * @param verifiedKind the booker's own approved discount kind, if any. The
 *   first line of that kind without a photo is covered by it, as on the server.
 */
export function passengersMissingIdPhoto(
  passengers: readonly Line[],
  verifiedKind: DiscountKind | null | undefined,
): number[] {
  let accountLineUsed = false;
  const missing: number[] = [];

  passengers.forEach((p, index) => {
    if (!requiresIdPhoto(p.type) || p.proofPath) return;
    if (!accountLineUsed && verifiedKind && p.type === verifiedKind) {
      accountLineUsed = true;
      return;
    }
    missing.push(index);
  });

  return missing;
}
