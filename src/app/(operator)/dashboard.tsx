import { ScrollView, View } from 'react-native';
import { Bus, CircleAlert, TicketCheck, TrendingUp, Users } from 'lucide-react-native';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useOperatorDashboard } from '@/hooks/use-operator';
import { cn } from '@/utils/cn';
import { formatDateShort, todayISO } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

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
    <Card className="min-w-[46%] flex-1 gap-2">
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

function StatusPill({ label, count, tone }: { label: string; count: number; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Badge label={String(count)} tone={tone} />
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

export default function OperatorDashboardScreen() {
  const { profile } = useAuth();
  const today = todayISO();
  const dashboard = useOperatorDashboard(today);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerClassName="px-4 pb-8 gap-4" showsVerticalScrollIndicator={false}>
        <Header
          title={`${greeting()}, Operator`}
          subtitle={`${profile?.fullName ?? ''} · ${formatDateShort(today)}`}
        />

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
            message="Could not load today's figures."
            onRetry={() => dashboard.refetch()}
          />
        ) : dashboard.data?.scope === 'NO_OPERATOR' ? (
          <Alert
            tone="info"
            title="No operator linked to this account"
            message="This console shows one operator's own trips. An admin account is not tied to an operator, so there is nothing to show here."
          />
        ) : (
          <>
            <View className="flex-row flex-wrap gap-3">
              <StatTile
                icon={<Bus size={18} color={Colors.primary} />}
                label="Trips today"
                value={String(dashboard.data?.today?.trips ?? 0)}
              />
              <StatTile
                icon={<Users size={18} color={Colors.info} />}
                label="Passengers booked"
                value={String(dashboard.data?.today?.passengers ?? 0)}
                tone="info"
              />
              <StatTile
                icon={<TicketCheck size={18} color={Colors.success} />}
                label="Boarded"
                value={`${dashboard.data?.today?.boarded ?? 0}/${dashboard.data?.today?.passengers ?? 0}`}
                tone="success"
              />
              <StatTile
                icon={<TrendingUp size={18} color={Colors.warning} />}
                label="Revenue today"
                value={formatMoney(dashboard.data?.today?.revenue ?? 0)}
                tone="warning"
              />
            </View>

            <Card className="gap-3">
              <Text variant="label" tone="muted">
                Today&apos;s operations
              </Text>
              <View className="flex-row flex-wrap gap-x-4 gap-y-2">
                <StatusPill label="Scheduled" count={dashboard.data?.today?.scheduled ?? 0} tone="neutral" />
                <StatusPill label="Boarding" count={dashboard.data?.today?.boarding ?? 0} tone="warning" />
                <StatusPill label="In transit" count={dashboard.data?.today?.inTransit ?? 0} tone="info" />
                <StatusPill label="Completed" count={dashboard.data?.today?.completed ?? 0} tone="success" />
                <StatusPill label="Cancelled" count={dashboard.data?.today?.cancelled ?? 0} tone="danger" />
              </View>

              {(dashboard.data?.today?.unassigned ?? 0) > 0 ? (
                <Alert
                  tone="warning"
                  title={`${dashboard.data?.today?.unassigned} trip(s) have no driver`}
                  message="Assign crew before departure."
                />
              ) : null}

              {/*
                Real, as of Phase 8: `trips.actual_departure_at` is stamped when
                a driver starts a trip, so this compares two recorded times.
                Trips that have not departed are excluded from the average
                rather than counted as punctual.
              */}
              <Divider />
              {dashboard.data?.today?.onTime === null ||
              dashboard.data?.today?.onTime === undefined ? (
                <Text variant="caption" tone="muted">
                  On-time performance appears once a trip has departed. Nothing is estimated before
                  then.
                </Text>
              ) : (
                <View className="gap-1.5">
                  <View className="flex-row items-end justify-between">
                    <Text variant="display" className="text-[24px] leading-[28px]">
                      {dashboard.data.today.onTime}%
                    </Text>
                    <Text variant="caption" tone="muted">
                      on time · {dashboard.data.today.departed} of{' '}
                      {dashboard.data.today.trips} departed
                    </Text>
                  </View>
                  <Text variant="caption" tone="muted">
                    Within {dashboard.data.today.onTimeGraceMinutes} minutes of schedule
                    {dashboard.data.today.avgDelayMinutes !== null
                      ? ` · average ${
                          dashboard.data.today.avgDelayMinutes >= 0
                            ? `${dashboard.data.today.avgDelayMinutes} min late`
                            : `${Math.abs(dashboard.data.today.avgDelayMinutes)} min early`
                        }`
                      : ''}
                  </Text>
                </View>
              )}
            </Card>

            <Card className="gap-3">
              <Text variant="label" tone="muted">
                Seat utilisation today
              </Text>
              <View className="flex-row items-end justify-between">
                <Text variant="display" className="text-[24px] leading-[28px]">
                  {dashboard.data?.today?.capacity
                    ? Math.round(
                        ((dashboard.data.today.seatsBooked ?? 0) /
                          dashboard.data.today.capacity) *
                          100,
                      )
                    : 0}
                  %
                </Text>
                <Text variant="caption" tone="muted">
                  {dashboard.data?.today?.seatsBooked ?? 0} of{' '}
                  {dashboard.data?.today?.capacity ?? 0} seats
                </Text>
              </View>
              <View className="h-2 overflow-hidden rounded-full bg-border">
                <View
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${
                      dashboard.data?.today?.capacity
                        ? Math.min(
                            100,
                            ((dashboard.data.today.seatsBooked ?? 0) /
                              dashboard.data.today.capacity) *
                              100,
                          )
                        : 0
                    }%`,
                  }}
                />
              </View>
            </Card>

            <View className="flex-row gap-3">
              <Card className="flex-1 gap-1">
                <Text variant="label" tone="muted">
                  Fleet
                </Text>
                <Text variant="subtitle">
                  {dashboard.data?.fleet?.activeBuses ?? 0}/{dashboard.data?.fleet?.buses ?? 0}
                </Text>
                <Text variant="caption" tone="muted">
                  buses active
                </Text>
              </Card>
              <Card className="flex-1 gap-1">
                <Text variant="label" tone="muted">
                  Crew
                </Text>
                <Text variant="subtitle">
                  {(dashboard.data?.crew?.activeDrivers ?? 0) +
                    (dashboard.data?.crew?.activeAssistants ?? 0)}
                </Text>
                <Text variant="caption" tone="muted">
                  {dashboard.data?.crew?.activeDrivers ?? 0} drivers ·{' '}
                  {dashboard.data?.crew?.activeAssistants ?? 0} assistants
                </Text>
              </Card>
            </View>

            {/* SOS is Phase 11. An empty "0 alerts" tile would look like a
                working monitor that happens to be quiet. */}
            <Card className="flex-row items-center gap-3 border-warning/40 bg-warning-soft">
              <CircleAlert size={20} color={Colors.warning} />
              <View className="flex-1">
                <Text variant="bodyStrong">SOS monitoring not built yet</Text>
                <Text variant="caption" tone="muted">
                  Emergency alerts arrive in Phase 11. This panel shows nothing rather than a
                  reassuring zero.
                </Text>
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
