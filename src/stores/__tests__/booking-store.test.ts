import { useBookingStore } from '@/stores/booking-store';

const seat = (n: string) => ({ seatId: `seat-${n}`, seatNumber: n });

describe('booking draft', () => {
  beforeEach(() => {
    useBookingStore.getState().reset();
  });

  it('starts empty', () => {
    const state = useBookingStore.getState();
    expect(state.selectedSeats).toEqual([]);
    expect(state.tripId).toBeNull();
  });

  it('takes the passenger count from the search', () => {
    useBookingStore.getState().setSearch({
      originTerminalId: 'a',
      destinationTerminalId: 'b',
      departureDate: '2026-09-15',
      passengers: 3,
    });
    expect(useBookingStore.getState().passengerCount).toBe(3);
  });

  it('selects and deselects seats', () => {
    const store = useBookingStore.getState();
    store.selectTrip('trip-1', 2);

    store.toggleSeat(seat('1A'));
    expect(useBookingStore.getState().selectedSeats).toHaveLength(1);

    store.toggleSeat(seat('1A'));
    expect(useBookingStore.getState().selectedSeats).toHaveLength(0);
  });

  it('will not select more seats than there are passengers', () => {
    const store = useBookingStore.getState();
    store.selectTrip('trip-1', 2);

    store.toggleSeat(seat('1A'));
    store.toggleSeat(seat('1B'));
    store.toggleSeat(seat('1C'));

    const { selectedSeats } = useBookingStore.getState();
    expect(selectedSeats).toHaveLength(2);
    expect(selectedSeats.map((s) => s.seatNumber)).toEqual(['1A', '1B']);
  });

  it('frees a slot when a seat is deselected', () => {
    const store = useBookingStore.getState();
    store.selectTrip('trip-1', 1);

    store.toggleSeat(seat('1A'));
    store.toggleSeat(seat('1A'));
    store.toggleSeat(seat('2B'));

    expect(useBookingStore.getState().selectedSeats.map((s) => s.seatNumber)).toEqual(['2B']);
  });

  it('discards seat choices when the trip changes', () => {
    // Seat ids belong to one departure, so carrying them across trips would
    // send stale ids to reserve_seats.
    const store = useBookingStore.getState();
    store.selectTrip('trip-1', 2);
    store.toggleSeat(seat('1A'));
    expect(useBookingStore.getState().selectedSeats).toHaveLength(1);

    useBookingStore.getState().selectTrip('trip-2', 2);
    expect(useBookingStore.getState().selectedSeats).toEqual([]);
    expect(useBookingStore.getState().tripId).toBe('trip-2');
  });

  it('clears everything on reset, so a new funnel starts clean', () => {
    const store = useBookingStore.getState();
    store.selectTrip('trip-1', 2);
    store.toggleSeat(seat('1A'));
    store.setPassengers([
      { seatId: 'seat-1A', seatNumber: '1A', name: 'Juan', phone: '', email: '', type: 'ADULT' },
    ]);

    useBookingStore.getState().reset();

    const state = useBookingStore.getState();
    expect(state.tripId).toBeNull();
    expect(state.selectedSeats).toEqual([]);
    expect(state.passengers).toEqual([]);
  });
});
