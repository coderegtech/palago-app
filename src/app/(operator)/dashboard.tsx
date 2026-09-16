import { ObserveInteractiveMarker } from 'expo-observe';
import {
  Bus as BusIcon,
  CalendarDays,
  CheckCircle,
  CircleAlert,
  Banknote,
  Clock,
  IdCard,
  MapPin,
  TicketCheck,
  TrendingUp,
  Users,
} from 'lucide-react-native';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { SOSStatus } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { usePendingDiscountReviews } from '@/hooks/use-discount';
import { useOperatorDashboard } from '@/hooks/use-operator';
import {
  useAcknowledgeSOS,
  useActiveSOSIncidents,
  useRespondSOS,
  useResolveSOS,
  useSOSSubscription,
} from '@/hooks/use-sos';
import { AppError } from '@/lib/errors';
import type { SOSIncident } from '@/services/sos-service';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/utils/cn';
import { formatDate, formatDateShort, todayISO } from '@/utils/datetime';
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

/** Status as a word plus a tone — never colour alone. */
const sosStatusPresentation: Record<SOSStatus, { label: string; tone: BadgeTone }> = {
  [SOSStatus.ACTIVE]: { label: 'New', tone: 'danger' },
  [SOSStatus.ACKNOWLEDGED]: { label: 'Acknowledged', tone: 'warning' },
  [SOSStatus.RESPONDING]: { label: 'Responding', tone: 'info' },
  [SOSStatus.RESOLVED]: { label: 'Resolved', tone: 'success' },
  [SOSStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
};

/**
 * Open emergency alerts for this operator's trips.
 *
 * Scoped by RLS, not by a filter here: `sos_incidents` returns only the alerts
 * raised on trips this operator runs (plus the caller's own). A caller-side
 * filter would be a second copy of that rule, which is exactly how a rival's
 * data leaked twice in Phase 7.
 *
 * When nothing is open this says so plainly — which is honest now in a way an
 * "0 alerts" tile was not before Phase 11. The monitor is real, so a quiet one
 * means quiet.
 */
/**
 * How many discount claims are waiting.
 *
 * Shows a count rather than the queue itself: the documents are government IDs,
 * and a dashboard is glanced at over someone's shoulder. Opening one is a
 * deliberate act on its own screen.
 */
function DiscountQueueTile() {
  const router = useRouter();
  const pending = usePendingDiscountReviews();

  if (pending.isPending || pending.isError) return null;

  const waiting = pending.data?.length ?? 0;

  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-3">
        <IdCard size={20} color={Colors.primary} />
        <View className="flex-1">
          <Text variant="bodyStrong">
            {waiting === 0
              ? 'No discount claims waiting'
              : `${waiting} discount claim${waiting === 1 ? '' : 's'} waiting`}
          </Text>
          <Text variant="caption" tone="muted">
            Senior, student and PWD IDs. Approving one sets 20% off a seat on every booking that
            passenger makes.
          </Text>
        </View>
      </View>

      {waiting > 0 ? (
        <Button
          label="Review claims"
          variant="secondary"
          onPress={() => router.push('/discount-review')}
          accessibilityLabel="Review waiting discount claims"
        />
      ) : null}
    </Card>
  );
}

