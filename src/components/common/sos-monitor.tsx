/**
 * Open emergency alerts, for anyone who may respond to them — the operator
 * console, the driver's duty screen and the admin overview all render this.
 *
 * It used to live inside the operator dashboard only, and showed a pair of
 * coordinates. A driver on the very coach, and the admins who alone can see an
 * alert raised before boarding, had no screen for it at all, and nobody could
 * tell who was in trouble or how to reach them. Now each alert says who, how
 * to call them, which trip and coach, and where on a map.
 *
 * Scoped by the database, not here: `sos_incident_details` returns only the
 * incidents `can_manage_sos` lets the caller act on. A filter in this file
 * would be a second copy of that rule.
 */

import { CheckCircle, CircleAlert, Clock, MapPin, Phone, Bus as BusIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { SOSStatus } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import {
  useAcknowledgeSOS,
  useActiveSOSIncidents,
  useRespondSOS,
  useResolveSOS,
  useSOSSubscription,
} from '@/hooks/use-sos';
import { AppError } from '@/lib/errors';
import type { SOSResponderIncident } from '@/services/sos-service';
import { useUIStore } from '@/stores/ui-store';
import { formatTimestamp, timeAgo } from '@/utils/datetime';

/** Status as a word plus a tone — never colour alone. */
const statusPresentation: Record<SOSStatus, { label: string; tone: BadgeTone }> = {
  [SOSStatus.ACTIVE]: { label: 'New', tone: 'danger' },
  [SOSStatus.ACKNOWLEDGED]: { label: 'Acknowledged', tone: 'warning' },
  [SOSStatus.RESPONDING]: { label: 'Responding', tone: 'info' },
  [SOSStatus.RESOLVED]: { label: 'Resolved', tone: 'success' },
  [SOSStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
};

/** A map link any phone or browser opens — no map SDK needed on web. */
export function sosMapUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

export function sosCallUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

interface SOSMonitorProps {
  /** Shown under "No open emergency alerts". */
  emptyHint?: string;
}

export function SOSMonitor({
  emptyHint = 'Alerts raised on your trips appear here as they happen.',
}: SOSMonitorProps) {
  const incidents = useActiveSOSIncidents();
  const acknowledge = useAcknowledgeSOS();
  const respond = useRespondSOS();
  const resolve = useResolveSOS();
  const showToast = useUIStore((state) => state.showToast);

  // Realtime as well as the hook's polling: an emergency console that missed an
  // alert because a websocket dropped is worse than one that refetches often.
  useSOSSubscription();

  const [resolving, setResolving] = useState<SOSResponderIncident | null>(null);
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

  function open(url: string) {
    Linking.openURL(url).catch(() =>
      showToast({ tone: 'danger', title: 'Could not open that on this device' }),
    );
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

  const list = incidents.data ?? [];

  if (list.length === 0) {
    return (
      <Card className="flex-row items-center gap-3 border-success/40 bg-success-soft">
        <CheckCircle size={20} color={Colors.success} />
        <View className="flex-1">
          <Text variant="bodyStrong">No open emergency alerts</Text>
          <Text variant="caption" tone="muted">
            {emptyHint}
          </Text>
        </View>
      </Card>
    );
  }

  // Which incident each in-flight action belongs to, so one alert's spinner
  // does not spin on every alert's button.
  const acking = acknowledge.isPending ? acknowledge.variables : null;
  const responding = respond.isPending ? respond.variables : null;

  return (
    <>
      <Card className="gap-3 border-danger/40">
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-row items-center gap-2">
            <CircleAlert size={20} color={Colors.danger} />
            <Text variant="bodyStrong">Emergency alerts</Text>
          </View>
          <Badge label={`${list.length} open`} tone="danger" />
        </View>

        <Divider />

        <View className="gap-3">
          {list.map((incident) => (
            <View key={incident.id} className="gap-2 rounded-xl bg-danger-soft/40 p-3">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-1">
                  <Text variant="bodyStrong">{incident.passengerName}</Text>
                  <View className="flex-row items-center gap-2">
                    <BusIcon size={12} color={Colors.textMuted} />
                    <Text variant="caption" tone="muted">
                      {incident.tripNumber
                        ? [incident.tripNumber, incident.busNumber, incident.routeLabel]
                            .filter(Boolean)
                            .join(' · ')
                        : 'Not on a trip — no operator to route this to'}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <MapPin size={12} color={Colors.textMuted} />
                    <Text variant="caption" tone="muted">
                      {incident.latitude.toFixed(5)}, {incident.longitude.toFixed(5)}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Clock size={12} color={Colors.textMuted} />
                    <Text variant="caption" tone="muted">
                      Raised {timeAgo(incident.createdAt)} · {formatTimestamp(incident.createdAt)}
                    </Text>
                  </View>
                </View>
                <Badge
                  label={statusPresentation[incident.status].label}
                  tone={statusPresentation[incident.status].tone}
                />
              </View>

              {/* One strong action — calling the passenger — and the rest as
                  outlines sized to their labels, so five actions wrap into a
                  row instead of stacking into a wall of full-width buttons. */}
              <View className="flex-row flex-wrap gap-2">
                {incident.passengerPhone ? (
                  <Button
                    label="Call passenger"
                    size="sm"
                    fullWidth={false}
                    icon={<Phone size={14} color={Colors.textInverse} />}
                    onPress={() => open(sosCallUrl(incident.passengerPhone as string))}
                    accessibilityLabel={`Call ${incident.passengerName} on ${incident.passengerPhone}`}
                  />
                ) : null}
                <Button
                  label="Open map"
                  size="sm"
                    fullWidth={false}
                  variant="outline"
                  onPress={() => open(sosMapUrl(incident.latitude, incident.longitude))}
                  accessibilityLabel="Open the passenger's location in a map"
                />
                {incident.status === SOSStatus.ACTIVE ? (
                  <Button
                    label="Acknowledge"
                    size="sm"
                    fullWidth={false}
                    variant="outline"
                    loading={acking === incident.id}
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
                    fullWidth={false}
                    variant="outline"
                    loading={responding === incident.id}
                    onPress={() =>
                      void run(() => respond.mutateAsync(incident.id), 'Marked as responding')
                    }
                    accessibilityLabel="Mark a responder as on the way"
                  />
                ) : null}
                <Button
                  label="Resolve"
                  size="sm"
                    fullWidth={false}
                  variant="outline"
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
        Android and web it does nothing at all, so the responder would tap
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
