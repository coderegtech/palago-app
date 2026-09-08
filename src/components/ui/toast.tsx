import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from '@/components/ui/alert';
import { useUIStore, type Toast as ToastModel } from '@/stores/ui-store';

const TOAST_DURATION_MS = 4000;

function ToastItem({ toast }: { toast: ToastModel }) {
  const dismissToast = useUIStore((state) => state.dismissToast);

  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast.id, dismissToast]);

  return (
    <Pressable accessibilityLabel="Dismiss notification" onPress={() => dismissToast(toast.id)}>
      <Alert tone={toast.tone} title={toast.title} message={toast.message} className="shadow-sm" />
    </Pressable>
  );
}

/**
 * Renders the toast queue. Mounted once at the root, above the router, so any
 * screen can call `useUIStore.getState().showToast(...)`.
 */
export function ToastHost() {
  const toasts = useUIStore((state) => state.toasts);
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{ top: insets.top + 8 }}
      className="absolute left-4 right-4 z-50 gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </View>
  );
}
