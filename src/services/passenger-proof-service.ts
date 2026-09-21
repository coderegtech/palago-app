/**
 * ID photos for individual passengers on a booking.
 *
 * Different from `discount-service`, which verifies the ACCOUNT holder once for
 * all their future bookings. This is for the passenger on one booking — often
 * not the person booking: Person A books for Person B, a student, and attaches
 * B's school ID. The photo is uploaded before the booking is made, and
 * `create_booking` checks it is the caller's own upload and an image before it
 * discounts that passenger's line. The crew check the real card at the door.
 *
 * The bucket is private. Photos are read only through short-lived signed URLs,
 * and storage policy lets only the uploader, the booking, the trip's crew, the
 * operator's managers and admins read one — it is a government ID.
 */

import { ErrorCode } from '@/constants/errors';
import { AppError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { discountService, type PickedProof } from '@/services/discount-service';

export const PASSENGER_PROOF_BUCKET = 'passenger-proofs';
const MAX_BYTES = 5 * 1024 * 1024;

export interface UploadedPassengerProof {
  /** Stored on the passenger line; what `create_booking` checks. */
  path: string;
  /** A local preview for the form — never the stored document. */
  previewUri: string;
}

export const passengerProofService = {
  /** Ask for the photo. Null when the user backs out. Validated like account proofs. */
  pick(): Promise<PickedProof | null> {
    return discountService.pickProof();
  },

  async upload(proof: PickedProof): Promise<UploadedPassengerProof> {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new AppError(ErrorCode.UNAUTHORIZED);

    const bytes = await (await fetch(proof.uri)).arrayBuffer();
    if (bytes.byteLength === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'That photo is empty. Choose another.');
    }
    if (bytes.byteLength > MAX_BYTES) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'That photo is larger than 5 MB. Take a smaller one, or reduce the quality.',
      );
    }

    // The folder is the uploader's id: the storage policy and the booking
    // function both require it, so nobody can attach someone else's upload.
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${proof.extension}`;
    const path = `${auth.user.id}/${name}`;

    const { error } = await supabase.storage
      .from(PASSENGER_PROOF_BUCKET)
      .upload(path, bytes, { contentType: proof.mimeType, upsert: false });
    if (error) throw toAppError(error);

    return { path, previewUri: proof.uri };
  },

  /** A 5-minute link to view one, for the crew at the door or the booking's owner. */
  async signedUrl(path: string): Promise<string> {
    const { data, error } = await supabase.storage
      .from(PASSENGER_PROOF_BUCKET)
      .createSignedUrl(path, 300);
    if (error || !data?.signedUrl) throw toAppError(error ?? new Error('No signed URL'));
    return data.signedUrl;
  },
};
