import { Tabs } from 'expo-router';
import { QrCode, Route, User } from 'lucide-react-native';

import { AuthGate } from '@/components/common/auth-gate';
import { UserRole } from '@/constants/enums';
import { Colors } from '@/constants/theme';

/**
 * The driver and assistant app.
 *
 * Separate from `(operator)` on purpose. Crew must not see the operator's
 * revenue and fleet, and the operator console's `AuthGate` allows only
 * OPERATOR and ADMIN — before Phase 8 a DRIVER signing in was sent to the
 * *passenger* app, which is why this group exists.
 *
 * Deliberately small: three tabs. A driver uses this while responsible for a
 * bus full of people, so anything not needed at the wheel is not here.
 */
export default function DriverLayout() {
  return (
    <AuthGate allow={[UserRole.DRIVER, UserRole.ASSISTANT]}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.textMuted,
          tabBarStyle: { backgroundColor: Colors.surface, borderTopColor: Colors.border },
          tabBarLabelStyle: { fontSize: 11 },
        }}>
        <Tabs.Screen
          name="duty"
          options={{
            title: 'My trips',
            tabBarIcon: ({ color, size }) => <Route color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="scan"
          options={{
            title: 'Scan',
            tabBarIcon: ({ color, size }) => <QrCode color={color} size={size} />,
          }}
        />
        {/*
          Named `crew-account`, not `account` or `profile`: route groups do not
          appear in the URL, so it would collide with `(operator)/account.tsx`
          and `(user)/profile.tsx` and resolve to whichever the router reached
          first. That bug cost an afternoon in Phase 7.
        */}
        <Tabs.Screen
          name="crew-account"
          options={{
            title: 'Account',
            tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
          }}
        />

        {/* Pushed from the duty board rather than shown in the bar. */}
        <Tabs.Screen name="trip" options={{ href: null }} />
      </Tabs>
    </AuthGate>
  );
}
