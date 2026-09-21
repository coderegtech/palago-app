import { passengersMissingIdPhoto, requiresIdPhoto } from '@/utils/passenger-proof';

describe('requiresIdPhoto', () => {
  it('asks for a photo only for discounted types', () => {
    expect(requiresIdPhoto('ADULT')).toBe(false);
    expect(requiresIdPhoto('CHILD')).toBe(false);
    expect(requiresIdPhoto('STUDENT')).toBe(true);
    expect(requiresIdPhoto('SENIOR')).toBe(true);
    expect(requiresIdPhoto('PWD')).toBe(true);
  });
});

describe('passengersMissingIdPhoto', () => {
  it('asks nothing of a regular booking', () => {
    expect(passengersMissingIdPhoto([{ type: 'ADULT' }, { type: 'CHILD' }], null)).toEqual([]);
  });

  it('asks for a photo for a student someone else is booking for', () => {
    expect(passengersMissingIdPhoto([{ type: 'ADULT' }, { type: 'STUDENT' }], null)).toEqual([1]);
  });

  it('is satisfied once the photo is attached', () => {
    expect(
      passengersMissingIdPhoto([{ type: 'STUDENT', proofPath: 'u/1.jpg' }], null),
    ).toEqual([]);
  });

  it('lets a verified booker cover one line of their own kind, as the server does', () => {
    expect(passengersMissingIdPhoto([{ type: 'SENIOR' }], 'SENIOR')).toEqual([]);
    // A second senior is someone else, and needs their own photo.
    expect(passengersMissingIdPhoto([{ type: 'SENIOR' }, { type: 'SENIOR' }], 'SENIOR')).toEqual([1]);
    // A verified senior does not cover a student.
    expect(passengersMissingIdPhoto([{ type: 'STUDENT' }], 'SENIOR')).toEqual([0]);
  });
});
