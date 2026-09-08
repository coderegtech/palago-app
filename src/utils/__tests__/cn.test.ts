import { cn } from '@/utils/cn';

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
  });

  it('drops falsy values', () => {
    expect(cn('px-4', false && 'py-2', undefined, null)).toBe('px-4');
  });

  it('lets a later class win over an earlier one for the same property', () => {
    // This is the whole point of using tailwind-merge: a component default must
    // be overridable by the caller's className.
    expect(cn('bg-primary', 'bg-danger')).toBe('bg-danger');
  });
});
