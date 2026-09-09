/**
 * The in-progress booking.
 *
 * This is genuinely client state — a draft the user is assembling across four
 * screens that does not exist on the server until `reserve_seats` is called.
 * Trips, seat maps and saved bookings are server state and live in TanStack
 * Query, not here.
 *
 * Cleared once a booking is created, so backing into the funnel again cannot
 * resurrect a stale trip or somebody's half-typed passenger list.
 */

import { create } from 'zustand';

import type { PassengerDetailInput, TripSearchInput } from '@/schemas/booking';
import type { UUID } from '@/types/models';

export interface SelectedSeat {
  seatId: UUID;
  seatNumber: string;
}

interface BookingDraftState {
  search: TripSearchInput | null;
  tripId: UUID | null;
  /** How many seats the user set out to book. */
  passengerCount: number;
  selectedSeats: SelectedSeat[];
  passengers: PassengerDetailInput[];

  setSearch: (search: TripSearchInput) => void;
  selectTrip: (tripId: UUID, passengerCount: number) => void;
  toggleSeat: (seat: SelectedSeat) => void;
  clearSeats: () => void;
  setPassengers: (passengers: PassengerDetailInput[]) => void;
  reset: () => void;
}

const empty = {
  search: null,
  tripId: null,
  passengerCount: 1,
  selectedSeats: [],
  passengers: [],
};

export const useBookingStore = create<BookingDraftState>((set, get) => ({
  ...empty,

  setSearch: (search) => set({ search, passengerCount: search.passengers }),

  // Changing trip invalidates any seat choice: seat ids belong to one departure.
  selectTrip: (tripId, passengerCount) =>
    set({ tripId, passengerCount, selectedSeats: [], passengers: [] }),

  toggleSeat: (seat) => {
    const { selectedSeats, passengerCount } = get();
    const already = selectedSeats.some((s) => s.seatId === seat.seatId);

    if (already) {
      set({ selectedSeats: selectedSeats.filter((s) => s.seatId !== seat.seatId) });
      return;
    }

    // Silently ignoring the tap is better than selecting a seat the user cannot
    // pay for; the screen shows the count so the limit is visible.
    if (selectedSeats.length >= passengerCount) return;

    set({ selectedSeats: [...selectedSeats, seat] });
  },

  clearSeats: () => set({ selectedSeats: [], passengers: [] }),
  setPassengers: (passengers) => set({ passengers }),
  reset: () => set(empty),
}));
