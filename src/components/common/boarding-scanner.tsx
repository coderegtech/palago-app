import { CameraView, useCameraPermissions } from 'expo-camera';
import type { Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { CheckCircle2, Keyboard, ScanLine, XCircle } from 'lucide-react-native';

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
import type { ScanResult } from '@/services/qr-service';
import { useUIStore } from '@/stores/ui-store';
import { formatDate, formatTime } from '@/utils/datetime';

/**
 * How each result reads to the operator at the door. The wording matters more
 * than the colour: a driver in bright sunlight reads the words.
 */
const RESULT_COPY: Record<ScanResult['result'], { title: string; tone: BadgeTone; body: string }> = {
  VALID: { title: 'VALID TICKET', tone: 'success', body: 'This passenger may board.' },
  INVALID_QR: {
    title: 'NOT A VALID TICKET',
    tone: 'danger',
    body: 'This code was not issued by PalaGo, or the booking has been cancelled or refunded.',
  },
  QR_EXPIRED: {
    title: 'EXPIRED',
    tone: 'danger',
    body: 'This boarding pass has expired. Ask the passenger to reopen it in the app.',
  },
  ALREADY_BOARDED: {
    title: 'ALREADY BOARDED',
    tone: 'warning',
    body: 'This ticket has already been used. Do not board this passenger again.',
  },
  UNPAID_BOOKING: {
    title: 'NOT PAID',
    tone: 'danger',
    body: 'This booking has not been paid for. Do not board.',
  },
  WRONG_TRIP: {
    title: 'WRONG TRIP',
    tone: 'danger',
    body: 'This ticket is for a different departure.',
  },
};

export interface BoardingScannerProps {
  /**
   * Shown under "Scanner". The driver's copy and the operator's differ because
   * a driver scans at the door of one bus while a dispatcher may scan anywhere.
   */
  subtitle?: string;
  /** Where the back button goes when there is no navigation history. */
  fallbackHref?: Href;
  showBack?: boolean;
}

/**
 * The boarding scanner, shared by the operator console and the crew app.
 *
 * Extracted in Phase 8: the driver app needs exactly this screen, and a second
 * copy of 375 lines of scan-result wording is a copy that will drift. Every
 * check still happens on the server — see docs/qr-flow.md.
 */
export function BoardingScanner({ subtitle, fallbackHref, showBack = false }: BoardingScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manualMode, setManualMode] = useState(Platform.OS === 'web');
  const [manualPayload, setManualPayload] = useState('');
  const [scanned, setScanned] = useState<{ payload: string; result: ScanResult } | null>(null);

  const validate = useValidateScan();
  const boarding = useConfirmBoarding();
  const showToast = useUIStore((state) => state.showToast);

  // The camera fires continuously; without this one code would be submitted
  // dozens of times while it stays in frame.
  const busy = useRef(false);

  const handlePayload = useCallback(
    (payload: string) => {
      if (busy.current) return;
      busy.current = true;

      validate.mutate(
        { payload },
        {
          onSuccess: (result) => setScanned({ payload, result }),
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
    [validate, showToast],
  );

  function reset() {
    setScanned(null);
    setManualPayload('');
    boarding.reset();
    validate.reset();
  }

  function onConfirmBoarding() {
    if (!scanned) return;

    boarding.mutate(scanned.payload, {
      onSuccess: (result) => {
        showToast({
          tone: result.boarded ? 'success' : 'warning',
          title: result.boarded ? 'Passenger boarded' : 'Already boarded',
          message: `${result.bookingReference}${
            result.boarded ? ' has been boarded.' : ' was already boarded.'
          }`,
        });
        reset();
      },
      onError: (error) => {
        showToast({
          tone: 'danger',
          title: 'Could not board',
          message: error instanceof AppError ? error.message : 'Please try again.',
        });
      },
    });
  }

  // ---------------------------------------------------------------------
  // Result
  // ---------------------------------------------------------------------
  if (scanned) {
    const copy = RESULT_COPY[scanned.result.result] ?? RESULT_COPY.INVALID_QR;
    const r = scanned.result;

    return (
      <Screen scroll>
        <Header title="Scan result" showBack={showBack} fallbackHref={fallbackHref} />

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

            <View className="gap-1">
              <Text variant="bodyStrong">
                {r.originCode} → {r.destinationCode}
              </Text>
              <Text variant="caption" tone="muted">
                {r.operatorName} · {r.tripNumber}
                {r.departureDate && r.departureTime
                  ? ` · ${formatDate(r.departureDate)} ${formatTime(r.departureTime)}`
                  : ''}
              </Text>
            </View>

            <Divider />

            <View className="gap-2">
              <Text variant="caption" tone="muted" className="font-semibold uppercase">
                Passengers
              </Text>
              {(r.passengers ?? []).map((p) => (
                <View key={p.seat} className="flex-row items-center justify-between">
                  <View>
                    <Text variant="body">{p.name}</Text>
                    <Text variant="caption" tone="muted">
                      {p.type}
                    </Text>
                  </View>
                  <Badge label={`Seat ${p.seat}`} tone="primary" />
                </View>
              ))}
            </View>

            {r.boardedAt ? (
              <Text variant="caption" tone="muted">
                Boarded {formatDate(r.boardedAt.slice(0, 10))} at{' '}
                {new Date(r.boardedAt).toLocaleTimeString()}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {/* Boarding is offered only for a ticket the server called VALID. */}
        {r.valid ? (
          <Button
            label="Confirm boarding"
            className="mt-6"
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
  // camera that will not focus — and the only way to exercise this screen on
  // web, where expo-camera cannot scan.
  // ---------------------------------------------------------------------
  if (manualMode) {
    return (
      <Screen scroll>
        <Header title="Scanner" subtitle={subtitle ?? 'Manual entry'} showBack={showBack} fallbackHref={fallbackHref} />

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

        {Platform.OS !== 'web' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use the camera instead"
            onPress={() => setManualMode(false)}
            className="mt-6 min-h-11 flex-row items-center justify-center gap-2">
            <ScanLine size={16} color={Colors.primary} />
            <Text variant="bodyStrong" tone="primary">
              Use the camera
            </Text>
          </Pressable>
        ) : (
          <Text variant="caption" tone="muted" className="mt-6 text-center">
            Camera scanning is available in the PalaGo mobile app.
          </Text>
        )}
      </Screen>
    );
  }

  // ---------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------
  if (!permission) {
    return (
      <Screen>
        <Header title="Scanner" subtitle={subtitle} showBack={showBack} fallbackHref={fallbackHref} />
        <View className="flex-1 items-center justify-center">
          <Text variant="body" tone="muted">
            Checking camera permission…
          </Text>
        </View>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen scroll>
        <Header title="Scanner" subtitle={subtitle} showBack={showBack} fallbackHref={fallbackHref} />
        <Alert
          tone="info"
          title="Camera access needed"
          message="PalaGo uses the camera only to read boarding passes. Nothing is recorded or uploaded."
          className="mt-4"
        />
        <Button label="Allow camera" className="mt-4" onPress={requestPermission} />
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
        <Header title="Scanner" subtitle={subtitle ?? 'Scan a boarding pass'} showBack={showBack} fallbackHref={fallbackHref} />
      </View>

      <View className="flex-1 overflow-hidden">
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => handlePayload(data)}
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
      </View>
    </Screen>
  );
}
