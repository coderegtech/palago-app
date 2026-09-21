import { breakdownAddsUp, priceLines } from '@/components/payment/price-breakdown';
import { estimateBookingPrice } from '@/utils/pricing';

// ₱450.00, a real seeded fare.
const FARE = 45_000;

describe('estimateBookingPrice', () => {
  it('scenario 7 — a regular booking pays the fare plus the ₱10 fee', () => {
    const p = estimateBookingPrice(FARE, [{ type: 'ADULT' }]);
    expect(p).toMatchObject({ subtotal: 45_000, discount: 0, convenienceFee: 1_000, totalAmount: 46_000 });
  });

  it('scenario 8 — a discount comes off the fare and the fee is untouched', () => {
    const p = estimateBookingPrice(FARE, [{ type: 'STUDENT', proofPath: 'u/id.jpg' }]);
    // 20% of ₱450 is ₱90; the ₱10 fee is not discounted.
    expect(p).toMatchObject({ discount: 9_000, convenienceFee: 1_000, totalAmount: 37_000 });
  });

  it('charges the fee once per booking, not per passenger', () => {
    const p = estimateBookingPrice(FARE, [{ type: 'ADULT' }, { type: 'ADULT' }, { type: 'CHILD' }]);
    expect(p.totalAmount).toBe(3 * 45_000 + 1_000);
  });

  it('gives nothing for a claimed type with no photo', () => {
    expect(estimateBookingPrice(FARE, [{ type: 'SENIOR' }]).discount).toBe(0);
  });

  it("covers one line of the booker's verified kind without a photo, as the server does", () => {
    const p = estimateBookingPrice(FARE, [{ type: 'SENIOR' }, { type: 'SENIOR' }], 'SENIOR');
    expect(p.discount).toBe(9_000);
  });

  it('discounts every passenger that has a photo — booking for a family', () => {
    const p = estimateBookingPrice(FARE, [
      { type: 'ADULT' },
      { type: 'STUDENT', proofPath: 'u/a.jpg' },
      { type: 'SENIOR', proofPath: 'u/b.jpg' },
    ]);
    expect(p.discount).toBe(18_000);
    expect(p.totalAmount).toBe(3 * 45_000 - 18_000 + 1_000);
  });
});

describe('priceLines', () => {
  it('lays out base fare, discount, fee and adds up to the total', () => {
    const b = estimateBookingPrice(FARE, [{ type: 'PWD', proofPath: 'u/c.jpg' }]);
    expect(priceLines(b).map((l) => [l.label, l.amount])).toEqual([
      ['Base fare', 45_000],
      ['Discount', -9_000],
      ['Convenience fee', 1_000],
    ]);
    expect(breakdownAddsUp(b)).toBe(true);
  });

  it('shows a reward as its own line', () => {
    const lines = priceLines({
      subtotal: 45_000,
      discount: 0,
      loyaltyDiscount: 5_000,
      convenienceFee: 1_000,
      totalAmount: 41_000,
    });
    expect(lines.map((l) => l.key)).toEqual(['fare', 'discount', 'reward', 'fee']);
  });

  it('prints no discount as zero, never as a negative zero', () => {
    const [, discount] = priceLines(estimateBookingPrice(FARE, [{ type: 'ADULT' }]));
    expect(Object.is(discount.amount, -0)).toBe(false);
  });

  it('omits the fee line on a booking made before the fee existed', () => {
    const lines = priceLines({ subtotal: 45_000, discount: 0, loyaltyDiscount: 0, convenienceFee: 0, totalAmount: 45_000 });
    expect(lines.some((l) => l.key === 'fee')).toBe(false);
  });
});
