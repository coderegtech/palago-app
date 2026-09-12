/**
 * Selling a seat at the counter.
 *
 * For the passenger who has no smartphone — or no account, or no card. The
 * clerk books the trip, picks the seat, takes the fare, and hands over a
 * printed ticket with a QR that scans at the door like any other.
 *
 * Two things this screen is careful about:
 *
 *   * **Cash is real money.** Every other payment in PalaGo is simulated. The
 *     cash button therefore asks for an explicit confirmation naming the
 *     amount, because the tap is the record that notes changed hands, and the
 *     server stores who took them.
 *   * **It never says "paid" on its own.** The booking is created, then the
 *     fare is recorded, both server-side. The ticket appears only once the
 *     server has confirmed the booking.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Banknote, CircleCheck, Printer, Ticket } from 'lucide-react-native';

import { SeatMap } from '@/components/booking/seat-map';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { BoardingPass } from '@/components/payment/boarding-pass';
import { PassengerType } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useBoardingPass } from '@/hooks/use-boarding';
import {
  useOperatorNameForTrip,
  useSellAtCounter,
  useTakeCounterPayment,
} from '@/hooks/use-counter';
import { useOperatorTrips } from '@/hooks/use-operator';
import { useTripSeats } from '@/hooks/use-trips';
import { AppError } from '@/lib/errors';
import { COUNTER_METHODS, type PaymentMethod } from '@/services/counter-service';
import { qrService } from '@/services/qr-service';
import type { TripSeatView } from '@/services/trip-service';
import type { TripOverview } from '@/services/operator-service';
import { formatDateShort, formatTime, todayISO } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

const PASSENGER_TYPES = [
  { value: PassengerType.ADULT, label: 'Adult' },
  { value: PassengerType.CHILD, label: 'Child' },
  { value: PassengerType.SENIOR, label: 'Senior' },
  { value: PassengerType.STUDENT, label: 'Student' },
  { value: PassengerType.PWD, label: 'PWD' },
];

interface Traveller {
  name: string;
  phone: string;
  type: PassengerType;
}

const blankTraveller = (): Traveller => ({ name: '', phone: '', type: PassengerType.ADULT });

export default function AssistedBookingScreen() {
  const trips = useOperatorTrips(todayISO());

  const [trip, setTrip] = useState<TripOverview | null>(null);
  const [travellers, setTravellers] = useState<Traveller[]>([blankTraveller()]);
  const [seats, setSeats] = useState<TripSeatView[]>([]);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [confirmingCash, setConfirmingCash] = useState(false);
  const [sold, setSold] = useState<{ bookingId: string; reference: string } | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const seatMap = useTripSeats(trip?.id ?? null);
  const sell = useSellAtCounter();
  const takePayment = useTakeCounterPayment();
  const pass = useBoardingPass(receipt ? (sold?.bookingId ?? null) : null);
  const operatorName = useOperatorNameForTrip(trip?.id ?? null);

  const named = travellers.filter((t) => t.name.trim().length > 1);
  const ready = trip !== null && named.length === travellers.length && seats.length === travellers.length;
  const total = useMemo(() => (trip ? trip.fare * travellers.length : 0), [trip, travellers.length]);

  function reset() {
    setTrip(null);
    setTravellers([blankTraveller()]);
    setSeats([]);
    setMethod(null);
    setSold(null);
    setReceipt(null);
    sell.reset();
    takePayment.reset();
  }

  function toggleSeat(seat: TripSeatView) {
    setSeats((current) => {
      if (current.some((s) => s.seatId === seat.seatId)) {
        return current.filter((s) => s.seatId !== seat.seatId);
      }
      // Silently ignoring the tap beats selecting a seat nobody is paying for;
      // the count is on screen, so the limit is visible.
      if (current.length >= travellers.length) return current;
      return [...current, seat];
    });
  }

  function onSell() {
    if (!trip || !method) return;
    sell.mutate(
      {
        tripId: trip.id,
        passengers: named.map((t) => ({ name: t.name, phone: t.phone, type: t.type })),
        seatIds: seats.map((s) => s.seatId),
        source: 'OPERATOR',
      },
      {
        onSuccess: (sale) => {
          setSold({ bookingId: sale.bookingId, reference: sale.reference });
          takePayment.mutate(
            { bookingId: sale.bookingId, method },
            { onSuccess: (result) => setReceipt(result.receiptNumber) },
          );
        },
      },
    );
  }

  const error = sell.error ?? takePayment.error;
  const errorMessage =
    error instanceof AppError ? error.message : error ? 'Please try again.' : null;

  // -------------------------------------------------------------------------
  // The ticket, once the server has confirmed the booking
  // -------------------------------------------------------------------------
  if (sold && receipt) {
    return (
      <Screen scroll>
        <Header title="Ticket" subtitle={`Receipt ${receipt}`} />

        <Card className="mb-4 flex-row items-center gap-3 border-success/40 bg-success-soft">
          <CircleCheck size={20} color={Colors.success} />
          <View className="flex-1">
            <Text variant="bodyStrong">Fare received</Text>
            <Text variant="caption" tone="muted">
              {formatMoney(total)} · {COUNTER_METHODS.find((m) => m.value === method)?.label}
            </Text>
          </View>
        </Card>

        {pass.isPending ? (
          <Loading label="Preparing the ticket…" />
        ) : pass.isError || !pass.data ? (
          <ErrorState
            message="The booking is paid, but the ticket could not be loaded. Search the booking to print it."
            onRetry={() => pass.refetch()}
          />
        ) : (
          <BoardingPass
            value={qrService.toQRString(pass.data)}
            reference={sold.reference}
            passengerNames={named.map((t) => t.name)}
            seatNumbers={seats.map((s) => s.seatNumber)}
            operatorName={operatorName.data ?? ''}
            originCode={trip?.originCode ?? ''}
            destinationCode={trip?.destinationCode ?? ''}
          />
        )}

        <Card className="mt-4 flex-row gap-3">
          <Printer size={18} color={Colors.textMuted} />
          <Text variant="caption" tone="muted" className="flex-1">
            Printing to a ticket printer is not built yet, and neither is boarding by reference — the
            door still needs this QR scanned. Until printing exists, show this screen at the door or
            photograph it.
          </Text>
        </Card>

        <Button label="Sell another ticket" className="mt-4" onPress={reset} />
      </Screen>
    );
  }

  // -------------------------------------------------------------------------
  // Which trip
  // -------------------------------------------------------------------------
  if (!trip) {
    const sellable = (trips.data ?? []).filter(
      (t) => (t.status === 'SCHEDULED' || t.status === 'BOARDING') && t.seatsAvailable > 0,
    );

    return (
      <Screen scroll>
        <Header title="Counter sale" subtitle="Choose the trip the passenger is travelling on" />

        {trips.isPending ? (
          <Loading label="Loading today's trips…" />
        ) : trips.isError ? (
          <ErrorState message="Could not load today's trips." onRetry={() => trips.refetch()} />
        ) : sellable.length === 0 ? (
          <EmptyState
            title="Nothing to sell today"
            message="Trips appear here while they still have seats and have not departed."
          />
        ) : (
          <View className="gap-3">
            {sellable.map((t) => (
              <Card key={t.id} className="gap-2">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <Text variant="mono">{t.tripNumber}</Text>
                    <Text variant="bodyStrong">
                      {t.originCode} → {t.destinationCode}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {formatDateShort(t.departureDate)} · {formatTime(t.departureTime)} · Bus{' '}
                      {t.busNumber}
                    </Text>
                  </View>
                  <View className="items-end gap-1">
                    <Text variant="bodyStrong" tone="primary">
                      {formatMoney(t.fare)}
                    </Text>
                    <Badge label={`${t.seatsAvailable} free`} tone="neutral" />
                  </View>
                </View>
                <Button
                  label="Sell on this trip"
                  onPress={() => setTrip(t)}
                  accessibilityLabel={`Sell a ticket on ${t.tripNumber}`}
                />
              </Card>
            ))}
          </View>
        )}
      </Screen>
    );
  }

  // -------------------------------------------------------------------------
  // Passengers, seats, fare
  // -------------------------------------------------------------------------
  return (
    <Screen scroll>
      <Header
        title="Counter sale"
        subtitle={`${trip.tripNumber} · ${trip.originCode} → ${trip.destinationCode} · ${formatTime(trip.departureTime)}`}
        showBack
        onBack={reset}
      />

      <Card className="gap-3">
        <View className="flex-row items-center justify-between">
          <Text variant="label" tone="muted">
            Passengers
          </Text>
          <View className="flex-row gap-2">
            <Button
              label="−"
              variant="outline"
              size="sm"
              disabled={travellers.length <= 1}
              accessibilityLabel="One passenger fewer"
              onPress={() => {
                setTravellers((t) => t.slice(0, -1));
                setSeats((s) => s.slice(0, travellers.length - 1));
              }}
            />
            <Button
              label="+"
              variant="outline"
              size="sm"
              disabled={travellers.length >= 5 || travellers.length >= trip.seatsAvailable}
              accessibilityLabel="One passenger more"
              onPress={() => setTravellers((t) => [...t, blankTraveller()])}
            />
          </View>
        </View>

        {travellers.map((traveller, index) => (
          <View key={index} className="gap-2">
            {index > 0 ? <Divider /> : null}
            <Input
              label={`Passenger ${index + 1} — full name`}
              placeholder="Juan Dela Cruz"
              value={traveller.name}
              autoCapitalize="words"
              onChangeText={(name) =>
                setTravellers((all) => all.map((t, i) => (i === index ? { ...t, name } : t)))
              }
            />
            <Input
              label="Mobile number (optional)"
              placeholder="0917 123 4567"
              keyboardType="phone-pad"
              value={traveller.phone}
              onChangeText={(phone) =>
                setTravellers((all) => all.map((t, i) => (i === index ? { ...t, phone } : t)))
              }
            />
            <Select
              label="Passenger type"
              value={traveller.type}
              options={PASSENGER_TYPES}
              onChange={(type) =>
                setTravellers((all) => all.map((t, i) => (i === index ? { ...t, type } : t)))
              }
            />
          </View>
        ))}

        <Text variant="caption" tone="muted">
          A discounted fare needs an approved ID on a PalaGo account, so a counter sale is charged
          the ordinary fare whatever type is chosen here.
        </Text>
      </Card>

      <Card className="mt-4 gap-3">
        <View className="flex-row items-center justify-between">
          <Text variant="label" tone="muted">
            Seats
          </Text>
          <Text variant="caption" tone="muted">
            {seats.length} of {travellers.length} chosen
          </Text>
        </View>

        {seatMap.isPending ? (
          <Loading label="Loading the seat map…" />
        ) : seatMap.isError ? (
          <ErrorState message="Could not load the seat map." onRetry={() => seatMap.refetch()} />
        ) : (
          <SeatMap
            seats={seatMap.data ?? []}
            selectedSeatIds={seats.map((s) => s.seatId)}
            onToggleSeat={toggleSeat}
          />
        )}
      </Card>

      <Card className="mt-4 gap-3">
        <Text variant="label" tone="muted">
          Fare
        </Text>
        <View className="flex-row items-center justify-between">
          <Text variant="body" tone="muted">
            {formatMoney(trip.fare)} × {travellers.length}
          </Text>
          <Text variant="title">{formatMoney(total)}</Text>
        </View>

        <Divider />

        <Text variant="label" tone="muted">
          How is the passenger paying?
        </Text>
        <View className="gap-2">
          {COUNTER_METHODS.map((option) => (
            <Button
              key={option.value}
              label={option.label}
              variant={method === option.value ? 'primary' : 'secondary'}
              icon={
                option.value === 'CASH' ? (
                  <Banknote size={18} color={method === 'CASH' ? Colors.surface : Colors.primary} />
                ) : undefined
              }
              accessibilityState={{ selected: method === option.value }}
              onPress={() => setMethod(option.value)}
            />
          ))}
        </View>

        {method === 'CASH' ? (
          <Alert
            tone="warning"
            title="Cash is real money"
            message="Confirming records that you received this fare in cash, against your name. Every other method here is simulated."
          />
        ) : method ? (
          <Alert
            tone="info"
            title="TEST PAYMENT — NO REAL MONEY WILL BE CHARGED"
            message="This method is simulated. Nothing is sent to any payment provider and no money moves."
          />
        ) : null}

        {errorMessage ? <Alert tone="danger" title="Not sold" message={errorMessage} /> : null}

        <Button
          label={
            method === 'CASH'
              ? `Confirm ${formatMoney(total)} received in cash`
              : `Take ${formatMoney(total)} and issue the ticket`
          }
          icon={<Ticket size={18} color={Colors.surface} />}
          disabled={!ready || !method}
          loading={sell.isPending || takePayment.isPending}
          onPress={() => (method === 'CASH' ? setConfirmingCash(true) : onSell())}
        />

        {!ready ? (
          <Text variant="caption" tone="muted">
            {named.length < travellers.length
              ? 'Enter every passenger’s name.'
              : `Choose ${travellers.length - seats.length} more seat(s).`}
          </Text>
        ) : null}
      </Card>

      <Modal
        visible={confirmingCash}
        onClose={() => setConfirmingCash(false)}
        title="Cash received?"
        dismissOnBackdropPress={false}>
        <View className="gap-4 pt-2">
          <Text variant="body" tone="muted">
            Confirm you have taken {formatMoney(total)} in cash from{' '}
            {named.map((t) => t.name).join(', ')}. This is recorded against your account and cannot
            be undone here.
          </Text>
          <Button
            label={`Yes, I received ${formatMoney(total)}`}
            loading={sell.isPending || takePayment.isPending}
            onPress={() => {
              setConfirmingCash(false);
              onSell();
            }}
          />
          <Button label="Not yet" variant="outline" onPress={() => setConfirmingCash(false)} />
        </View>
      </Modal>
    </Screen>
  );
}
