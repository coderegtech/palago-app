import { ObserveErrorBoundary } from 'expo-observe';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { View } from 'react-native';

/**
 * What a passenger sees when a screen throws while rendering.
 *
 * Without this, a render-phase error unmounts the whole tree and leaves a white
 * screen — on a release build with no dev overlay, that is the entire feedback
 * the user gets, and it looks identical to the app having quit. Phase 13's
 * review listed "no error monitoring" as a gap; this closes the half that the
 * person holding the phone experiences.
 *
 * `resetError` re-mounts the children from a clean state, so "Try again" is a
 * real offer rather than a button that re-renders the same broken tree. It is
 * worth having because most render-phase failures here would be transient —
 * a malformed row from a query that will succeed on the next fetch.
 *
 * Deliberately vague about what went wrong. The thrown value can carry a
 * booking reference, an id, or a fragment of somebody's data, and this screen
 * is as likely to be read over a shoulder at a terminal as anywhere else. The
 * detail goes to Observe, which is where it is useful.
 */
function Fallback({ resetError }: { error: unknown; resetError: () => void }) {
  return (
    <Screen scroll>
      <View className="flex-1 justify-center gap-6 py-12">
        <Alert
          tone="danger"
          title="This screen could not be shown"
          message="Something went wrong while drawing this page. Nothing you have booked or paid for is affected."
        />
        <Button label="Try again" onPress={resetError} accessibilityLabel="Reload this screen" />
        <Text variant="caption" tone="muted" className="text-center">
          If it keeps happening, close PalaGo and open it again. Your tickets are on the server, not
          on this device.
        </Text>
      </View>
    </Screen>
  );
}

/**
 * Catches render-phase errors anywhere in the route tree and records them.
 *
 * Render-phase errors never reach `global.ErrorUtils`, so a boundary is the
 * only way to capture one *with its component stack* — which is the part that
 * says which screen failed. Errors thrown outside render (in an event handler,
 * a timer, a promise) are picked up by the global handler instead, so between
 * the two nothing is lost.
 *
 * It sits inside `AppProviders`, not around it: the fallback renders `Screen`,
 * which needs the safe-area context, and a boundary that cannot draw its own
 * fallback is no better than the white screen it replaces.
 */
export function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ObserveErrorBoundary fallback={Fallback}>{children}</ObserveErrorBoundary>;
}
