import { ObserveInteractiveMarker } from 'expo-observe';
import { Bus, Building2, MapPin, Route, TicketCheck, TrendingUp, Users } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { SignOutButton } from '@/components/common/sign-out-button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { AdminContentMaxWidth, Colors } from '@/constants/theme';
import { useAdminDashboard } from '@/hooks/use-admin';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { cn } from '@/utils/cn';
import { formatDateShort, todayISO } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

function StatTile({
  icon,
  label,
  value,
  hint,
  tone = 'primary',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'primary' | 'success' | 'warning' | 'info';
}) {
  const bg = {
    primary: 'bg-primary-soft',
    success: 'bg-success-soft',
    warning: 'bg-warning-soft',
    info: 'bg-info-soft',
  }[tone];

  return (
    // A pixel minimum rather than a percentage, so the row reflows on its own:
    // two tiles across on a phone, four on a desktop, without a breakpoint.
    <Card className="min-w-[180px] flex-1 gap-2">
      <View className={cn('h-9 w-9 items-center justify-center rounded-full', bg)}>{icon}</View>
      <Text variant="display" className="text-[24px] leading-[28px]">
        {value}
      </Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" tone="muted" className="text-[10px]">
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

function CountRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <View className="flex-row items-center gap-2">
      {icon}
      <Text variant="caption" tone="muted" className="flex-1">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

export default function AdminOverviewScreen() {
  const today = todayISO();
  const dashboard = useAdminDashboard(today);
  const isDesktop = useIsDesktop();

  return (
    <Screen padded={false} maxWidth={AdminContentMaxWidth} edges={['left', 'right']}>
      <ScrollView contentContainerClassName="px-4 pb-8 gap-4" showsVerticalScrollIndicator={false}>
        <Header title="Platform overview" subtitle={`All operators · ${formatDateShort(today)}`} />
        {/* An admin lands here on a cold start; TTI is when the figures resolve. */}
        {!dashboard.isPending && <ObserveInteractiveMarker />}

        {dashboard.isPending ? (
          <View className="gap-3">
            <View className="flex-row gap-3">
              <Skeleton className="h-28 flex-1" />
              <Skeleton className="h-28 flex-1" />
            </View>
            <View className="flex-row gap-3">
              <Skeleton className="h-28 flex-1" />
              <Skeleton className="h-28 flex-1" />
            </View>
          </View>
        ) : dashboard.isError ? (
          <ErrorState
            message="Could not load platform figures."
            onRetry={() => void dashboard.refetch()}
          />
        ) : (
          <>
            <View className="flex-row flex-wrap gap-3">
              <StatTile
                icon={<Bus size={18} color={Colors.primary} />}
                label="Trips today"
                value={String(dashboard.data.today.trips)}
              />
              <StatTile
                icon={<Users size={18} color={Colors.info} />}
                label="Passengers booked"
                value={String(dashboard.data.today.passengers)}
                tone="info"
              />
              <StatTile
                icon={<TicketCheck size={18} color={Colors.success} />}
                label="Boarded"
                value={`${dashboard.data.today.boarded}/${dashboard.data.today.passengers}`}
                tone="success"
              />
              <StatTile
                icon={<TrendingUp size={18} color={Colors.warning} />}
                label="Revenue today"
                value={formatMoney(dashboard.data.today.revenue)}
                tone="warning"
              />
            </View>

            <Card className="gap-3">
              <Text variant="label" tone="muted">
                Today across all operators
              </Text>
              <View className="flex-row flex-wrap gap-x-4 gap-y-2">
                <View className="flex-row items-center gap-1.5">
                  <Badge label={String(dashboard.data.today.scheduled)} tone="neutral" />
                  <Text variant="caption" tone="muted">
                    Scheduled
                  </Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <Badge label={String(dashboard.data.today.boarding)} tone="warning" />
                  <Text variant="caption" tone="muted">
                    Boarding
                  </Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <Badge label={String(dashboard.data.today.inTransit)} tone="info" />
                  <Text variant="caption" tone="muted">
                    In transit
                  </Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <Badge label={String(dashboard.data.today.completed)} tone="success" />
                  <Text variant="caption" tone="muted">
                    Completed
                  </Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <Badge label={String(dashboard.data.today.cancelled)} tone="danger" />
                  <Text variant="caption" tone="muted">
                    Cancelled
                  </Text>
                </View>
              </View>

              <Divider />

              {/*
                Null until something has actually departed. An undeparted day
                showing 100% on time would be an invented figure.
              */}
              {dashboard.data.today.onTime === null ? (
                <Text variant="caption" tone="muted">
                  On-time performance appears once a trip has departed. Nothing is estimated before
                  then.
                </Text>
              ) : (
                <View className="flex-row items-end justify-between">
                  <Text variant="display" className="text-[24px] leading-[28px]">
                    {dashboard.data.today.onTime}%
                  </Text>
                  <Text variant="caption" tone="muted">
                    on time · {dashboard.data.today.departed} of {dashboard.data.today.trips}{' '}
                    departed, within {dashboard.data.today.onTimeGraceMinutes} min
                  </Text>
                </View>
              )}
            </Card>

            <Card className="gap-3">
              <Text variant="label" tone="muted">
                Platform
              </Text>
              <CountRow
                icon={<Building2 size={14} color={Colors.textMuted} />}
                label={`Operators (${dashboard.data.platform.activeOperators} active)`}
                value={dashboard.data.platform.operators}
              />
              <CountRow
                icon={<MapPin size={14} color={Colors.textMuted} />}
                label="Terminals"
                value={dashboard.data.platform.terminals}
              />
              <CountRow
                icon={<Route size={14} color={Colors.textMuted} />}
                label="Routes"
                value={dashboard.data.platform.routes}
              />
              <CountRow
                icon={<Bus size={14} color={Colors.textMuted} />}
                label={`Buses (${dashboard.data.platform.activeBuses} active)`}
                value={dashboard.data.platform.buses}
              />
              <CountRow
                icon={<Users size={14} color={Colors.textMuted} />}
                label="Crew (drivers + assistants)"
                value={dashboard.data.platform.drivers + dashboard.data.platform.assistants}
              />
              <CountRow
                icon={<Users size={14} color={Colors.textMuted} />}
                label="Passenger accounts"
                value={dashboard.data.platform.passengerAccounts}
              />

              <Divider />

              <View className="flex-row items-center justify-between">
                <Text variant="caption" tone="muted">
                  Bookings all time
                </Text>
                <Text variant="bodyStrong">{dashboard.data.platform.bookingsAllTime}</Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text variant="caption" tone="muted">
                  Revenue all time
                </Text>
                <Text variant="bodyStrong">
                  {formatMoney(dashboard.data.platform.revenueAllTime)}
                </Text>
              </View>
            </Card>

            <View className="gap-2">
              <Text variant="label" tone="muted">
                By operator, today
              </Text>

              <DataTable
                embedded
                minWidth={860}
                data={dashboard.data.operators}
                keyExtractor={(operator) => operator.id}
                empty={
                  <EmptyState
                    title="No operators yet"
                    message="Add one from the Operators tab to see it here."
                  />
                }
                columns={[
                  {
                    key: 'operator',
                    header: 'Operator',
                    flex: 2,
                    primary: true,
                    cell: (row) => (
                      <View className="gap-0.5">
                        <Text variant="bodyStrong">{row.name}</Text>
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                          {row.code} · {row.buses} buses · {row.routes} routes · {row.drivers}{' '}
                          drivers
                        </Text>
                      </View>
                    ),
                  },
                  {
                    key: 'trips',
                    header: 'Trips',
                    width: 70,
                    cell: (row) => <Text variant="bodyStrong">{row.trips}</Text>,
                  },
                  {
                    key: 'passengers',
                    header: 'Passengers',
                    width: 110,
                    cell: (row) => <Text variant="bodyStrong">{row.passengers}</Text>,
                  },
                  {
                    key: 'boarded',
                    header: 'Boarded',
                    width: 100,
                    cell: (row) => (
                      <Text variant="bodyStrong">
                        {row.boarded}/{row.passengers}
                      </Text>
                    ),
                  },
                  {
                    key: 'seats',
                    header: 'Seats filled',
                    width: 110,
                    cell: (row) => (
                      <Text variant="bodyStrong">
                        {row.capacity ? Math.round((row.seatsBooked / row.capacity) * 100) : 0}%
                      </Text>
                    ),
                  },
                  {
                    key: 'revenue',
                    header: 'Revenue',
                    width: 120,
                    align: 'right',
                    cell: (row) => <Text variant="bodyStrong">{formatMoney(row.revenue)}</Text>,
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    width: 96,
                    align: 'right',
                    cell: (row) => (
                      <Badge
                        label={row.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                        tone={row.status === 'ACTIVE' ? 'success' : 'neutral'}
                      />
                    ),
                  },
                ]}
              />
            </View>

            {/*
              Only below the sidebar breakpoint. On desktop this lives in the
              sidebar footer where a dashboard's account controls belong; the
              bottom bar has no room for it, so it surfaces here instead. The
              console has no Account tab because `account.tsx` would resolve to
              the same `/account` as the operator console's and collide.
            */}
            {isDesktop ? null : <SignOutButton className="mt-2" />}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
