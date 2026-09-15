/**
 * Registering this device for push, and handling a tap on one.
 *
 * Mounted once inside the signed-in tree. It is deliberately quiet: if push is
 * unavailable — web, a simulator, Expo Go on Android, permission refused — it
 * does nothing and says nothing here. The settings screen is where that is
 * explained, because there it is an answer to a question the person asked.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { notificationTarget } from '@/services/notification-service';
import { pushService } from '@/services/push-service';
import type { NotificationType } from '@/constants/enums';
import { notificationKeys } from './use-notifications';
import { useAuth } from './use-auth';

export const pushKeys = {
  permission: ['push', 'permission'] as const,
};

/** Whether this device may show push, for the settings screen. */
export function usePushPermission() {
  const { isAuthenticated } = useAuth();

  return useQuery({
    queryKey: pushKeys.permission,
    queryFn: () => pushService.permission(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

/** The explicit "turn these on" action. Returns why, when it could not. */
export function useEnablePush() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => pushService.register(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pushKeys.permission });
    },
  });
}

/**
 * Registers on sign-in and routes a tapped notification.
 *
 * Registration is attempted once per signed-in user rather than on every
 * render: the token itself is stable, but `getExpoPushTokenAsync` is a network
 * call, and `register_push_token` is a write.
 *
 * Note it re-registers for each new user id. That is the point — the row moves
 * to whoever is signed in now, so a shared handset does not deliver one
 * passenger's trip to another.
 */
export function usePushRegistration(): void {
  const { userId, isAuthenticated } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !userId || registeredFor.current === userId) return;
    registeredFor.current = userId;

    pushService.register().catch((error) => {
      // Not being able to register is not a reason to interrupt someone who was
      // trying to book a bus.
      console.warn('Push registration failed:', error);
    });
  }, [isAuthenticated, userId]);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Arriving while the app is open: the banner is shown by the handler in
    // push-service, and the feed and bell need to catch up.
    const received = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    });

    // Tapped. The payload carries the same fields the feed routes on, so a
    // tapped push and a tapped row land in the same place.
    const responded = Notifications.addNotificationResponseReceivedListener((event) => {
      const data = event.notification.request.content.data as Record<string, unknown> | undefined;
      if (!data?.type) return;

      const target = notificationTarget({
        type: data.type as NotificationType,
        data,
      });
      if (!target) return;

      router.push(
        target.params
          ? ({ pathname: target.pathname, params: target.params } as never)
          : (target.pathname as never),
      );
    });

    return () => {
      received.remove();
      responded.remove();
    };
  }, [isAuthenticated, queryClient, router]);
}
