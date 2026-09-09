import { passengerDetailSchema, tripSearchSchema } from '@/schemas/booking';
import { MAX_PASSENGERS_PER_BOOKING } from '@/constants/config';
import { PassengerType } from '@/constants/enums';

const uuidA = '11111111-1111-4111-8111-111111111111';
const uuidB = '22222222-2222-4222-8222-222222222222';

const validSearch = {
  originTerminalId: uuidA,
  destinationTerminalId: uuidB,
  departureDate: '2026-09-15',
  passengers: 2,
};

describe('tripSearchSchema', () => {
  it('accepts a valid search', () => {
    expect(tripSearchSchema.safeParse(validSearch).success).toBe(true);
  });

  it('rejects the same terminal for origin and destination', () => {
    const result = tripSearchSchema.safeParse({
      ...validSearch,
      destinationTerminalId: uuidA,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/must be different/i);
  });

  it('rejects a malformed date', () => {
    expect(tripSearchSchema.safeParse({ ...validSearch, departureDate: '15/09/2026' }).success).toBe(
      false,
    );
  });

  it('requires at least one passenger', () => {
    expect(tripSearchSchema.safeParse({ ...validSearch, passengers: 0 }).success).toBe(false);
  });

  it('caps the party size', () => {
    expect(
      tripSearchSchema.safeParse({ ...validSearch, passengers: MAX_PASSENGERS_PER_BOOKING }).success,
    ).toBe(true);
    expect(
      tripSearchSchema.safeParse({
        ...validSearch,
        passengers: MAX_PASSENGERS_PER_BOOKING + 1,
      }).success,
    ).toBe(false);
  });
});

describe('passengerDetailSchema', () => {
  const valid = {
    seatId: uuidA,
    seatNumber: '1A',
    name: 'Juan Dela Cruz',
    phone: '09171234567',
    email: 'juan@example.com',
    type: PassengerType.ADULT,
  };

  it('accepts a complete passenger', () => {
    expect(passengerDetailSchema.safeParse(valid).success).toBe(true);
  });

  it('treats phone and email as optional', () => {
    expect(passengerDetailSchema.safeParse({ ...valid, phone: '', email: '' }).success).toBe(true);
  });

  it('requires a real name', () => {
    expect(passengerDetailSchema.safeParse({ ...valid, name: ' ' }).success).toBe(false);
    expect(passengerDetailSchema.safeParse({ ...valid, name: 'J' }).success).toBe(false);
  });

  it('trims the name', () => {
    const parsed = passengerDetailSchema.parse({ ...valid, name: '  Ana Cruz  ' });
    expect(parsed.name).toBe('Ana Cruz');
  });

  it('accepts the three ways a PH mobile is written', () => {
    for (const phone of ['09171234567', '+639171234567', '0917 123 4567', '9171234567']) {
      expect(passengerDetailSchema.safeParse({ ...valid, phone }).success).toBe(true);
    }
  });

  it('rejects a phone number that is not a PH mobile', () => {
    expect(passengerDetailSchema.safeParse({ ...valid, phone: '12345' }).success).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(passengerDetailSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects an unknown passenger type', () => {
    expect(passengerDetailSchema.safeParse({ ...valid, type: 'VIP' }).success).toBe(false);
  });
});
