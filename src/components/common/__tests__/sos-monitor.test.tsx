import { render, screen, userEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { SOSMonitor, sosCallUrl, sosMapUrl } from '@/components/common/sos-monitor';
import type { SOSResponderIncident } from '@/services/sos-service';

// `mock` prefix: jest hoists jest.mock() above the imports and only lets its
// factory reach variables named this way.
let mockIncidents: { data?: SOSResponderIncident[]; isLoading: boolean; isError: boolean };
const mockAcknowledge = jest.fn();

const mockIdle = { mutateAsync: jest.fn(), isPending: false, variables: undefined };

jest.mock('@/hooks/use-sos', () => ({
  useActiveSOSIncidents: () => ({ ...mockIncidents, refetch: jest.fn() }),
  useAcknowledgeSOS: () => ({ ...mockIdle, mutateAsync: mockAcknowledge }),
  useRespondSOS: () => mockIdle,
  useResolveSOS: () => mockIdle,
  useSOSSubscription: () => undefined,
}));

const incident: SOSResponderIncident = {
  id: 'sos-1',
  userId: 'u-1',
  bookingId: null,
  tripId: 't-1',
  latitude: 9.74,
  longitude: 118.74,
  status: 'ACTIVE',
  note: null,
  createdAt: new Date().toISOString(),
  acknowledgedAt: null,
  respondingAt: null,
  resolvedAt: null,
  passengerName: 'Maria Santos',
  passengerPhone: '+63 917 555 0101',
  tripNumber: 'CHERRY-0919-A',
  departureAt: null,
  operatorName: 'Cherry Bus',
  busNumber: 'CB-12',
  routeLabel: 'Puerto Princesa → El Nido',
};

describe('SOSMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('says plainly when nothing is open', async () => {
    mockIncidents = { data: [], isLoading: false, isError: false };
    await render(<SOSMonitor emptyHint="Quiet." />);
    expect(screen.getByText('No open emergency alerts')).toBeTruthy();
    expect(screen.getByText('Quiet.')).toBeTruthy();
  });

  it('names the passenger, the trip and the coach — not just coordinates', async () => {
    mockIncidents = { data: [incident], isLoading: false, isError: false };
    await render(<SOSMonitor />);
    expect(screen.getByText('Maria Santos')).toBeTruthy();
    expect(screen.getByText('CHERRY-0919-A · CB-12 · Puerto Princesa → El Nido')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy(); // status in words, not colour alone
  });

  it('calls the passenger and opens the map', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockIncidents = { data: [incident], isLoading: false, isError: false };
    const user = userEvent.setup();
    await render(<SOSMonitor />);

    await user.press(screen.getByLabelText('Call Maria Santos on +63 917 555 0101'));
    expect(open).toHaveBeenCalledWith('tel:+639175550101');

    await user.press(screen.getByLabelText("Open the passenger's location in a map"));
    expect(open).toHaveBeenCalledWith(sosMapUrl(9.74, 118.74));
  });

  it('offers no call button when the passenger gave no phone number', async () => {
    mockIncidents = {
      data: [{ ...incident, passengerPhone: null }],
      isLoading: false,
      isError: false,
    };
    await render(<SOSMonitor />);
    expect(screen.queryByText('Call passenger')).toBeNull();
  });

  it('says when an alert has no trip to route it to', async () => {
    mockIncidents = {
      data: [{ ...incident, tripId: null, tripNumber: null, busNumber: null, routeLabel: null }],
      isLoading: false,
      isError: false,
    };
    await render(<SOSMonitor />);
    expect(screen.getByText('Not on a trip — no operator to route this to')).toBeTruthy();
  });

  it('acknowledges the alert it was pressed on', async () => {
    mockAcknowledge.mockResolvedValue({ id: 'sos-1', status: 'ACKNOWLEDGED', changed: true });
    mockIncidents = { data: [incident], isLoading: false, isError: false };
    const user = userEvent.setup();
    await render(<SOSMonitor />);
    await user.press(screen.getByLabelText('Acknowledge this alert'));
    expect(mockAcknowledge).toHaveBeenCalledWith('sos-1');
  });
});

describe('sos links', () => {
  it('strips formatting from a phone number', () => {
    expect(sosCallUrl('+63 (917) 555-0101')).toBe('tel:+639175550101');
  });
});
