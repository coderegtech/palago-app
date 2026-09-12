import { render, screen, userEvent } from '@testing-library/react-native';

import type { BoardingDoor } from '@/components/common/boarding-door';
import { BoardingTripPicker } from '@/components/common/boarding-trip-picker';

// `mock` prefix: jest hoists jest.mock() above the imports and only lets its
// factory reach variables named this way.
const mockMutate = jest.fn();

jest.mock('@/hooks/use-tracking', () => ({
  useSetTripBoarding: () => ({ mutate: mockMutate, isPending: false, variables: undefined, error: null }),
}));

jest.mock('@/components/ui/header', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { Header: ({ title }: { title: string }) => React.createElement(Text, null, title) };
});

const base: Omit<BoardingDoor, 'tripId' | 'tripNumber' | 'status'> = {
  departureDate: '2026-09-11',
  departureTime: '06:00:00',
  originCode: 'PPS',
  destinationCode: 'ELN',
  busNumber: '12',
  passengerCount: 4,
  boardedCount: 0,
};

const boarding: BoardingDoor = { ...base, tripId: 'a', tripNumber: 'CHERRY-0911-A', status: 'BOARDING' };
const scheduled: BoardingDoor = {
  ...base,
  tripId: 'b',
  tripNumber: 'CHERRY-0911-B',
  status: 'SCHEDULED',
  departureTime: '13:00:00',
};
const departed: BoardingDoor = { ...base, tripId: 'y', tripNumber: 'CHERRY-0911-Y', status: 'DEPARTED' };

function renderPicker(props: Partial<React.ComponentProps<typeof BoardingTripPicker>> = {}) {
  const onChoose = jest.fn();
  const result = render(
    <BoardingTripPicker
      doors={[scheduled, departed, boarding]}
      isPending={false}
      isError={false}
      onRetry={jest.fn()}
      onChoose={onChoose}
      canOpenBoarding
      {...props}
    />,
  );
  return { onChoose, result };
}

describe('BoardingTripPicker', () => {
  beforeEach(() => mockMutate.mockReset());

  it('does not offer a trip that has already left', async () => {
    await renderPicker().result;
    expect(screen.queryByText('CHERRY-0911-Y')).toBeNull();
    expect(screen.getByText('CHERRY-0911-A')).toBeTruthy();
    expect(screen.getByText('CHERRY-0911-B')).toBeTruthy();
  });

  it('scans straight away at a trip that is boarding', async () => {
    const user = userEvent.setup();
    const { onChoose, result } = renderPicker();
    await result;

    await user.press(screen.getByRole('button', { name: 'Scan passengers for CHERRY-0911-A' }));
    expect(onChoose).toHaveBeenCalledWith(boarding);
  });

  it('opens boarding first for a scheduled trip, then scans it', async () => {
    const user = userEvent.setup();
    const { onChoose, result } = renderPicker();
    await result;

    await user.press(screen.getByRole('button', { name: 'Open boarding for CHERRY-0911-B' }));
    expect(mockMutate).toHaveBeenCalledWith('b', expect.any(Object));

    // The scanner opens only once the server has actually opened boarding.
    expect(onChoose).not.toHaveBeenCalled();
    mockMutate.mock.calls[0][1].onSuccess();
    expect(onChoose).toHaveBeenCalledWith({ ...scheduled, status: 'BOARDING' });
  });

  it('gives an assistant no "Open boarding" button the server would refuse', async () => {
    await renderPicker({ canOpenBoarding: false }).result;
    expect(screen.queryByRole('button', { name: 'Open boarding for CHERRY-0911-B' })).toBeNull();
    expect(screen.getByText('The driver has not opened boarding for this trip yet.')).toBeTruthy();
  });

  it('says so when there is nothing to board', async () => {
    await renderPicker({ doors: [departed] }).result;
    expect(screen.getByText('No trips to board')).toBeTruthy();
  });
});
