/**
 * The departure form, shared by the operator console and the admin one.
 *
 * It does not decide whether a coach is free. Nothing on the client does: two
 * people pressing Save at the same moment would both read "free" and both
 * write, so the answer comes from an exclusion constraint in the database and
 * arrives here as a `SCHEDULE_CONFLICT` naming the departure in the way.
 *
 * What the form does is stop the obvious mistakes early — a blank field, a fare
 * of nothing, a coach that is off the road — and then say clearly what the
 * server refused and why.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { OperatorStatus } from '@/constants/enums';
import type { Centavos, ISODate, ISOTime, UUID } from '@/types/models';
import { formatMoney } from '@/utils/money';
import { freeFrom, isCalendarDate, isOvernight, isTimeOfDay } from '@/utils/schedule';

export interface TripFormValues {
  routeId: UUID;
  busId: UUID;
  tripNumber: string;
  departureDate: ISODate;
  departureTime: ISOTime;
  arrivalTime: ISOTime;
  /** In pesos as typed; converted to centavos on submit. */
  fare: string;
}

export interface TripFormOption {
  id: UUID;
  label: string;
  description?: string;
  status: OperatorStatus;
}

export interface TripFormProps {
  title: string;
  /** Prefilled when editing; blank when creating. */
  initial?: Partial<TripFormValues>;
  routes: TripFormOption[];
  buses: TripFormOption[];
  submitting: boolean;
  /** Message from the last refused attempt, shown above the fields. */
  error?: string | null;
  /** Minutes a coach stays spoken for after it arrives, for the hint. */
  turnaroundMinutes?: number;
  onSubmit: (values: TripFormValues & { fareCentavos: Centavos }) => void;
  onClose: () => void;
}

const BLANK: TripFormValues = {
  routeId: '',
  busId: '',
  tripNumber: '',
  departureDate: '',
  departureTime: '',
  arrivalTime: '',
  fare: '',
};

/**
 * Mounted only while it is open.
 *
 * The draft is seeded from `initial` once, at mount, rather than synced from a
 * `visible` prop inside an effect — editing one departure and then another has
 * to start from the second one's times, and an effect that resets state is both
 * a cascading render and easy to get subtly wrong. Rendering this conditionally
 * gets the same behaviour from React's own lifecycle.
 */
export function TripForm({
  title,
  initial,
  routes,
  buses,
  submitting,
  error,
  turnaroundMinutes,
  onSubmit,
  onClose,
}: TripFormProps) {
  const [values, setValues] = useState<TripFormValues>(() => ({ ...BLANK, ...initial }));

  const fareCentavos = Math.round(Number(values.fare) * 100);
  const overnight = isOvernight(values.departureTime, values.arrivalTime);

  // When this coach and crew come free again, so the operator can see what the
  // next departure has to clear rather than finding out by being refused.
  const releasedAt = turnaroundMinutes
    ? freeFrom(
        values.departureDate,
        values.departureTime,
        values.arrivalTime,
        turnaroundMinutes,
      )
    : null;

  const valid =
    values.routeId !== '' &&
    values.busId !== '' &&
    values.tripNumber.trim().length > 0 &&
    isCalendarDate(values.departureDate) &&
    isTimeOfDay(values.departureTime) &&
    isTimeOfDay(values.arrivalTime) &&
    Number.isFinite(fareCentavos) &&
    fareCentavos > 0;

  function set<K extends keyof TripFormValues>(key: K, value: TripFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  /** Inactive options are listed but marked, so a gap in the list is never a mystery. */
  const toOptions = (items: TripFormOption[]) =>
    items.map((item) => ({
      value: item.id,
      label:
        item.status === OperatorStatus.ACTIVE ? item.label : `${item.label} — not in service`,
      description: item.description,
    }));

  return (
    <Modal visible onClose={onClose} title={title}>
      <View className="gap-4 pt-2">
        {error ? <Alert tone="danger" title="That departure was refused" message={error} /> : null}

        <Select
          label="Route"
          placeholder="Where it goes"
          value={values.routeId || null}
          options={toOptions(routes)}
          onChange={(routeId) => set('routeId', routeId)}
        />

        <Select
          label="Coach"
          placeholder="Which bus"
          value={values.busId || null}
          options={toOptions(buses)}
          onChange={(busId) => set('busId', busId)}
        />

        <Input
          label="Trip number"
          placeholder="CHERRY-0920-A"
          hint="Unique within your company."
          value={values.tripNumber}
          onChangeText={(value) => set('tripNumber', value)}
          autoCapitalize="characters"
        />

        <Input
          label="Travel date"
          placeholder="YYYY-MM-DD"
          value={values.departureDate}
          onChangeText={(value) => set('departureDate', value)}
          autoCapitalize="none"
        />

        {/*
          `min-w-0` on both: a web text input carries an intrinsic width of
          about twenty characters, and `flex-1` alone will not shrink below it.
          Two of them side by side therefore overflowed the sheet by ~30px and
          scrolled its whole contents sideways.
        */}
        <View className="flex-row gap-3">
          <Input
            containerClassName="min-w-0 flex-1"
            label="Departure"
            placeholder="08:00"
            value={values.departureTime}
            onChangeText={(value) => set('departureTime', value)}
            autoCapitalize="none"
          />
          <Input
            containerClassName="min-w-0 flex-1"
            label="Estimated arrival"
            placeholder="14:00"
            value={values.arrivalTime}
            onChangeText={(value) => set('arrivalTime', value)}
            autoCapitalize="none"
          />
        </View>

        {overnight ? (
          <Text variant="caption" tone="muted">
            An arrival at or before the departure time is read as the next day — this is an
            overnight run.
          </Text>
        ) : null}

        <Input
          label="Fare per passenger"
          placeholder="700"
          hint={
            Number.isFinite(fareCentavos) && fareCentavos > 0
              ? `Each seat sells for ${formatMoney(fareCentavos)}.`
              : 'In pesos.'
          }
          value={values.fare}
          onChangeText={(value) => set('fare', value.replace(/[^\d.]/g, ''))}
          keyboardType="decimal-pad"
        />

        {turnaroundMinutes ? (
          <Text variant="caption" tone="muted">
            {releasedAt
              ? `This coach and crew are spoken for until ${releasedAt.replace('T', ' ')} — ${turnaroundMinutes} minutes after it arrives — so nothing else can use them before then.`
              : `A coach stays spoken for ${turnaroundMinutes} minutes after it arrives, so the next departure on the same bus cannot start before then.`}
          </Text>
        ) : null}

        <Button
          label="Save departure"
          disabled={!valid}
          loading={submitting}
          onPress={() => onSubmit({ ...values, fareCentavos })}
        />
        <Button label="Cancel" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}
