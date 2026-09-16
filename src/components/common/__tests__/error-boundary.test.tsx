/**
 * An error boundary nobody has seen catch anything is decoration.
 *
 * This is the one component in the app whose entire job only happens when
 * something else is already broken, so it is also the one least likely to be
 * exercised by hand — you would have to break a screen on purpose to find out
 * whether it works. These tests break one on purpose.
 *
 * React logs a caught render error to `console.error` regardless of whether a
 * boundary handled it. That is expected noise here, not a failure, so it is
 * silenced per-test rather than globally — silencing it globally would hide a
 * real unexpected error in some other suite.
 */

import { render, screen, userEvent } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AppErrorBoundary } from '@/components/common/error-boundary';

function Boom({ throws }: { throws: boolean }): React.ReactElement {
  if (throws) throw new Error('booking reference PAY-2026-000001 blew up');
  return <Text>The screen rendered</Text>;
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('AppErrorBoundary', () => {
  it('renders its children when nothing is wrong', async () => {
    await render(
      <AppErrorBoundary>
        <Boom throws={false} />
      </AppErrorBoundary>,
    );

    expect(screen.getByText('The screen rendered')).toBeTruthy();
  });

  it('shows a fallback instead of a white screen when a child throws', async () => {
    await render(
      <AppErrorBoundary>
        <Boom throws />
      </AppErrorBoundary>,
    );

    expect(screen.getByText('This screen could not be shown')).toBeTruthy();
    expect(screen.queryByText('The screen rendered')).toBeNull();
  });

  it('never puts the thrown message on screen', async () => {
    // The thrown value routinely carries a reference, an id, or a fragment of
    // somebody's data. This screen is as likely to be read over a shoulder at a
    // terminal as anywhere else; the detail belongs in Observe, not here.
    await render(
      <AppErrorBoundary>
        <Boom throws />
      </AppErrorBoundary>,
    );

    expect(screen.queryByText(/PAY-2026-000001/)).toBeNull();
    expect(screen.queryByText(/blew up/)).toBeNull();
  });

  it('reassures the passenger that their booking is unaffected', async () => {
    // The thing a passenger holding a paid ticket actually needs to know.
    await render(
      <AppErrorBoundary>
        <Boom throws />
      </AppErrorBoundary>,
    );

    expect(screen.getByText(/Nothing you have booked or paid for is affected/)).toBeTruthy();
  });

  it('offers a retry that re-mounts the subtree', async () => {
    const user = userEvent.setup();

    // A flag the test owns, not a render counter. React may invoke a render
    // more than once for a single attempt, so counting calls made this test
    // pass through recovery before the fallback was ever asserted — it looked
    // like the boundary had not caught anything.
    let broken = true;

    function Flaky() {
      if (broken) throw new Error('transient');
      return <Text>Recovered</Text>;
    }

    await render(
      <AppErrorBoundary>
        <Flaky />
      </AppErrorBoundary>,
    );

    expect(screen.getByText('This screen could not be shown')).toBeTruthy();

    // Whatever was wrong is now fixed — a stale query refetched, say.
    broken = false;
    await user.press(screen.getByLabelText('Reload this screen'));

    expect(screen.getByText('Recovered')).toBeTruthy();
    expect(screen.queryByText('This screen could not be shown')).toBeNull();
  });
});
