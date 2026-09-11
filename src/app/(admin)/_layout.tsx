import { Slot, usePathname, useRouter, type Href } from 'expo-router';
import { Building2, Bus, LayoutDashboard, MapPin, Route } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthGate } from '@/components/common/auth-gate';
import { PalaGoLogo } from '@/components/common/palago-logo';
import { SignOutButton } from '@/components/common/sign-out-button';
import { Text } from '@/components/ui/text';
import { UserRole } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useIsDesktop, useIsWide } from '@/hooks/use-breakpoint';
import { cn } from '@/utils/cn';

/**
 * One definition, two chrome styles. The sidebar and the bottom bar render from
 * this same list, so they cannot drift out of step.
 */
const NAV = [
  { href: '/(admin)/overview', pathname: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/(admin)/operators', pathname: '/operators', label: 'Operators', icon: Building2 },
  { href: '/(admin)/terminals', pathname: '/terminals', label: 'Terminals', icon: MapPin },
  { href: '/(admin)/routes', pathname: '/routes', label: 'Routes', icon: Route },
  { href: '/(admin)/fleet', pathname: '/fleet', label: 'Fleet', icon: Bus },
] as const satisfies readonly {
  href: Href;
  pathname: string;
  label: string;
  icon: typeof LayoutDashboard;
}[];

function useActive() {
  const pathname = usePathname();
  // Route groups do not appear in the URL, so `/(admin)/overview` arrives here
  // as `/overview`.
  return (item: (typeof NAV)[number]) => pathname.startsWith(item.pathname);
}

function Sidebar() {
  const router = useRouter();
  const isActive = useActive();
  const isWide = useIsWide();
  const { profile } = useAuth();

  return (
    <View
      className={cn(
        'h-full border-r border-border bg-surface',
        // Icon rail on a narrow desktop window, full labels once there is room.
        isWide ? 'w-[248px]' : 'w-[76px]',
      )}>
      <View className={cn('gap-1 py-5', isWide ? 'px-4' : 'items-center px-2')}>
        <PalaGoLogo size="sm" layout={isWide ? 'horizontal' : 'mark'} />
        {isWide ? (
          <Text variant="caption" tone="muted">
            Admin console
          </Text>
        ) : null}
      </View>

      <View className={cn('flex-1 gap-1', isWide ? 'px-3' : 'items-center px-2')}>
        {NAV.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <Pressable
              key={item.pathname}
              accessibilityRole="link"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
              onPress={() => router.replace(item.href)}
              className={cn(
                'min-h-[44px] flex-row items-center gap-3 rounded-xl',
                isWide ? 'px-3 py-2.5' : 'w-[52px] justify-center py-2.5',
                active ? 'bg-primary-soft' : 'active:bg-background-tint',
              )}>
              <Icon size={20} color={active ? Colors.primary : Colors.textMuted} />
              {isWide ? (
                <Text
                  variant="body"
                  className={cn('font-medium', active ? 'text-primary' : 'text-content-muted')}>
                  {item.label}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View className={cn('gap-2 border-t border-border py-4', isWide ? 'px-3' : 'items-center px-2')}>
        {isWide ? (
          <View className="px-1">
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {profile?.fullName ?? 'Administrator'}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1} className="text-[10px]">
              {profile?.email ?? ''}
            </Text>
          </View>
        ) : null}
        <SignOutButton compact={!isWide} />
      </View>
    </View>
  );
}

function BottomBar() {
  const router = useRouter();
  const isActive = useActive();

  return (
    <View className="flex-row border-t border-border bg-surface">
      {NAV.map((item) => {
        const active = isActive(item);
        const Icon = item.icon;
        return (
          <Pressable
            key={item.pathname}
            accessibilityRole="link"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
            onPress={() => router.replace(item.href)}
            className="min-h-[52px] flex-1 items-center justify-center gap-1 py-2">
            <Icon size={20} color={active ? Colors.primary : Colors.textMuted} />
            <Text
              variant="caption"
              className={cn('text-[11px]', active ? 'text-primary' : 'text-content-muted')}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Admin console shell.
 *
 * A sidebar from `md` up, a bottom bar below it — the same five destinations
 * either way. This is a `Slot` rather than `Tabs` because a dashboard's chrome
 * sits beside the content, and React Navigation's bottom-tabs can only place
 * its bar below. The admin screens are flat lists with no nested stacks, so
 * there is no per-tab navigation state to give up by doing it this way.
 *
 * Screens are named so they cannot collide with existing routes: route groups
 * do not appear in the URL, so `overview` not `dashboard`, `fleet` not `buses`.
 *
 * The gate is navigation only. What actually stops a non-admin reading or
 * writing any of this is RLS — `admin_dashboard` raises FORBIDDEN without
 * `is_admin()`, and the reference-data policies carry the same check.
 */
export default function AdminLayout() {
  const isDesktop = useIsDesktop();

  return (
    <AuthGate allow={[UserRole.ADMIN]}>
      <SafeAreaView className="flex-1 bg-background" edges={isDesktop ? ['top'] : ['top', 'bottom']}>
        <View className={cn('flex-1', isDesktop && 'flex-row')}>
          {isDesktop ? <Sidebar /> : null}

          {/*
            No ScrollView here on purpose. Every admin screen owns its own
            scrolling — `Screen scroll` or a FlatList — and nesting either
            inside a parent ScrollView breaks list virtualisation and warns.
            This is only the flex slot they fill; the content column's own
            width cap lives on each screen's `Screen maxWidth`.
          */}
          <View className="flex-1">
            <Slot />
          </View>

          {isDesktop ? null : <BottomBar />}
        </View>
      </SafeAreaView>
    </AuthGate>
  );
}
