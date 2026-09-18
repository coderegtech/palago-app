/**
 * Platform-wide operations only a SUPER_ADMIN may run.
 *
 * Both calls go through the `reset-data` Edge Function, and both are decided in
 * SQL as the signed-in caller: `data_reset_preview` and
 * `reset_application_data` each check `is_admin()` themselves, and the reset
 * also checks the typed confirmation phrase. The console's dialog is a
 * courtesy; the database is the gate.
 */

import { invokeFunction } from '@/lib/functions';

/** Must be typed exactly — the database compares it, case and spacing included. */
export const RESET_CONFIRMATION_PHRASE = 'RESET DATABASE';

export interface DataResetPreview {
  delete: {
    accounts: number;
    operators: number;
    terminals: number;
    routes: number;
    buses: number;
    trips: number;
    crewRecords: number;
    rewards: number;
    bookings: number;
    payments: number;
    receipts: number;
    walletTransactions: number;
    loyaltyTransactions: number;
    rewardRedemptions: number;
    notifications: number;
    sosIncidents: number;
    boardingScans: number;
    gpsPoints: number;
    discountSubmissions: number;
  };
  /** Only SUPER_ADMIN accounts survive a reset. */
  keep: {
    superAdmins: number;
    superAdminEmails: string[];
  };
}

export interface DataResetResult {
  deleted: DataResetPreview['delete'];
  resetAt: string;
  /** ID photographs removed from Storage after the database committed. */
  proofFiles: { removed: number; failed: number };
}

export const systemService = {
  resetPreview(): Promise<DataResetPreview> {
    return invokeFunction<DataResetPreview>('reset-data', { action: 'preview' });
  },

  resetData(confirmation: string): Promise<DataResetResult> {
    return invokeFunction<DataResetResult>('reset-data', { action: 'reset', confirmation });
  },
};
