import { centavosToPesos, formatMoney, pesosToCentavos } from '@/utils/money';

describe('money', () => {
  it('converts pesos to integer centavos', () => {
    expect(pesosToCentavos(450)).toBe(45000);
    expect(pesosToCentavos(450.5)).toBe(45050);
  });

  it('rounds rather than truncating fractional centavos', () => {
    expect(pesosToCentavos(0.005)).toBe(1);
    expect(pesosToCentavos(0.004)).toBe(0);
  });

  it('converts centavos back to pesos', () => {
    expect(centavosToPesos(45000)).toBe(450);
  });

  it('formats with two decimals and the peso symbol', () => {
    expect(formatMoney(45000)).toBe('₱450.00');
    expect(formatMoney(0)).toBe('₱0.00');
    expect(formatMoney(45050)).toBe('₱450.50');
  });

  it('formats large amounts with thousands separators', () => {
    expect(formatMoney(12_400_000)).toBe('₱124,000.00');
  });

  it('can omit the symbol', () => {
    expect(formatMoney(45000, { symbol: false })).toBe('450.00');
  });
});
