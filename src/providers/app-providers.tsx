import { QueryClientProvider } from '@tanstack/react-query';
import { DefaultTheme, ThemeProvider } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary } from '@/components/common/error-boundary';
import { ToastHost } from '@/components/ui/toast';
import { NavigationColors } from '@/constants/theme';
import { useAuthBootstrap } from '@/hooks/use-auth';
import { queryClient } from '@/lib/query-client';

const palagoNavigationTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, ...NavigationColors },
};

/**
 * Starts the session listener. It sits inside QueryClientProvider because it
 * clears cached queries on sign-out, and it renders nothing so that resolving
 * the session never blocks the tree — the public payment page must display
 * while this is still in flight.
 */
function AuthBootstrap() {
  useAuthBootstrap();
  return null;
}

/**
 * Root providers.
 *
 * Deliberately minimal: no auth *gate*, no camera/location/notification
 * permissions. The public payment page (`/payment/[reference]`) renders inside
 * this same tree in a logged-out browser, so anything that requires a session
 * or a native permission belongs in a group layout — see `AuthGate`.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthBootstrap />
        <SafeAreaProvider>
          <ThemeProvider value={palagoNavigationTheme}>
            {/*
              Inside the providers, so the fallback can draw a real screen; around
              the routes rather than around the whole tree, so a screen that throws
              does not take the toast host or the theme down with it.
            */}
            <AppErrorBoundary>{children}</AppErrorBoundary>
            <ToastHost />
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
