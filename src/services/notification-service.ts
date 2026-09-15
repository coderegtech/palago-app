/**
 * The notification feed.
 *
 * Rows are written server-side by the functions that actually change something —
 * payment, boarding, loyalty, SOS, discount review, counter sales. The app never
 * creates one: `notifications` has no client INSERT policy, and the only column
 * a client may write is `read_at`, on its own rows. So this module reads a feed
 * and marks things read; it cannot invent an event that did not happen.
 */

import { NotificationType } from '@/constants/enums';
import { toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { UUID } from '@/types/models';

export interface AppNotification {
  id: UUID;
  type: NotificationType;
  title: string;
  message: string;
  /** Whatever the writing function attached — a booking id, a reward, an alert. */
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

const COLUMNS = 'id, type, title, message, data, read_at, created_at';

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    data: row.data,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/**
 * Where tapping a notification should go, or null when there is nowhere useful.
 *
 * Pure and exported so it can be tested without a database: a notification that
 * silently goes nowhere is the kind of thing nobody notices until a passenger
 * taps "Payment received" and lands on the same list they were already reading.
 */
export function notificationTarget(
  notification: Pick<AppNotification, 'type' | 'data'>,
): { pathname: string; params?: Record<string, string> } | null {
  const bookingId = typeof notification.data?.bookingId === 'string' ? notification.data.bookingId : null;

  switch (notification.type) {
    case NotificationType.BOOKING_CONFIRMED:
    case NotificationType.PAYMENT_CONFIRMED:
    case NotificationType.BOARDING:
    case NotificationType.TRIP_REMINDER:
    case NotificationType.TRIP_DELAY:
    case NotificationType.TRIP_CANCELLED:
      return bookingId
        ? { pathname: '/bookings/[id]', params: { id: bookingId } }
        : { pathname: '/bookings' };
    case NotificationType.REWARD:
      return { pathname: '/rewards' };
    case NotificationType.SOS:
      return { pathname: '/sos' };
    case NotificationType.SYSTEM:
      // Discount reviews are the only SYSTEM notifications so far, and they are
      // about a document the passenger uploaded.
      return notification.data?.eligibilityId ? { pathname: '/discount' } : null;
    default:
      return null;
  }
}

export const notificationService = {
  async list(limit = 50): Promise<AppNotification[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw toAppError(error);
    return (data as NotificationRow[]).map(toNotification);
  },

  /** Counted server-side rather than from a fetched page, which would undercount. */
  async unreadCount(): Promise<number> {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);

    if (error) throw toAppError(error);
    return count ?? 0;
  },

  async markRead(id: UUID): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .is('read_at', null);

    if (error) throw toAppError(error);
  },

  async markAllRead(): Promise<void> {
    // No user filter needed: the policy already limits this to the caller's own
    // rows, and adding one here would be a second copy of that rule.
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null);

    if (error) throw toAppError(error);
  },
};
