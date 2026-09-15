/**
 * The notification feed.
 *
 * Everything here was written by the server when something actually happened —
 * a payment cleared, a ticket was scanned, an ID was reviewed. The app cannot
 * create a notification, so nothing in this list is a guess about what probably
 * happened.
 *
 * Tapping one marks it read and goes where it is about. A notification that
 * leads nowhere is left un-tappable rather than bouncing the reader to a list
 * they were already looking at.
 */

import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import {
  Bell,
  BellRing,
  CircleAlert,
  Gift,
  Receipt,
  TicketCheck,
  TriangleAlert,
} from 'lucide-react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { NotificationType } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationSubscription,
  useNotifications,
} from '@/hooks/use-notifications';
import { notificationTarget, type AppNotification } from '@/services/notification-service';
import { timeAgo } from '@/utils/datetime';

/** An icon per kind, so the feed is scannable without reading every line. */
const ICONS: Record<NotificationType, { icon: typeof Bell; color: string }> = {
  [NotificationType.BOOKING_CONFIRMED]: { icon: TicketCheck, color: Colors.success },
  [NotificationType.PAYMENT_CONFIRMED]: { icon: Receipt, color: Colors.success },
  [NotificationType.TRIP_REMINDER]: { icon: BellRing, color: Colors.info },
  [NotificationType.TRIP_DELAY]: { icon: TriangleAlert, color: Colors.warning },
  [NotificationType.TRIP_CANCELLED]: { icon: TriangleAlert, color: Colors.danger },
  [NotificationType.BOARDING]: { icon: TicketCheck, color: Colors.primary },
  [NotificationType.SOS]: { icon: CircleAlert, color: Colors.danger },
  [NotificationType.REWARD]: { icon: Gift, color: Colors.secondary },
  [NotificationType.SYSTEM]: { icon: Bell, color: Colors.textMuted },
};

function NotificationRow({
  notification,
  onPress,
}: {
  notification: AppNotification;
  onPress: (notification: AppNotification) => void;
}) {
  const unread = notification.readAt === null;
  const { icon: Icon, color } = ICONS[notification.type] ?? ICONS[NotificationType.SYSTEM];
  const goes = notificationTarget(notification) !== null;

  return (
    <Pressable
      accessibilityRole={goes ? 'button' : undefined}
      accessibilityLabel={`${notification.title}. ${notification.message}${unread ? '. Unread' : ''}`}
      disabled={!goes && !unread}
      onPress={() => onPress(notification)}>
      <Card className={unread ? 'gap-2 border-primary/30 bg-primary-soft/40' : 'gap-2'}>
        <View className="flex-row items-start gap-3">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-surface">
            <Icon size={18} color={color} />
          </View>

          <View className="flex-1 gap-0.5">
            <View className="flex-row items-center gap-2">
              <Text variant="bodyStrong" className="flex-1">
                {notification.title}
              </Text>
              {/* A dot AND the word, never colour alone. */}
              {unread ? (
                <View className="flex-row items-center gap-1">
                  <View className="h-2 w-2 rounded-full bg-primary" />
                  <Text variant="caption" tone="primary">
                    New
                  </Text>
                </View>
              ) : null}
            </View>

            <Text variant="body" tone="muted">
              {notification.message}
            </Text>
            <Text variant="caption" tone="muted">
              {timeAgo(notification.createdAt)}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const feed = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  // A payment confirmed on another device should land here without a refresh.
  useNotificationSubscription();

  const unread = (feed.data ?? []).filter((n) => n.readAt === null).length;

  function open(notification: AppNotification) {
    if (notification.readAt === null) markRead.mutate(notification.id);

    const target = notificationTarget(notification);
    if (!target) return;
    router.push(
      target.params
        ? ({ pathname: target.pathname, params: target.params } as never)
        : (target.pathname as never),
    );
  }

  return (
    <Screen scroll>
      <Header
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : undefined}
        showBack
        fallbackHref="/home"
      />

      {feed.isPending ? (
        <Loading label="Loading your notifications…" />
      ) : feed.isError ? (
        <ErrorState
          message="We could not load your notifications. Check your connection and try again."
          onRetry={() => feed.refetch()}
        />
      ) : (feed.data ?? []).length === 0 ? (
        <EmptyState
          title="Nothing yet"
          message="Booking confirmations, payments, boarding and trip updates arrive here."
          icon={<Bell size={28} color={Colors.textMuted} />}
        />
      ) : (
        <View className="gap-3">
          {unread > 0 ? (
            <Button
              label="Mark all as read"
              variant="outline"
              size="sm"
              loading={markAllRead.isPending}
              onPress={() => markAllRead.mutate()}
            />
          ) : null}

          {(feed.data ?? []).map((notification) => (
            <NotificationRow key={notification.id} notification={notification} onPress={open} />
          ))}
        </View>
      )}
    </Screen>
  );
}
