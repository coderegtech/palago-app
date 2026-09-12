/**
 * The in-progress booking.
 *
 * This is genuinely client state — a draft the user is assembling across three
 * screens that does not exist on the server until `create_booking` is called.
 * Trips and saved bookings are server state and live in TanStack Query, not
 * here.
 *
 * There is no seat in this draft, and that is the point: passengers do not
 * choose one, and which seat each traveller gets is decided server-side once
 * the payment is verified. What the draft carries is how many people are
 * travelling.
 *
 * Cleared once a booking is created, so backing into the funnel again cannot
 * resurrect a stale trip or somebody's half-typed passenger list.
 */

import { create } from 'zustand';

import type { PassengerDetailInput, TripSearchInput } from '@/schemas/booking';
import type { UUID } from '@/types/models';

interface BookingDraftState {
  search: TripSearchInput | null;
  tripId: UUID | null;
  /** How many seats the user set out to book. */
  passengerCount: number;
  passengers: PassengerDetailInput[];

  setSearch: (search: TripSearchInput) => void;
  selectTrip: (tripId: UUID, passengerCount: number) => void;
  setPassengers: (passengers: PassengerDetailInput[]) => void;
  reset: () => void;
}

const empty = {
  search: null,
  tripId: null,
  passengerCount: 1,
  passengers: [],
};

export const useBookingStore = create<BookingDraftState>((set) => ({
  ...empty,

  setSearch: (search) => set({ search, passengerCount: search.passengers }),

  // Changing trip drops any half-filled passenger list with it: those details
  // were entered for a different departure.
  selectTrip: (tripId, passengerCount) => set({ tripId, passengerCount, passengers: [] }),

  setPassengers: (passengers) => set({ passengers }),
  reset: () => set(empty),
}));
