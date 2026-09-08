import { render, screen, userEvent } from '@testing-library/react-native';

import { Button } from '@/components/ui/button';

/**
 * Also acts as the NativeWind smoke test: if the `jsxImportSource` transform or
 * the `className` prop were misconfigured, rendering a styled component here
 * would throw rather than fail an assertion.
 */
describe('Button', () => {
  it('renders its label', async () => {
    await render(<Button label="Book a trip" />);
    expect(screen.getByText('Book a trip')).toBeTruthy();
  });

  it('calls onPress when tapped', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(<Button label="Continue" onPress={onPress} />);

    await user.press(screen.getByRole('button', { name: 'Continue' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire while loading', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(<Button label="Confirm" loading onPress={onPress} />);

    await user.press(screen.getByRole('button', { name: 'Confirm' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('reports its disabled state to assistive technology', async () => {
    await render(<Button label="Pay" disabled />);
    expect(screen.getByRole('button', { name: 'Pay' })).toBeDisabled();
  });
});
