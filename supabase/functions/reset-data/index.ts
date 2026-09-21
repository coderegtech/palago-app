/**
 * reset-data
 *
 * Empties the application's data for the move from demo to real use. The
 * decisions all live in SQL — `reset_application_data` checks the caller is a
 * SUPER_ADMIN, checks the typed confirmation phrase, and does every delete in
 * one transaction, so a failure rolls the whole reset back.
 *
 * This function exists for the one part SQL cannot do: the discount ID
 * photographs in the private `discount-proofs` bucket. Deleting a Storage
 * *row* in SQL leaves the file itself behind, and a government ID sitting in a
 * bucket after its record is gone is precisely what a reset must not leave.
 * So the SQL returns the paths, and this removes the files through the Storage
 * API once the database has committed.
 *
 * Two clients, the same split as manage-staff:
 *
 *   `asCaller`  — anon key + the caller's Authorization. The reset runs as the
 *                 caller, so `is_admin()` is asked of the real signed-in
 *                 person, never of this function.
 *   `asService` — service role, used ONLY to remove Storage objects. It never
 *                 touches an application table.
 *
 * Order matters and is not reversible: database first, files second. If the
 * file removal fails after the database has committed, the reset has still
 * happened — the response says so, names how many files were left, and the
 * failure is logged loudly for someone to clear by hand. The reverse order
 * would risk deleting ID photographs for a reset that then rolled back.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { fail, failFromRpc, handleOptions, ok, serve } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';

const PROOF_BUCKET = 'discount-proofs';
const PASSENGER_PROOF_BUCKET = 'passenger-proofs';
/** Storage `remove` takes a batch; keep each call comfortably small. */
const REMOVE_BATCH = 100;

interface Body {
  action?: 'preview' | 'reset';
  confirmation?: string;
}

interface ResetResult {
  deleted: Record<string, number>;
  proofPaths: string[];
  resetAt: string;
}

serve('reset-data', async (request) => {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return fail('VALIDATION_ERROR', 'Use POST.', 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return fail('UNAUTHORIZED');

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return fail('VALIDATION_ERROR', 'Expected a JSON body.');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const asCaller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });

  // -------------------------------------------------------------------------
  // preview — what would go, and what would stay
  // -------------------------------------------------------------------------
  if (body.action === 'preview') {
    const { data, error } = await asCaller.rpc('data_reset_preview');
    if (error) return failFromRpc(error);
    return ok(data);
  }

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------
  if (body.action === 'reset') {
    const { data, error } = await asCaller.rpc('reset_application_data', {
      p_confirmation: body.confirmation ?? '',
    });
    // Refused, or failed and rolled back: nothing has changed, files included.
    if (error) return failFromRpc(error);

    const result = data as ResetResult;

    // Every passenger ID photo, attached to a booking or left behind by an
    // abandoned checkout. Listed after the commit, as the admin: the bookings
    // that pointed at them are already gone.
    const { data: passengerPaths, error: listError } = await asCaller.rpc('passenger_proof_objects');
    if (listError) {
      log.error('passenger_proofs_not_listed_after_reset', { committed: true, message: listError.message });
    }

    const asService = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Government IDs, both buckets. The database reset has committed and cannot
    // be undone from here, so a file that will not delete is reported, loudly,
    // rather than folded into a clean success.
    async function removeAll(bucket: string, paths: string[]) {
      let removed = 0;
      const failed: string[] = [];
      for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
        const batch = paths.slice(i, i + REMOVE_BATCH);
        const { data: gone, error: removeError } = await asService.storage.from(bucket).remove(batch);
        if (removeError) failed.push(...batch);
        else removed += gone?.length ?? 0;
      }
      if (failed.length > 0) {
        log.error('proof_files_not_removed_after_reset', {
          committed: true,
          bucket,
          count: failed.length,
          paths: failed,
          action: 'delete these files by hand',
        });
      }
      return { removed, failed: failed.length };
    }

    const accountProofs = await removeAll(PROOF_BUCKET, result.proofPaths ?? []);
    const passengerProofs = await removeAll(
      PASSENGER_PROOF_BUCKET,
      (passengerPaths as string[] | null) ?? [],
    );
    const filesRemoved = accountProofs.removed + passengerProofs.removed;
    const filesFailedCount =
      accountProofs.failed + passengerProofs.failed + (listError ? 1 : 0);

    return ok({
      deleted: result.deleted,
      resetAt: result.resetAt,
      proofFiles: { removed: filesRemoved, failed: filesFailedCount },
    });
  }

  return fail('VALIDATION_ERROR', 'Unknown action.');
});
