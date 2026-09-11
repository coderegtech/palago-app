import * as Location from 'expo-location';
import { CircleAlert, MapPin, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { SOSStatus } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import {
  useCancelSOS,
  useSOSSubscription,
  useTriggerSOS,
  useUserSOSHistory,
} from '@/hooks/use-sos';
import { AppError } from '@/lib/errors';
import type { SOSIncident } from '@/services/sos-service';
import { OPEN_SOS_STATUSES } from '@/services/sos-service';
import { useUIStore } from '@/stores/ui-store';
import { formatDate } from '@/utils/datetime';

/**
 * Status as a word plus a tone — never colour alone.
 *
 * RESPONDING is `info` rather than `success`: somebody is on their way, which
 * is not the same as the emergency being over.
 */
const statusPresentation: Record<SOSStatus, { label: string; tone: BadgeTone }> = {
  [SOSStatus.ACTIVE]: { label: 'Alert sent', tone: 'danger' },
  [SOSStatus.ACKNOWLEDGED]: { label: 'Seen by operator', tone: 'warning' },
  [SOSStatus.RESPONDING]: { label: 'Responder on the way', tone: 'info' },
  [SOSStatus.RESOLVED]: { label: 'Resolved', tone: 'success' },
  [SOSStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
};

/**
 * What the passenger is told while their location is being read.
 *
 * Each stage is named rather than collapsed into one spinner: "getting your
 * location" failing is a different problem from "sending" failing, and someone
 * in trouble needs to know which.
 */
type Stage = 'idle' | 'locating' | 'sending';

function IncidentRow({ incident }: { incident: SOSIncident }) {
  const presentation = statusPresentation[incident.status];
  const cancel = useCancelSOS();
  const showToast = useUIStore((state) => state.showToast);
  const cancellable =
    incident.status === SOSStatus.ACTIVE || incident.status === SOSStatus.ACKNOWLEDGED;

  async function onCancel() {
    try {
      await cancel.mutateAsync(incident.id);
      showToast({ tone: 'info', title: 'Alert cancelled' });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not cancel',
        message: error instanceof AppError ? error.message : undefined,
      });
    }
  }

  return (
    <Card className="gap-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <MapPin size={14} color={Colors.textMuted} />
            <Text variant="bodyStrong">
              {incident.latitude.toFixed(4)}, {incident.longitude.toFixed(4)}
            </Text>
          </View>
          <Text variant="caption" tone="muted">
            {formatDate(incident.createdAt)}
          </Text>
        </View>
        <Badge label={presentation.label} tone={presentation.tone} />
      </View>

      {incident.note ? (
        <Text variant="caption" tone="muted">
          {incident.note}
        </Text>
      ) : null}

      {cancellable ? (
        <Button
          label="It was a false alarm"
          variant="secondary"
          size="sm"
          onPress={onCancel}
          loading={cancel.isPending}
          accessibilityLabel="Cancel this emergency alert"
        />
      ) : null}
    </Card>
  );
}

export default function SOSScreen() {
  const [stage, setStage] = useState<Stage>('idle');
  const [locationError, setLocationError] = useState<string | null>(null);

  const trigger = useTriggerSOS();
  const history = useUserSOSHistory();
  const showToast = useUIStore((state) => state.showToast);

  // The passenger's own alerts move when a responder acts on them.
  useSOSSubscription();

  const openIncident = history.data?.find((incident) =>
    OPEN_SOS_STATUSES.includes(incident.status),
  );

  async function onTrigger() {
    setLocationError(null);
    setStage('locating');

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setStage('idle');
        setLocationError(
          'PalaGo needs location access to tell the operator where you are. You can enable it in your device settings.',
        );
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setStage('sending');

      const result = await trigger.mutateAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      showToast({
        tone: result.alreadyOpen ? 'info' : 'success',
        title: result.alreadyOpen ? 'Your alert is already open' : 'Emergency alert sent',
        message: result.alreadyOpen
          ? 'The operator already has it. Someone will be in touch.'
          : 'Your location has been shared with the operator.',
      });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not send the alert',
        message:
          error instanceof AppError
            ? error.message
            : 'Check your connection and try again. If you can, call for help directly.',
      });
    } finally {
      setStage('idle');
    }
  }

  const busy = stage !== 'idle';

  return (
    <Screen scroll contentClassName="gap-4 pb-8">
      <Header title="Emergency assistance" showBack fallbackHref="/(user)/home" />

      <Card className="gap-4 border-danger/40 bg-danger-soft">
        <View className="gap-1">
          <Text variant="bodyStrong">Alert the operator</Text>
          <Text variant="caption" tone="muted">
            This shares where you are with the operator running your trip and its crew. Use it
            only in a real emergency.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send an emergency alert"
          accessibilityState={{ disabled: busy }}
          onPress={onTrigger}
          disabled={busy}
          className={`h-32 items-center justify-center gap-2 rounded-2xl ${
            busy ? 'bg-danger/50' : 'bg-danger'
          }`}>
          <CircleAlert size={44} color="#fff" />
          <Text className="text-lg font-bold text-white">
            {stage === 'locating'
              ? 'Getting your location…'
              : stage === 'sending'
                ? 'Sending…'
                : 'Send SOS'}
          </Text>
        </Pressable>

        {locationError ? (
          <Alert tone="warning" title="Alert not sent" message={locationError} />
        ) : null}
      </Card>

      {openIncident ? (
        <Alert
          tone="info"
          title="You have an alert open"
          message="Sending again will not raise a second one — the operator already has this alert."
        />
      ) : null}

      {/*
        Nothing here promises a response time or says help is "on the way"
        before a responder has actually said so. The status on each alert is
        the real state, straight from the server.
      */}
      <Card className="gap-2">
        <View className="flex-row items-center gap-2">
          <TriangleAlert size={16} color={Colors.textMuted} />
          <Text variant="bodyStrong">What happens next</Text>
        </View>
        <Text variant="caption" tone="muted">
          The operator sees your alert with your location and marks it as seen, then as being
          responded to. You will see each of those here as it happens. PalaGo does not contact
          emergency services for you — if you are in danger, call them directly.
        </Text>
      </Card>

      <View className="gap-2">
        <Text variant="label" tone="muted">
          Your alerts
        </Text>

        {history.isLoading ? (
          <Loading label="Loading your alerts…" />
        ) : history.isError ? (
          <ErrorState
            message="We could not load your alerts."
            onRetry={() => void history.refetch()}
          />
        ) : !history.data?.length ? (
          <EmptyState title="No alerts" message="Alerts you raise will be listed here." />
        ) : (
          <View className="gap-2">
            {history.data.map((incident) => (
              <IncidentRow key={incident.id} incident={incident} />
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}
