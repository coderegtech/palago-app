import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import {
  Bell,
  Bus,
  CircleAlert,
  Gift,
  MapPin,
  Search,
  Ship,
  Ticket,
  Wallet,
} from 'lucide-react-native';

import { PalaGoLogo } from '@/components/common/palago-logo';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { BookingStatus } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useNotificationSubscription, useUnreadCount } from '@/hooks/use-notifications';
import { useBookings, useOperators } from '@/hooks/use-trips';
import { useWallet } from '@/hooks/use-wallet';
import { useLoyalty } from '@/hooks/use-loyalty';
import type { BookingSummary } from '@/services/booking-service';
import { cn } from '@/utils/cn';
import { formatDateShort, formatTime } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** First name only — "Good morning, Juan" reads better than the full name. */
function firstName(fullName: string | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? 'there';
}

/** Statuses that mean the trip has not happened yet. */
const UPCOMING_STATUSES: BookingStatus[] = [
  BookingStatus.PAYMENT_PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
  BookingStatus.BOARDED,
];

interface QuickActionProps {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  /** Names the phase that will build the destination, when it is not built yet. */
  phase?: string;
  tone?: 'default' | 'danger';
}

function QuickAction({ icon, label, onPress, phase, tone = 'default' }: QuickActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={phase ? `${label}, not implemented, ${phase}` : label}
      onPress={onPress}
      className="min-w-[30%] flex-1 items-center gap-2 rounded-card border border-border bg-surface p-3 active:bg-primary-soft">
      <View
        className={cn(
          'h-10 w-10 items-center justify-center rounded-full',
          tone === 'danger' ? 'bg-danger-soft' : 'bg-primary-soft',
        )}>
        {icon}
      </View>
      <Text variant="caption" className="text-center font-semibold">
        {label}
      </Text>
      {phase ? (
        <Text variant="caption" tone="muted" className="text-center text-[10px]">
          {phase}
        </Text>
      ) : null}
    </Pressable>
  );
}