function SOSMonitoring() {
  const incidents = useActiveSOSIncidents();
  const acknowledge = useAcknowledgeSOS();
  const respond = useRespondSOS();
  const resolve = useResolveSOS();
  const showToast = useUIStore((state) => state.showToast);

  // Realtime as well as the hook's polling: an emergency console that missed an
  // alert because a websocket dropped is worse than one that refetches often.
  useSOSSubscription();

  const [resolving, setResolving] = useState<SOSIncident | null>(null);
  const [note, setNote] = useState('');

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      showToast({ tone: 'success', title: success });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'That did not go through',
        message: error instanceof AppError ? error.message : undefined,
      });
    }
  }

  async function onResolve() {
    if (!resolving) return;
    const incident = resolving;
    setResolving(null);
    await run(
      () => resolve.mutateAsync({ sosId: incident.id, notes: note.trim() || null }),
      'Alert resolved',
    );
    setNote('');
  }

  if (incidents.isLoading) return <Skeleton className="h-20" />;

  if (incidents.isError) {
    return (
      <ErrorState
        message="We could not load emergency alerts."
        onRetry={() => void incidents.refetch()}
      />
    );
  }

  const open = incidents.data ?? [];

  if (open.length === 0) {
    return (
      <Card className="flex-row items-center gap-3 border-success/40 bg-success-soft">
        <CheckCircle size={20} color={Colors.success} />
        <View className="flex-1">
          <Text variant="bodyStrong">No open emergency alerts</Text>
          <Text variant="caption" tone="muted">
            Alerts raised on your trips appear here as they happen.
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <>
      <Card className="gap-3 border-danger/40">
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-row items-center gap-2">
            <CircleAlert size={20} color={Colors.danger} />
            <Text variant="bodyStrong">Emergency alerts</Text>
          </View>
          <Badge label={`${open.length} open`} tone="danger" />
        </View>

        <Divider />

        <View className="gap-3">
          {open.map((incident) => (
            <View key={incident.id} className="gap-2 rounded-xl bg-danger-soft/40 p-3">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-1">
                  <View className="flex-row items-center gap-2">
                    <MapPin size={14} color={Colors.text} />
                    <Text variant="bodyStrong">
                      {incident.latitude.toFixed(4)}, {incident.longitude.toFixed(4)}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Clock size={12} color={Colors.textMuted} />
                    <Text variant="caption" tone="muted">
                      Raised {formatDate(incident.createdAt)}
                    </Text>
                  </View>
                </View>
                <Badge
                  label={sosStatusPresentation[incident.status].label}
                  tone={sosStatusPresentation[incident.status].tone}
                />
              </View>

              <View className="flex-row flex-wrap gap-2">
                {incident.status === SOSStatus.ACTIVE ? (
                  <Button
                    label="Acknowledge"
                    size="sm"
                    variant="secondary"
                    loading={acknowledge.isPending}
                    onPress={() =>
                      void run(() => acknowledge.mutateAsync(incident.id), 'Alert acknowledged')
                    }
                    accessibilityLabel="Acknowledge this alert"
                  />
                ) : null}

                {incident.status !== SOSStatus.RESPONDING ? (
                  <Button
                    label="Responding"
                    size="sm"
                    variant="secondary"
                    loading={respond.isPending}
                    onPress={() =>
                      void run(() => respond.mutateAsync(incident.id), 'Marked as responding')
                    }
                    accessibilityLabel="Mark a responder as on the way"
                  />
                ) : null}

                <Button
                  label="Resolve"
                  size="sm"
                  onPress={() => {
                    setNote('');
                    setResolving(incident);
                  }}
                  accessibilityLabel="Resolve this alert"
                />
              </View>
            </View>
          ))}
        </View>
      </Card>

      {/*
        A note field rather than `Alert.prompt`, which exists only on iOS — on
        Android and web it does nothing at all, so the operator would tap
        Resolve and watch nothing happen.
      */}
      <Modal
        visible={resolving !== null}
        onClose={() => setResolving(null)}
        title="Resolve alert"
        dismissOnBackdropPress={false}>
        <View className="gap-3">
          <Text variant="caption" tone="muted">
            What happened? The note is kept with the incident and shown to the passenger.
          </Text>
          <Input
            value={note}
            onChangeText={setNote}
            placeholder="Optional note"
            multiline
            accessibilityLabel="Resolution note"
          />
          <Button label="Mark resolved" onPress={() => void onResolve()} loading={resolve.isPending} />
          <Button label="Cancel" variant="ghost" onPress={() => setResolving(null)} />
        </View>
      </Modal>
    </>
  );
}

interface ManagementLinkProps {
  label: string;
  hint: string;
  icon: React.ReactNode;
  href: Href;
}

function ManagementLink({ label, hint, icon, href }: ManagementLinkProps) {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${hint}`}
      onPress={() => router.push(href)}
      className="min-w-[30%] flex-1">
      <Card className="h-full gap-2 active:bg-primary-soft">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
          {icon}
        </View>
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      </Card>
    </Pressable>
  );
}

export default function OperatorDashboardScreen() {
  const router = useRouter();
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
        {/* An operator lands here on a cold start; TTI is when the figures resolve. */}
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
                icon={<BusIcon size={18} color={Colors.primary} />}
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
                  {(dashboard.data?.crew?.availableDrivers ?? 0) +
                    (dashboard.data?.crew?.availableAssistants ?? 0)}
                </Text>
                {/* Available for a trip, which is not the same as able to sign
                    in — somebody on a rest day is one and not the other. */}
                <Text variant="caption" tone="muted">
                  available: {dashboard.data?.crew?.availableDrivers ?? 0} of{' '}
                  {dashboard.data?.crew?.drivers ?? 0} drivers,{' '}
                  {dashboard.data?.crew?.availableAssistants ?? 0} of{' '}
                  {dashboard.data?.crew?.assistants ?? 0} crew
                </Text>
              </Card>
            </View>

            {/*
              The management screens. Not tabs: the bar is already at five,
              which is the most that stays legible on a phone, and these are
              visited to set something up rather than during a shift.
            */}
            <View className="flex-row flex-wrap gap-3">
              <ManagementLink
                label="Schedule"
                hint="Departures, coaches and crew"
                icon={<CalendarDays size={18} color={Colors.primary} />}
                href="/(operator)/trips"
              />
              <ManagementLink
                label="Fleet"
                hint="Buses and RoRo coaches"
                icon={<BusIcon size={18} color={Colors.primary} />}
                href="/(operator)/buses"
              />
              <ManagementLink
                label="Crew"
                hint="Conductors and assistants"
                icon={<Users size={18} color={Colors.primary} />}
                href="/(operator)/crew"
              />
            </View>

            {/* SOS Monitoring - Phase 11 */}
            <SOSMonitoring />

            <DiscountQueueTile />

            <Card className="gap-3">
              <View className="flex-row items-center gap-3">
                <Banknote size={20} color={Colors.primary} />
                <View className="flex-1">
                  <Text variant="bodyStrong">Sell at the counter</Text>
                  <Text variant="caption" tone="muted">
                    Book a passenger who has no smartphone, take the fare in cash, and issue a
                    ticket.
                  </Text>
                </View>
              </View>
              <Button
                label="Counter sale"
                variant="secondary"
                onPress={() => router.push('/assisted-booking')}
                accessibilityLabel="Sell a ticket at the counter"
              />
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
