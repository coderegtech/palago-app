import { useBookingStore } from '@/stores/booking-store';

const passenger = (name: string) => ({
  name,
  phone: '',
  email: '',
  type: 'ADULT' as const,
});

describe('booking draft', () => {
  beforeEach(() => {
    useBookingStore.getState().reset();
  });

  it('starts empty', () => {
    const state = useBookingStore.getState();
    expect(state.tripId).toBeNull();
    expect(state.passengers).toEqual([]);
    expect(state.passengerCount).toBe(1);
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

  it('carries the passenger count onto the chosen trip', () => {
    const store = useBookingStore.getState();
    store.selectTrip('trip-1', 3);

    const state = useBookingStore.getState();
    expect(state.tripId).toBe('trip-1');
    expect(state.passengerCount).toBe(3);
  });

  it('drops half-filled passenger details when the trip changes', () => {
    // Those details were entered for a different departure; carrying them over
    // would quietly book strangers onto the new one.
    const store = useBookingStore.getState();
    store.selectTrip('trip-1', 2);
    store.setPassengers([passenger('Juan')]);
    expect(useBookingStore.getState().passengers).toHaveLength(1);

    useBookingStore.getState().selectTrip('trip-2', 2);
    expect(useBookingStore.getState().passengers).toEqual([]);
    expect(useBookingStore.getState().tripId).toBe('trip-2');
  });

  it('clears everything on reset, so a new funnel starts clean', () => {
    const store = useBookingStore.getState();
    store.selectTrip('trip-1', 2);
    store.setPassengers([passenger('Juan')]);

    useBookingStore.getState().reset();

    const state = useBookingStore.getState();
    expect(state.tripId).toBeNull();
    expect(state.passengers).toEqual([]);
    expect(state.passengerCount).toBe(1);
  });
});
