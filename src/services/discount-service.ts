/**
 * Verified fare discounts — senior, student and PWD.
 *
 * Two halves that must not be confused:
 *
 *   * **The document** goes to the private `discount-proofs` bucket, into a
 *     folder named for the caller. A storage policy pins the first path segment
 *     to `auth.uid()`, so a client cannot write into anyone else's folder even
 *     if it builds the path itself.
 *   * **The claim** is a row written only by `submit_discount_proof`. There is
 *     no client INSERT on `discount_eligibilities`, and approving is an
 *     operator-only RPC — a passenger cannot approve their own ID.
 *
 * Nothing here computes a price. The discount is applied server-side inside
 * `reserve_seats`, from the approved row; the app only ever displays what the
 * server already decided.
 */

import * as ImagePicker from 'expo-image-picker';

import { ErrorCode } from '@/constants/errors';
import { AppError, fromRpcError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { UUID } from '@/types/models';

export const PROOF_BUCKET = 'discount-proofs';

/** Matches `public.discount_kind`. */
export type DiscountKind = 'SENIOR' | 'STUDENT' | 'PWD';

/** Matches `public.eligibility_status`. */
export type EligibilityStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';

export interface DiscountEligibility {
  id: UUID;
  userId: UUID;
  kind: DiscountKind;
  status: EligibilityStatus;
  proofPath: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  expiresAt: string | null;
}

interface EligibilityRow {
  id: string;
  user_id: string;
  kind: DiscountKind;
  status: EligibilityStatus;
  proof_path: string;
  submitted_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  expires_at: string | null;
}

const COLUMNS =
  'id, user_id, kind, status, proof_path, submitted_at, reviewed_at, review_note, expires_at';

function toEligibility(row: EligibilityRow): DiscountEligibility {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    status: row.status,
    proofPath: row.proof_path,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    expiresAt: row.expires_at,
  };
}

/** What a passenger sees on the fare line, and what the operator reviews. */
export const DISCOUNT_LABELS: Record<DiscountKind, string> = {
  SENIOR: 'Senior citizen',
  STUDENT: 'Student',
  PWD: 'Person with disability',
};

/** The document each kind is verified against. Shown before the picker opens. */
export const PROOF_HINTS: Record<DiscountKind, string> = {
  SENIOR: 'Senior Citizen ID, or a government ID showing your date of birth.',
  STUDENT: 'Current school ID, validated for this term.',
  PWD: 'PWD ID issued by your city or municipality.',
};

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

export interface PickedProof {
  uri: string;
  mimeType: string;
  /** Extension without the dot, derived from the MIME type, not the filename. */
  extension: string;
}

export const discountService = {
  /**
   * Ask for a photo of the ID.
   *
   * Returns null when the passenger backs out, which is not an error — they
   * simply proceed at the ordinary fare.
   */
  async pickProof(): Promise<PickedProof | null> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'PalaGo needs access to your photos to attach a copy of your ID.',
      );
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
      // The reviewer has to read an ID number off this. Stripping EXIF keeps
      // the location the photo was taken out of a document we are storing.
      exif: false,
    });

    if (result.canceled || !result.assets?.length) return null;

    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? 'image/jpeg';

    if (!ALLOWED_MIME.includes(mimeType)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'That file type is not accepted. Use a JPEG, PNG or WebP photo.',
      );
    }

    if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_BYTES) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'That photo is larger than 5 MB. Take a smaller one, or reduce the quality.',
      );
    }

    return {
      uri: asset.uri,
      mimeType,
      extension: mimeType.split('/')[1] ?? 'jpg',
    };
  },

  /**
   * Upload the document, then record the claim.
   *
   * Order matters: the object exists before the row that points at it, so a
   * reviewer never opens a claim whose image is missing. The reverse failure —
   * an uploaded file with no row — leaves an unreferenced object in the
   * passenger's own folder, which is inert and cheap.
   */
  async submit(kind: DiscountKind, proof: PickedProof): Promise<DiscountEligibility> {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new AppError(ErrorCode.UNAUTHORIZED);

    // Path is namespaced by user id because the storage policy requires it.
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${proof.extension}`;
    const proofPath = `${auth.user.id}/${name}`;

    // React Native has no File; fetching the local URI yields the bytes.
    const bytes = await (await fetch(proof.uri)).arrayBuffer();

    if (bytes.byteLength > MAX_BYTES) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'That photo is larger than 5 MB. Take a smaller one, or reduce the quality.',
      );
    }

    const upload = await supabase.storage
      .from(PROOF_BUCKET)
      .upload(proofPath, bytes, { contentType: proof.mimeType, upsert: false });

    if (upload.error) throw toAppError(upload.error);

    const { data, error } = await supabase.rpc('submit_discount_proof', {
      p_kind: kind,
      p_proof_path: proofPath,
    });

    if (error) throw fromRpcError(error);

    const created = data as unknown as { id: string };
    const row = await this.getById(created.id);
    if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR);
    return row;
  },

  /** The caller's own submissions, newest first. */
  async listMine(): Promise<DiscountEligibility[]> {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new AppError(ErrorCode.UNAUTHORIZED);

    const { data, error } = await supabase
      .from('discount_eligibilities')
      .select(COLUMNS)
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false });

    if (error) throw toAppError(error);
    return (data as EligibilityRow[]).map(toEligibility);
  },

  async getById(id: UUID): Promise<DiscountEligibility | null> {
    const { data, error } = await supabase
      .from('discount_eligibilities')
      .select(COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) throw toAppError(error);
    return data ? toEligibility(data as EligibilityRow) : null;
  },

  /**
   * What the caller is verified as right now, or null.
   *
   * Asked of the server rather than derived from `listMine`, so the expiry rule
   * lives in exactly one place.
   */
  async activeKind(): Promise<DiscountKind | null> {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;

    const { data, error } = await supabase.rpc('active_discount_kind', {
      p_user_id: auth.user.id,
    });

    if (error) throw fromRpcError(error);
    return (data as DiscountKind | null) ?? null;
  },

  /** The reviewer queue. RLS returns rows only to operators and admins. */
  async listPending(): Promise<DiscountEligibility[]> {
    const { data, error } = await supabase
      .from('discount_eligibilities')
      .select(COLUMNS)
      .eq('status', 'PENDING')
      .order('submitted_at', { ascending: true });

    if (error) throw toAppError(error);
    return (data as EligibilityRow[]).map(toEligibility);
  },

  /**
   * A short-lived link to the ID image.
   *
   * Signed, never public: the bucket serves nothing over the public route, so
   * this is the only way a reviewer sees the document, and the link stops
   * working shortly after.
   */
  async proofUrl(proofPath: string, expiresInSeconds = 120): Promise<string> {
    const { data, error } = await supabase.storage
      .from(PROOF_BUCKET)
      .createSignedUrl(proofPath, expiresInSeconds);

    if (error) throw toAppError(error);
    return data.signedUrl;
  },

  /** Approve or reject. Operator/admin only — enforced server-side. */
  async review(
    id: UUID,
    approve: boolean,
    options: { note?: string; expiresAt?: string } = {},
  ): Promise<void> {
    const { error } = await supabase.rpc('review_discount_eligibility', {
      p_id: id,
      p_approve: approve,
      p_note: options.note ?? undefined,
      p_expires_at: options.expiresAt ?? undefined,
    });

    if (error) throw fromRpcError(error);
  },
};