function UpcomingBooking({ booking }: { booking: BookingSummary }) {
  const awaitingPayment = booking.status === BookingStatus.PAYMENT_PENDING;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Booking ${booking.reference}, ${booking.originCode} to ${booking.destinationCode}`}
      onPress={() =>
        awaitingPayment
          ? router.push({ pathname: '/booking/payment', params: { bookingId: booking.id } })
          : router.push({ pathname: '/bookings/[id]', params: { id: booking.id } })
      }>
      <Card className="gap-2 active:bg-primary-soft">
        <View className="flex-row items-center justify-between">
          <Badge label={booking.operatorName} tone="primary" />
          <Badge
            label={awaitingPayment ? 'Awaiting payment' : 'Confirmed'}
            tone={awaitingPayment ? 'warning' : 'success'}
          />
        </View>
        <Text variant="subtitle">
          {booking.originCode} to {booking.destinationCode}
        </Text>
        <View className="flex-row items-center justify-between">
          <Text variant="caption" tone="muted">
            {formatDateShort(booking.departureDate)} · {formatTime(booking.departureTime)}
          </Text>
          <Text variant="caption" tone="muted">
            {booking.seatNumbers.length > 0
              ? `Seat${booking.seatNumbers.length === 1 ? '' : 's'} ${booking.seatNumbers.join(', ')}`
              : 'Seat assigned once paid'}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

export default function HomeScreen() {
  const { profile } = useAuth();
  const operators = useOperators();
  const bookings = useBookings();
  const wallet = useWallet();
  const loyalty = useLoyalty();
  const unreadNotifications = useUnreadCount();

  // So the bell changes when something happens while this screen is open —
  // a payment confirmed on the public web page, for instance.
  useNotificationSubscription();

  const unread = unreadNotifications.data ?? 0;

  const upcoming = (bookings.data ?? [])
    .filter((booking) => UPCOMING_STATUSES.includes(booking.status))
    .sort(
      (a, b) =>
        a.departureDate.localeCompare(b.departureDate) ||
        a.departureTime.localeCompare(b.departureTime),
    )
    .slice(0, 2);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerClassName="px-4 pb-8 gap-4" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center justify-between pt-2">
          <PalaGoLogo size="md" />
          <View>
            <IconButton
              accessibilityLabel={
                unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
              }
              variant="soft"
              onPress={() => router.push('/notifications')}>
              <Bell size={18} color={Colors.primary} />
            </IconButton>
            {/* The count is also in the label above, so the badge is not the
                only way to know there is something waiting. */}
            {unread > 0 ? (
              <View
                pointerEvents="none"
                className="absolute -right-1 -top-1 h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1">
                <Text variant="caption" tone="inverse" className="text-[10px] font-semibold">
                  {unread > 9 ? '9+' : unread}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <View className="gap-0.5">
          <Text variant="title">
            {greeting()}, {firstName(profile?.fullName)}
          </Text>
          <Text variant="body" tone="muted">
            Where are you travelling today?
          </Text>
        </View>

{/* Both figures are read from the database — neither is invented. */}
        <View className="flex-row gap-3">
          <Pressable
            className="flex-1"
            accessibilityRole="button"
            accessibilityLabel="Open your wallet"
            onPress={() => router.push('/wallet')}>
            <Card className="gap-1">
              <Text variant="caption" tone="muted">
                Wallet
              </Text>
              <Text variant="subtitle">{formatMoney(wallet.data?.balance ?? 0)}</Text>
              <Text variant="caption" tone="muted" className="text-[10px]">
                Available balance
              </Text>
            </Card>
          </Pressable>

          <Pressable
            className="flex-1"
            accessibilityRole="button"
            accessibilityLabel="Open your rewards"
            onPress={() => router.push('/rewards')}>
            <Card className="gap-1">
              <Text variant="caption" tone="muted">
                Points
              </Text>
              <Text variant="subtitle">{loyalty.data?.pointsBalance ?? 0}</Text>
              <Text variant="caption" tone="muted" className="text-[10px]">
                Earned on completed trips
              </Text>
            </Card>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search trips"
          onPress={() => router.push('/booking/search')}>
          <Card className="flex-row items-center gap-3 border-primary/30 bg-primary-soft active:bg-border">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-primary">
              <Search size={18} color={Colors.textInverse} />
            </View>
            <View className="flex-1">
              <Text variant="bodyStrong">Search trips</Text>
              <Text variant="caption" tone="muted">
                Cherry Bus and RoRo Bus across Palawan
              </Text>
            </View>
          </Card>
        </Pressable>

        <View className="gap-2">
          <Text variant="label" tone="muted">
            Upcoming
          </Text>

          {bookings.isPending ? (
            <Skeleton className="h-28 w-full" />
          ) : bookings.isError ? (
            <ErrorState
              message="Could not load your bookings."
              onRetry={() => bookings.refetch()}
              className="py-4"
            />
          ) : upcoming.length === 0 ? (
            <Card className="items-center gap-1 py-6">
              <Ticket size={28} color={Colors.textMuted} />
              <Text variant="bodyStrong">No upcoming trips</Text>
              <Text variant="caption" tone="muted" className="text-center">
                Search for a trip and your ticket will appear here.
              </Text>
            </Card>
          ) : (
            <View className="gap-3">
              {upcoming.map((booking) => (
                <UpcomingBooking key={booking.id} booking={booking} />
              ))}
            </View>
          )}
        </View>

        <View className="gap-2">
          <Text variant="label" tone="muted">
            Operators
          </Text>

          {operators.isPending ? (
            <View className="flex-row gap-3">
              <Skeleton className="h-24 flex-1" />
              <Skeleton className="h-24 flex-1" />
            </View>
          ) : operators.isError ? (
            <ErrorState
              message="Could not load operators."
              onRetry={() => operators.refetch()}
              className="py-4"
            />
          ) : (
            <View className="flex-row gap-3">
              {operators.data.map((operator) => (
                <Pressable
                  key={operator.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Search ${operator.name} trips`}
                  className="flex-1"
                  onPress={() =>
                    router.push({
                      pathname: '/booking/search',
                      params: { operator: operator.code },
                    })
                  }>
                  <Card className="h-full gap-2 active:bg-primary-soft">
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
                      {operator.code === 'RORO' ? (
                        <Ship size={18} color={Colors.primary} />
                      ) : (
                        <Bus size={18} color={Colors.primary} />
                      )}
                    </View>
                    <Text variant="bodyStrong">{operator.name}</Text>
                    <Text variant="caption" tone="muted" numberOfLines={2}>
                      {operator.description ?? 'View available trips'}
                    </Text>
                  </Card>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View className="gap-2">
          <Text variant="label" tone="muted">
            Quick actions
          </Text>
          <View className="flex-row flex-wrap gap-3">
            <QuickAction
              icon={<Ticket size={18} color={Colors.primary} />}
              label="My tickets"
              onPress={() => router.push('/bookings')}
            />
            <QuickAction
              icon={<MapPin size={18} color={Colors.primary} />}
              label="Track trip"
              onPress={() => router.push('/tracking')}
            />
            <QuickAction
              icon={<Wallet size={18} color={Colors.primary} />}
              label="Wallet"
              onPress={() => router.push('/wallet')}
            />
            <QuickAction
              icon={<Gift size={18} color={Colors.primary} />}
              label="Rewards"
              onPress={() => router.push('/rewards')}
            />
            <QuickAction
              icon={<CircleAlert size={18} color={Colors.danger} />}
              label="Emergency"
              phase="Phase 11"
              tone="danger"
              onPress={() => router.push('/sos')}
            />
          </View>
        </View>

        

        {upcoming.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See all tickets"
            onPress={() => router.push('/bookings')}
            className="min-h-11 items-center justify-center">
            <Text variant="bodyStrong" tone="primary">
              See all tickets
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
