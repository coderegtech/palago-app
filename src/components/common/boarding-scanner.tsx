import { CameraView, useCameraPermissions } from 'expo-camera';
import type { Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import {
  ArrowLeftRight,
  CheckCircle2,
  Flashlight,
  FlashlightOff,
  Keyboard,
  ScanLine,
  Square,
  SquareCheck,
  XCircle,
} from 'lucide-react-native';

import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useConfirmBoarding, useValidateScan } from '@/hooks/use-boarding';
import { AppError } from '@/lib/errors';
import {
  WEB_CAMERA_BLOCKED_COPY,
  WEB_CAMERA_BLOCKER_COPY,
  checkWebCamera,
  type WebCameraSupport,
} from '@/lib/web-camera';
import type { ScanResult, ScanVerdict } from '@/services/qr-service';
import { useUIStore } from '@/stores/ui-store';
import type { UUID } from '@/types/models';
import { formatDate, formatTime } from '@/utils/datetime';

import { type BoardingDoor, doorLabel, idsToBoard } from './boarding-door';

/**
 * How each verdict reads to the operator at the door. The wording matters more
 * than the colour: a driver in bright sunlight reads the words. Typed as a
 * Record over every verdict, so a new one cannot ship without its wording.
 */
const RESULT_COPY: Record<ScanVerdict, { title: string; tone: BadgeTone; body: string }> = {
  VALID: { title: 'VALID TICKET', tone: 'success', body: 'Choose who is boarding now.' },
  INVALID_QR: {
    title: 'NOT A VALID TICKET',
    tone: 'danger',
    body: 'This code was not issued by PalaGo. Do not board.',
  },
  QR_EXPIRED: {
    title: 'EXPIRED',
    tone: 'danger',
    body: 'This boarding pass has expired. Ask the passenger to reopen it in the app.',
  },
  ALREADY_BOARDED: {
    title: 'ALREADY BOARDED',
    tone: 'warning',
    body: 'Everyone on this ticket has already boarded. Do not board them again.',
  },
  UNPAID_BOOKING: {
    title: 'NOT PAID',
    tone: 'danger',
    body: 'This booking has not been paid for. Do not board.',
  },
  BOOKING_CANCELLED: {
    title: 'CANCELLED',
    tone: 'danger',
    body: 'This booking was cancelled or refunded. The ticket is no longer valid.',
  },
  BOARDING_NOT_OPEN: {
    title: 'BOARDING NOT OPEN',
    tone: 'warning',
    body: 'Boarding has not been opened for this trip yet.',
  },
  BOARDING_CLOSED: {
    title: 'BOARDING CLOSED',
    tone: 'danger',
    body: 'This trip has already left or was cancelled. Nobody can board it now.',
  },
  WRONG_TRIP: {
    title: 'WRONG OPERATOR',
    tone: 'danger',
    body: 'This ticket is for another bus company. Send the passenger to their own operator.',
  },
  WRONG_ROUTE: {
    title: 'WRONG ROUTE',
    tone: 'danger',
    body: 'This ticket is for a different route. Do not board — send them to the trip below.',
  },
  WRONG_DATE: {
    title: 'WRONG DAY',
    tone: 'danger',
    body: 'This ticket is for another day. Do not board — it is still valid for the trip below.',
  },
  WRONG_BUS: {
    title: 'WRONG BUS',
    tone: 'danger',
    body: 'This ticket is for another departure today. Send the passenger to the bus below.',
  },
};

const WRONG_DOOR: ScanVerdict[] = ['WRONG_ROUTE', 'WRONG_DATE', 'WRONG_BUS'];

export interface BoardingScannerProps {
  /** The trip being boarded. Every scan is judged against it. */
  door: BoardingDoor;
  /** Back to the trip list, to board a different bus. */
  onChangeTrip?: () => void;
  /** Where the back button goes when there is no navigation history. */
  fallbackHref?: Href;
  showBack?: boolean;
}

/**
 * The boarding scanner, shared by the operator console and the crew app.
 *
 * Extracted in Phase 8: the driver app needs exactly this screen, and a second
 * copy of the scan-result wording is a copy that will drift. Every check still
 * happens on the server — see docs/qr-flow.md. This screen never decides that
 * a ticket is good; it shows what the server said, for this door.
 */
