import { Tabs } from 'expo-router';
import { Gift, House, Ticket, Wallet, User } from 'lucide-react-native';

import { AuthGate } from '@/components/common/auth-gate';
import { UserRole } from '@/constants/enums';
import { Colors } from '@/constants/theme';

/**
 * Passenger tab bar.
 *
 * Notifications, tracking and SOS are routes in this group but not tabs — they
 * are pushed from the home screen and from notifications, so they are declared
 * with `href: null` to keep them out of the bar while staying navigable.
 *
 * The gate is navigation only. Every table behind these screens is
 * independently protected by RLS — see docs/security.md.
 *
 * DRIVER and ASSISTANT were admitted here until Phase 8, because crew had
 * nowhere else to go. They now have `(driver)`, so they are no longer allowed
 * in the passenger app: a crew account is a work account, and leaving the old
 * allowance in place meant a signed-in driver could sit in the passenger tabs
 * looking at a wallet and a rewards balance that are not theirs to have.
 */
export default function UserLayout() {
  return (
    <AuthGate allow={[UserRole.USER, UserRole.ADMIN]}>
      <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: { backgroundColor: Colors.surface, borderTopColor: Colors.border },
        tabBarLabelStyle: { fontSize: 11 },
      }}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: 'Tickets',
          tabBarIcon: ({ color, size }) => <Ticket color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color, size }) => <Wallet color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: 'Rewards',
          tabBarIcon: ({ color, size }) => <Gift color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />

        <Tabs.Screen name="notifications" options={{ href: null }} />
        <Tabs.Screen name="tracking" options={{ href: null }} />
        <Tabs.Screen name="sos" options={{ href: null }} />
        <Tabs.Screen name="discount" options={{ href: null }} />
      </Tabs>
    </AuthGate>
  );
}
