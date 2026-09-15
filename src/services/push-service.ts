/**
 * Push notifications.
 *
 * This module only ever *registers* a device. It cannot send anything: the
 * token is stored by `register_push_token`, and the message is composed
 * server-side from a `notifications` row by the `send-push` Edge Function. A
 * client that could push would be a client that could tell a passenger their
 * payment went through when it did not.
 *
 * Push is deliberately narrower than the in-app feed. The feed works
 * everywhere, including web; push needs a real device and a build with native
 * push credentials. `assessPushSupport` names which of those is missing so the
 * settings screen can say so instead of showing a switch that silently does
 * nothing — the same problem `src/lib/web-camera.ts` exists to solve.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type PushBlocker = 'web' | 'simulator' | 'expo-go-android' | 'no-project-id';

export type PushSupport = { ok: true } | { ok: false; reason: PushBlocker };

export interface PushEnvironment {
  platform: typeof Platform.OS;
  /** `Device.isDevice` — false in a simulator or emulator. */
  isPhysicalDevice: boolean;
  /** `Constants.appOwnership === 'expo'`, i.e. running inside Expo Go. */
  isExpoGo: boolean;
  projectId: string | undefined;
}

/**
 * Pure, so the decision can be tested without a device.
 *
 * Order matters. Web is checked first because every later question is about a
 * handset, and a browser would otherwise be reported as "not a real device",
 * which is both confusing and not the reason.
 */
export function assessPushSupport(env: PushEnvironment): PushSupport {
  // expo-notifications' remote push is Android/iOS only. The web build is the
  // operator console and the public payment page; realtime already covers both.
  if (env.platform === 'web') return { ok: false, reason: 'web' };
  if (!env.isPhysicalDevice) return { ok: false, reason: 'simulator' };
  // Expo Go dropped remote push on Android in SDK 53. It fails at
  // getExpoPushTokenAsync with a message about a development build, which is
  // worth saying up front rather than surfacing as an error.
  if (env.isExpoGo && env.platform === 'android') return { ok: false, reason: 'expo-go-android' };
  // Expo's push service issues tokens per project; without the id there is
  // nothing to scope the token to.
  if (!env.projectId) return { ok: false, reason: 'no-project-id' };
  return { ok: true };
}

export function readPushEnvironment(): PushEnvironment {
  return {
    platform: Platform.OS,
    isPhysicalDevice: Device.isDevice,
    isExpoGo: Constants.appOwnership === 'expo',
    projectId:
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined,
  };
}

export const PUSH_BLOCKER_COPY: Record<PushBlocker, string> = {
  web: 'Push notifications are only available in the PalaGo app on a phone. Alerts still appear here while PalaGo is open.',
  simulator: 'Push notifications need a real phone. A simulator cannot receive them.',
  'expo-go-android':
    'Push notifications need the installed PalaGo app. Expo Go on Android cannot receive them.',
  'no-project-id': 'This build is not set up for push notifications.',
};

export type PushPermission = 'granted' | 'denied' | 'undetermined';

/**
 * What to do with a notification that arrives while the app is open.
 *
 * Shown as a banner rather than swallowed: the events that produce one —
 * payment cleared, trip cancelled, SOS acknowledged — matter whichever screen
 * the passenger happens to be on. Registered at module scope, as the API
 * requires, but it is inert until a notification actually arrives.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Android 8+ discards notifications with no channel. `default` matches the
  // channelId the Edge Function sends.
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Trip updates',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

export const pushService = {
  support(): PushSupport {
    return assessPushSupport(readPushEnvironment());
  },

  async permission(): Promise<PushPermission> {
    if (assessPushSupport(readPushEnvironment()).ok === false) return 'denied';
    const { status } = await Notifications.getPermissionsAsync();
    return status as PushPermission;
  },

  /**
   * Ask, get a token, store it. Returns the token, or null with the reason it
   * could not — never a thrown error for the ordinary case of someone saying no.
   */
  async register(): Promise<{ token: string } | { token: null; reason: PushBlocker | 'denied' }> {
    const support = assessPushSupport(readPushEnvironment());
    if (!support.ok) return { token: null, reason: support.reason };

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    // Only prompt when the system will actually show a prompt. Once denied,
    // asking again does nothing on either platform; the person has to go to
    // system settings.
    if (status !== 'granted' && existing.canAskAgain) {
      status = (await Notifications.requestPermissionsAsync()).status;
    }

    if (status !== 'granted') return { token: null, reason: 'denied' };

    await ensureAndroidChannel();

    const { projectId } = readPushEnvironment();
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS,
      p_device_name: Device.deviceName ?? undefined,
    });

    if (error) throw toAppError(error);
    return { token };
  },

  /**
   * Called on sign-out. Without it the handset keeps receiving the previous
   * passenger's trip alerts until somebody else signs in on it.
   */
  async unregister(token: string): Promise<void> {
    const { error } = await supabase.rpc('remove_push_token', { p_token: token });
    if (error) throw toAppError(error);
  },

  /** The token this device already holds, without prompting for anything. */
  async currentToken(): Promise<string | null> {
    const env = readPushEnvironment();
    if (!assessPushSupport(env).ok) return null;

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return null;

    try {
      const { data } = await Notifications.getExpoPushTokenAsync({ projectId: env.projectId });
      return data;
    } catch {
      // Expo's token endpoint is a network call and can simply be unreachable.
      return null;
    }
  },
};