export function BoardingScanner({
  door,
  onChangeTrip,
  fallbackHref,
  showBack = false,
}: BoardingScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manualMode, setManualMode] = useState(false);
  // Null while a browser is being checked. Native needs no check — its
  // permission flow already reports the real reason — so it starts ready.
  const [webCamera, setWebCamera] = useState<WebCameraSupport | null>(
    Platform.OS === 'web' ? null : { ok: true },
  );
  // Set when the camera was allowed but still would not start — on a laptop,
  // usually because a video-call app already has it.
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [manualPayload, setManualPayload] = useState('');
  const [scanned, setScanned] = useState<{ payload: string; result: ScanResult } | null>(null);
  // Passengers ticked to board on this scan. Starts as everyone not yet on.
  const [selected, setSelected] = useState<Set<UUID>>(new Set());

  const validate = useValidateScan();
  const boarding = useConfirmBoarding();
  const showToast = useUIStore((state) => state.showToast);

  // The camera fires continuously; without this one code would be submitted
  // dozens of times while it stays in frame.
  const busy = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;
    void checkWebCamera().then((support) => {
      if (!cancelled) setWebCamera(support);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A reason the camera can never work here, as opposed to one the operator
  // can fix by pressing "Allow". Only ever set on web.
  const cameraBlocker = webCamera && !webCamera.ok ? webCamera.reason : null;
  const canUseCamera = webCamera?.ok === true;
  const doorSubtitle = `Boarding ${door.tripNumber} · ${doorLabel(door)}`;

  const handlePayload = useCallback(
    (payload: string) => {
      if (busy.current) return;
      busy.current = true;

      validate.mutate(
        { payload, tripId: door.tripId },
        {
          onSuccess: (result) => {
            setScanned({ payload, result });
            setSelected(
              new Set((result.passengers ?? []).filter((p) => !p.boardedAt).map((p) => p.id)),
            );
          },
          onError: (error) => {
            showToast({
              tone: 'danger',
              title: 'Could not check this ticket',
              message:
                error instanceof AppError
                  ? error.message
                  : 'No connection. A ticket cannot be verified offline.',
            });
          },
          onSettled: () => {
            busy.current = false;
          },
        },
      );
    },
    [validate, showToast, door.tripId],
  );

  function reset() {
    setScanned(null);
    setSelected(new Set());
    setManualPayload('');
    boarding.reset();
    validate.reset();
  }

  function toggle(passengerId: UUID) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(passengerId)) next.delete(passengerId);
      else next.add(passengerId);
      return next;
    });
  }

  function onConfirmBoarding() {
    if (!scanned || selected.size === 0) return;
    const waiting = (scanned.result.passengers ?? []).filter((p) => !p.boardedAt).map((p) => p.id);
    const passengerIds = idsToBoard(waiting, selected);

    boarding.mutate(
      { payload: scanned.payload, tripId: door.tripId, passengerIds },
      {
        onSuccess: (result) => {
          if (result.boarded) {
            const count = result.boardedPassengers ?? selected.size;
            showToast({
              tone: 'success',
              title: `${count} passenger${count === 1 ? '' : 's'} boarded`,
              message: result.remaining
                ? `${result.bookingReference}: ${result.remaining} still to board on this ticket.`
                : `${result.bookingReference} is fully boarded.`,
            });
          } else {
            // Something changed between the check and the tap — another door
            // boarded them, or the bus left. Say what the server said.
            const copy = RESULT_COPY[result.result] ?? RESULT_COPY.INVALID_QR;
            showToast({ tone: 'warning', title: `Not boarded: ${copy.title.toLowerCase()}`, message: copy.body });
          }
          reset();
        },
        onError: (error) => {
          showToast({
            tone: 'danger',
            title: 'Could not board',
            message:
              error instanceof AppError
                ? error.message
                : 'No connection. Boarding is not recorded until the server confirms it.',
          });
        },
      },
    );
  }

  /** Which bus this is — on every screen, so nobody boards the wrong one. */
  const doorStrip = (
    <View className="mb-3 flex-row items-center justify-between gap-3 rounded-xl bg-primary-soft px-3 py-2">
      <Text variant="caption" className="flex-1 font-semibold">
        {doorSubtitle}
      </Text>
      {onChangeTrip ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Board a different trip"
          onPress={onChangeTrip}
          className="min-h-11 flex-row items-center gap-1 px-1">
          <ArrowLeftRight size={16} color={Colors.primary} />
          <Text variant="caption" tone="primary" className="font-semibold">
            Change
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  // ---------------------------------------------------------------------
  // Result
  // ---------------------------------------------------------------------
  if (scanned) {
    const r = scanned.result;
    const copy = RESULT_COPY[r.result] ?? RESULT_COPY.INVALID_QR;
    const wrongDoor = WRONG_DOOR.includes(r.result);
    const passengers = r.passengers ?? [];

    return (
      <Screen scroll>
        <Header title="Scan result" showBack={showBack} fallbackHref={fallbackHref} />
        {doorStrip}

        <View className="items-center gap-2 py-4">
          <View
            className={`h-16 w-16 items-center justify-center rounded-full ${
              r.valid ? 'bg-success-soft' : 'bg-danger-soft'
            }`}>
            {r.valid ? (
              <CheckCircle2 size={32} color={Colors.success} />
            ) : (
              <XCircle size={32} color={Colors.danger} />
            )}
          </View>
          <Text variant="title" className="text-center">
            {copy.title}
          </Text>
          <Badge label={r.result} tone={copy.tone} />
          <Text variant="body" tone="muted" className="text-center">
            {copy.body}
          </Text>
        </View>

        {r.bookingReference ? (
          <Card className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text variant="mono">{r.bookingReference}</Text>
              {r.paymentStatus ? (
                <Badge
                  label={`Payment: ${r.paymentStatus}`}
                  tone={r.paymentStatus === 'PAID' ? 'success' : 'danger'}
                />
              ) : null}
            </View>

            <Divider />

            {/* For a wrong-door ticket this is the trip to send them to. */}
            <View className="gap-1">
              {wrongDoor ? (
                <Text variant="caption" tone="muted" className="font-semibold uppercase">
                  This ticket is for
                </Text>
              ) : null}
              <Text variant="bodyStrong">
                {r.originCode} → {r.destinationCode}
              </Text>
              <Text variant="caption" tone="muted">
                {r.operatorName} · {r.tripNumber}
                {r.departureDate && r.departureTime
                  ? ` · ${formatDate(r.departureDate)} ${formatTime(r.departureTime)}`
                  : ''}
                {r.busNumber ? ` · Bus ${r.busNumber}` : ''}
              </Text>
            </View>

            {passengers.length > 0 ? (
              <>
                <Divider />
                <View className="gap-1">
                  <Text variant="caption" tone="muted" className="font-semibold uppercase">
                    Passengers
                  </Text>
                  {passengers.map((p) => {
                    const onBoard = Boolean(p.boardedAt);
                    const ticked = selected.has(p.id);
                    return (
                      <Pressable
                        key={p.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: onBoard || ticked, disabled: onBoard || !r.valid }}
                        accessibilityLabel={
                          onBoard
                            ? `${p.name}, seat ${p.seat}, already boarded`
                            : `${p.name}, seat ${p.seat}`
                        }
                        disabled={onBoard || !r.valid}
                        onPress={() => toggle(p.id)}
                        className="min-h-12 flex-row items-center gap-3 py-1">
                        {r.valid && !onBoard ? (
                          ticked ? (
                            <SquareCheck size={22} color={Colors.primary} />
                          ) : (
                            <Square size={22} color={Colors.textMuted} />
                          )
                        ) : null}
                        <View className="flex-1">
                          <Text variant="body">{p.name}</Text>
                          <Text variant="caption" tone="muted">
                            {p.type}
                            {onBoard ? ` · boarded ${new Date(p.boardedAt as string).toLocaleTimeString()}` : ''}
                          </Text>
                        </View>
                        <Badge label={`Seat ${p.seat}`} tone={onBoard ? 'neutral' : 'primary'} />
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
          </Card>
        ) : null}

        {/* Boarding is offered only for a ticket the server called VALID. */}
        {r.valid ? (
          <Button
            label={
              selected.size === 0
                ? 'Tick who is boarding'
                : `Board ${selected.size} passenger${selected.size === 1 ? '' : 's'}`
            }
            className="mt-6"
            disabled={selected.size === 0}
            loading={boarding.isPending}
            onPress={onConfirmBoarding}
          />
        ) : null}

        <Button
          label={r.valid ? 'Cancel' : 'Scan another'}
          variant="outline"
          className="mt-2"
          onPress={reset}
        />
      </Screen>
    );
  }

  // ---------------------------------------------------------------------
  // Manual entry
  //
  // A real operational need — a cracked screen, a dead passenger phone, a
  // camera that will not focus — and where the operator lands, with the reason
  // spelled out, when this browser cannot use a camera at all.
  // ---------------------------------------------------------------------
  if (manualMode || cameraBlocker || cameraError) {
    const blockerCopy = cameraBlocker ? WEB_CAMERA_BLOCKER_COPY[cameraBlocker] : null;

    return (
      <Screen scroll>
        <Header title="Scanner" subtitle="Manual entry" showBack={showBack} fallbackHref={fallbackHref} />
        {doorStrip}

        {blockerCopy ? (
          <Alert
            tone="warning"
            title={blockerCopy.title}
            message={blockerCopy.message}
            className="mt-2"
          />
        ) : null}

        {cameraError ? (
          <Alert
            tone="warning"
            title="The camera could not start"
            message={cameraError}
            className="mt-2"
          />
        ) : null}

        <Alert
          tone="info"
          title="Enter the pass contents"
          message="Paste the boarding pass payload. Every check is still performed on the server — a typed ticket is verified exactly like a scanned one."
          className="mt-2"
        />

        <Input
          label="Boarding pass payload"
          placeholder='{"type":"PALAGO_BOOKING",...}'
          value={manualPayload}
          onChangeText={setManualPayload}
          multiline
          numberOfLines={4}
          autoCapitalize="none"
          autoCorrect={false}
          containerClassName="mt-4"
        />

        <Button
          label="Check ticket"
          className="mt-4"
          disabled={manualPayload.trim().length === 0}
          loading={validate.isPending}
          onPress={() => handlePayload(manualPayload.trim())}
        />

        {canUseCamera ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cameraError ? 'Try the camera again' : 'Use the camera instead'}
            onPress={() => {
              setCameraError(null);
              setManualMode(false);
            }}
            className="mt-6 min-h-11 flex-row items-center justify-center gap-2">
            <ScanLine size={16} color={Colors.primary} />
            <Text variant="bodyStrong" tone="primary">
              {cameraError ? 'Try the camera again' : 'Use the camera'}
            </Text>
          </Pressable>
        ) : null}
      </Screen>
    );
  }

  // ---------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------
  if (!permission || !webCamera) {
    return (
      <Screen>
        <Header title="Scanner" showBack={showBack} fallbackHref={fallbackHref} />
        {doorStrip}
        <View className="flex-1 items-center justify-center">
          <Text variant="body" tone="muted">
            Checking the camera…
          </Text>
        </View>
      </Screen>
    );
  }

  if (!permission.granted) {
    // A browser that has blocked the camera will not prompt again, and
    // expo-camera still reports `canAskAgain: true` there. Offering "Allow"
    // would be a button that does nothing, so say where the setting lives.
    const blockedInBrowser = Platform.OS === 'web' && permission.status === 'denied';

    return (
      <Screen scroll>
        <Header title="Scanner" showBack={showBack} fallbackHref={fallbackHref} />
        {doorStrip}
        {blockedInBrowser ? (
          <Alert
            tone="warning"
            title={WEB_CAMERA_BLOCKED_COPY.title}
            message={WEB_CAMERA_BLOCKED_COPY.message}
            className="mt-4"
          />
        ) : (
          <>
            <Alert
              tone="info"
              title="Camera access needed"
              message="PalaGo uses the camera only to read boarding passes. Nothing is recorded or uploaded."
              className="mt-4"
            />
            <Button label="Allow camera" className="mt-4" onPress={requestPermission} />
          </>
        )}
        <Button
          label="Enter a pass manually instead"
          variant="outline"
          className="mt-2"
          onPress={() => setManualMode(true)}
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Scanner" subtitle="Scan a boarding pass" showBack={showBack} fallbackHref={fallbackHref} />
        {doorStrip}
      </View>

      <View className="flex-1 overflow-hidden">
        {/* `back` is requested as `ideal`, not `exact`, on web — a laptop
            with only a front webcam falls back to it rather than failing. */}
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          enableTorch={torch}
          onBarcodeScanned={({ data }) => handlePayload(data)}
          onMountError={() =>
            setCameraError(
              Platform.OS === 'web'
                ? 'Another app or browser tab may be using it. Close it and try again, or enter the pass below.'
                : 'Close any other app using the camera and try again, or enter the pass below.',
            )
          }
        />

        {/* Reticle. Purely a sighting aid — decoding is the camera's job. */}
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <View className="h-56 w-56 rounded-3xl border-2 border-white/80" />
          <Text variant="caption" tone="inverse" className="mt-4">
            Point at the passenger&apos;s boarding pass
          </Text>
        </View>
      </View>

      <View className="gap-2 border-t border-border bg-surface px-4 pb-6 pt-3">
        {validate.isPending ? (
          <Text variant="caption" tone="muted" className="text-center">
            Checking ticket…
          </Text>
        ) : (
          <Text variant="caption" tone="muted" className="text-center">
            Every ticket is verified on the server. A ticket cannot be checked offline.
          </Text>
        )}
        <View className="flex-row justify-center gap-6">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enter a pass manually"
            onPress={() => setManualMode(true)}
            className="min-h-11 flex-row items-center justify-center gap-2">
            <Keyboard size={16} color={Colors.primary} />
            <Text variant="bodyStrong" tone="primary">
              Enter manually
            </Text>
          </Pressable>
          {/* Native only: on web the torch works on few devices, and a toggle
              that silently does nothing is worse than none. */}
          {Platform.OS !== 'web' ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: torch }}
              accessibilityLabel={torch ? 'Turn the flashlight off' : 'Turn the flashlight on'}
              onPress={() => setTorch((on) => !on)}
              className="min-h-11 flex-row items-center justify-center gap-2">
              {torch ? (
                <FlashlightOff size={16} color={Colors.primary} />
              ) : (
                <Flashlight size={16} color={Colors.primary} />
              )}
              <Text variant="bodyStrong" tone="primary">
                {torch ? 'Light off' : 'Light'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
