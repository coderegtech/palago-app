import { Tabs } from 'expo-router';
import { BarChart3, LayoutDashboard, QrCode, User, Users } from 'lucide-react-native';

import { AuthGate } from '@/components/common/auth-gate';
import { UserRole } from '@/constants/enums';
import { Colors } from '@/constants/theme';

/**
 * Operator tab bar. Trips, buses, assistants and the operator profile are
 * pushed from within these tabs rather than shown in the bar.
 *
 * The gate keeps passengers out of the operator console, but it is navigation
 * only — operator data is protected by RLS scoped to the caller's operator, and
 * that is what actually enforces access. Phase 13 re-checks this.
 */
export default function OperatorLayout() {
  return (
    <AuthGate allow={[UserRole.OPERATOR, UserRole.ADMIN]}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.textMuted,
          tabBarStyle: { backgroundColor: Colors.surface, borderTopColor: Colors.border },
          tabBarLabelStyle: { fontSize: 11 },
        }}>
        <Tabs.Screen
          name="dashboard"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="travel-data"
          options={{
            title: 'Travel data',
            tabBarIcon: ({ color, size }) => <BarChart3 color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="drivers"
          options={{
            title: 'Crew',
            tabBarIcon: ({ color, size }) => <Users color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="scanner"
          options={{
            title: 'Scanner',
            tabBarIcon: ({ color, size }) => <QrCode color={color} size={size} />,
          }}
        />

        {/*
          Named `account`, not `profile`: route groups do not appear in the URL,
          so an `(operator)/profile.tsx` would collide with `(user)/profile.tsx`
          on the same `/profile` path and resolve ambiguously.
        */}
        <Tabs.Screen
          name="account"
          options={{
            title: 'Account',
            tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
          }}
        />

        {/* Pushed from within the tabs rather than shown in the bar. */}
        {/* Reached from the dashboard rather than the bar: five tabs is
            already the most that fits legibly on a phone. */}
        <Tabs.Screen name="crew" options={{ href: null }} />
        <Tabs.Screen name="trips" options={{ href: null }} />
        <Tabs.Screen name="buses" options={{ href: null }} />
        <Tabs.Screen name="manifest" options={{ href: null }} />
        <Tabs.Screen name="discount-review" options={{ href: null }} />
        <Tabs.Screen name="assisted-booking" options={{ href: null }} />
      </Tabs>
    </AuthGate>
  );
}
