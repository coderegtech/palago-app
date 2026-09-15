/**
 * The notification feed, wrapped in TanStack Query.
 *
 * The subscription is filtered to the signed-in user's own rows. That filter is
 * a bandwidth decision, not a security one — RLS already stops anyone receiving
 * somebody else's notification — but subscribing every client to every insert
 * on the table would be exactly the "unnecessary realtime" the spec warns about.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { supabase } from '@/lib/supabase';
import { notificationService } from '@/services/notification-service';
import type { AppNotification } from '@/services/notification-service';
import type { UUID } from '@/types/models';
import { useAuth } from './use-auth';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
};

export function useNotifications() {
  const { isAuthenticated } = useAuth();

  return useQuery<AppNotification[]>({
    queryKey: notificationKeys.list,
    queryFn: () => notificationService.list(),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
}

/** Just the count, for the bell. */
export function useUnreadCount() {
  const { isAuthenticated } = useAuth();

  return useQuery<number>({
    queryKey: notificationKeys.unread,
    queryFn: () => notificationService.unreadCount(),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, UUID>({
    mutationFn: (id) => notificationService.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, void>({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/**
 * Refresh the feed when a notification arrives for this user.
 *
 * Mounted by the notifications screen and by the home screen's bell, so a
 * payment confirmed on the public web page shows up without a pull-to-refresh.
 */
export function useNotificationSubscription() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
