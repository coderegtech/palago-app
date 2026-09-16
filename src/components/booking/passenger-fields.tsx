import { Controller, type Control } from 'react-hook-form';

import { FormInput } from '@/components/common/form-input';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { PassengerType } from '@/constants/enums';
import type { PassengersFormInput } from '@/schemas/booking';

const PASSENGER_TYPES = [
  { value: PassengerType.ADULT, label: 'Adult' },
  { value: PassengerType.CHILD, label: 'Child' },
  { value: PassengerType.SENIOR, label: 'Senior', description: 'Discount applied by the operator' },
  { value: PassengerType.STUDENT, label: 'Student' },
  { value: PassengerType.PWD, label: 'PWD', description: 'Person with disability' },
];

export interface PassengerFieldsProps {
  control: Control<PassengersFormInput>;
  index: number;
  /** Shown as the card's heading. Defaults to "Passenger {n}". */
  title?: string;
}

/**
 * One passenger's details: name, type, mobile, email.
 *
 * Extracted so the counter sale asks exactly what the app asks, in the same
 * order, with the same labels, the same optional markers and the same
 * validation — `passengerDetailSchema` is the single source for all of it. A
 * clerk who has used the passenger app already knows this form, and a rule that
 * changes here changes in both places at once.
 *
 * It takes a react-hook-form `control` rather than value/onChange pairs so the
 * passenger screen, which already drives a `useFieldArray`, keeps working
 * exactly as it did; the counter adopts the same machinery rather than the form
 * being reshaped around a second caller.
 */
export function PassengerFields({ control, index, title }: PassengerFieldsProps) {
  return (
    <Card className="gap-3">
      <Text variant="subtitle">{title ?? `Passenger ${index + 1}`}</Text>

      <FormInput
        control={control}
        name={`passengers.${index}.name`}
        label="Full name"
        placeholder="Juan Dela Cruz"
        autoCapitalize="words"
        autoComplete="name"
      />

      {/*
        A Controller rather than watch() + setValue: `watch` returns a new
        function identity on every render, which the React Hooks lint rule flags
        as unmemoizable, and Controller is the API intended for a non-native
        input like this Select.
      */}
      <Controller
        control={control}
        name={`passengers.${index}.type`}
        render={({ field, fieldState }) => (
          <Select
            label="Passenger type"
            value={field.value}
            options={PASSENGER_TYPES}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />

      <FormInput
        control={control}
        name={`passengers.${index}.phone`}
        label="Mobile number (optional)"
        placeholder="0917 123 4567"
        keyboardType="phone-pad"
        autoComplete="tel"
      />

      <FormInput
        control={control}
        name={`passengers.${index}.email`}
        label="Email (optional)"
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
    </Card>
  );
}
