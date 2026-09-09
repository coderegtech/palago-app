/**
 * Booking form validation.
 *
 * These are UX guard rails. Every one of them is re-checked by `reserve_seats`
 * on the server, which is what actually decides whether a booking is valid —
 * see docs/database.md.
 */

import { z } from 'zod';

import { PassengerType } from '@/constants/enums';
import { MAX_PASSENGERS_PER_BOOKING } from '@/constants/config';

export const tripSearchSchema = z
  .object({
    originTerminalId: z.uuid({ error: 'Choose where you are leaving from' }),
    destinationTerminalId: z.uuid({ error: 'Choose where you are going' }),
    /** `YYYY-MM-DD`. */
    departureDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Choose a travel date' }),
    passengers: z
      .number()
      .int()
      .min(1, { error: 'At least one passenger' })
      .max(MAX_PASSENGERS_PER_BOOKING, {
        error: `Up to ${MAX_PASSENGERS_PER_BOOKING} passengers per booking`,
      }),
  })
  .refine((data) => data.originTerminalId !== data.destinationTerminalId, {
    error: 'Origin and destination must be different',
    path: ['destinationTerminalId'],
  });
export type TripSearchInput = z.infer<typeof tripSearchSchema>;

const phone = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((value) => !value || /^(\+?63|0)?9\d{9}$/.test(value.replace(/[\s-]/g, '')), {
    error: 'Enter a valid Philippine mobile number',
  });

export const passengerDetailSchema = z.object({
  seatId: z.uuid(),
  seatNumber: z.string(),
  name: z
    .string()
    .trim()
    .min(2, { error: "Enter the passenger's full name" })
    .max(100, { error: 'Name must be 100 characters or fewer' }),
  phone,
  email: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((value) => !value || z.email().safeParse(value).success, {
      error: 'Enter a valid email address',
    }),
  type: z.enum(
    [
      PassengerType.ADULT,
      PassengerType.CHILD,
      PassengerType.SENIOR,
      PassengerType.STUDENT,
      PassengerType.PWD,
    ],
    { error: 'Choose a passenger type' },
  ),
});
export type PassengerDetailInput = z.infer<typeof passengerDetailSchema>;

export const passengersFormSchema = z.object({
  passengers: z.array(passengerDetailSchema).min(1).max(MAX_PASSENGERS_PER_BOOKING),
});
export type PassengersFormInput = z.infer<typeof passengersFormSchema>;
