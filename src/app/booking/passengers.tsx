import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { FormInput } from '@/components/common/form-input';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { ErrorCode } from '@/constants/errors';
import { PassengerType } from '@/constants/enums';
import { useAuth } from '@/hooks/use-auth';
import { useReserveSeats } from '@/hooks/use-trips';
import { AppError } from '@/lib/errors';
import { passengersFormSchema, type PassengersFormInput } from '@/schemas/booking';
import { useBookingStore } from '@/stores/booking-store';
import { useUIStore } from '@/stores/ui-store';

const PASSENGER_TYPES = [
  { value: PassengerType.ADULT, label: 'Adult' },
  { value: PassengerType.CHILD, label: 'Child' },
  { value: PassengerType.SENIOR, label: 'Senior', description: 'Discount applied by the operator' },
  { value: PassengerType.STUDENT, label: 'Student' },
  { value: PassengerType.PWD, label: 'PWD', description: 'Person with disability' },
];

export default function PassengersScreen() {
  const { tripId: paramTripId } = useLocalSearchParams<{ tripId?: string }>();
  const { profile } = useAuth();
  const showToast = useUIStore((state) => state.showToast);

  const tripId = useBookingStore((state) => state.tripId) ?? paramTripId ?? null;
  const selectedSeats = useBookingStore((state) => state.selectedSeats);
  const clearSeats = useBookingStore((state) => state.clearSeats);
  const reset = useBookingStore((state) => state.reset);

  const reserve = useReserveSeats();

  const { control, handleSubmit } = useForm<PassengersFormInput>({
    resolver: zodResolver(passengersFormSchema),
    defaultValues: { passengers: [] },
  });

  const { fields, replace } = useFieldArray({ control, name: 'passengers' });

  // One form row per selected seat. Rebuilt when the selection changes so a
  // seat swapped on the previous screen cannot leave a stale row behind.
  useEffect(() => {
    replace(
      selectedSeats.map((seat, index) => ({
        seatId: seat.seatId,
        seatNumber: seat.seatNumber,
        // The person booking is usually the first passenger.
        name: index === 0 ? (profile?.fullName ?? '') : '',
        phone: index === 0 ? (profile?.phone ?? '') : '',
        email: index === 0 ? (profile?.email ?? '') : '',
        type: PassengerType.ADULT,
      })),
    );
  }, [selectedSeats, profile?.fullName, profile?.phone, profile?.email, replace]);

  const onSubmit = handleSubmit(({ passengers }) => {
    // Guarded rather than silently ignored: the button is disabled below when
    // there is no trip, so reaching here without one would be a bug, and a
    // no-op submit is the hardest kind of bug to notice.
    if (!tripId) {
      showToast({
        tone: 'danger',
        title: 'Something went wrong',
        message: 'We lost track of which trip this is. Please search again.',
      });
      return;
    }

    reserve.mutate(
      { tripId, passengers },
      {
        onSuccess: (result) => {
          // The draft has served its purpose; the booking now exists server-side.
          reset();
          router.replace({
            pathname: '/booking/payment',
            params: { bookingId: result.bookingId, reference: result.reference },
          });
        },
        onError: (error) => {
          // Losing the race is ordinary, not exceptional: send the user back to
          // pick again rather than leaving them on a form that cannot succeed.
          if (error instanceof AppError && error.code === ErrorCode.SEAT_UNAVAILABLE) {
            clearSeats();
            showToast({
              tone: 'warning',
              title: 'Those seats were just taken',
              message: 'Someone booked them while you were filling this in. Please pick again.',
            });
            router.replace({ pathname: '/booking/seats', params: { tripId } });
          }
        },
      },
    );
  });

  // Either the draft was lost (a reload, a deep link) or no seats were chosen.
  // Both leave this form unable to succeed, so say so and offer a way out
  // rather than showing inputs whose submit would do nothing.
  if (selectedSeats.length === 0 || !tripId) {
    return (
      <Screen>
        <Header title="Passenger details" showBack fallbackHref="/booking/search" />
        <Alert
          tone="info"
          title={tripId ? 'No seats selected' : 'Start your booking again'}
          message={
            tripId
              ? 'Go back and choose your seats first.'
              : 'This page was opened without a trip. Search for a trip to begin.'
          }
          className="mt-4"
        />
        <Button
          label={tripId ? 'Choose seats' : 'Search trips'}
          variant="outline"
          className="mt-4"
          onPress={() =>
            tripId
              ? router.replace({ pathname: '/booking/seats', params: { tripId } })
              : router.replace('/booking/search')
          }
        />
      </Screen>
    );
  }

  const errorMessage =
    reserve.error instanceof AppError && reserve.error.code !== ErrorCode.SEAT_UNAVAILABLE
      ? reserve.error.message
      : reserve.error && !(reserve.error instanceof AppError)
        ? 'Could not reserve your seats. Please try again.'
        : null;

  return (
    <Screen scroll>
      <Header
        title="Passenger details"
        subtitle={`${selectedSeats.length} ${selectedSeats.length === 1 ? 'seat' : 'seats'}`}
        showBack
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {errorMessage ? (
          <Alert
            tone="danger"
            title="Could not reserve"
            message={errorMessage}
            className="mb-4"
          />
        ) : null}

        <View className="gap-4">
          {fields.map((field, index) => (
            <Card key={field.id} className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text variant="subtitle">Passenger {index + 1}</Text>
                {/* The seat comes from the draft, not the form — it is not editable here. */}
                <Badge label={`Seat ${selectedSeats[index]?.seatNumber ?? ''}`} tone="primary" />
              </View>

              <FormInput
                control={control}
                name={`passengers.${index}.name`}
                label="Full name"
                placeholder="Juan Dela Cruz"
                autoCapitalize="words"
                autoComplete="name"
              />

              {/*
                A Controller rather than watch() + setValue: `watch` returns a
                new function identity on every render, which the React Hooks
                lint rule flags as unmemoizable, and Controller is the API
                intended for a non-native input like this Select.
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
          ))}
        </View>

        <Text variant="caption" tone="muted" className="mt-4">
          Contact details are used only for trip updates. We ask for as little as possible — see the
          privacy note in your profile.
        </Text>

        <Button
          label="Reserve seats"
          className="mt-6"
          loading={reserve.isPending}
          onPress={onSubmit}
        />

        <Text variant="caption" tone="muted" className="mt-3 text-center">
          Your seats are held for 10 minutes while you pay.
        </Text>
      </KeyboardAvoidingView>
    </Screen>
  );
}
