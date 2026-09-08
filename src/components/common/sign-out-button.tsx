import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { LogOut } from 'lucide-react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Colors } from '@/constants/theme';
import { useSignOut } from '@/hooks/use-auth-mutations';

/**
 * Sign out, behind a confirmation. Shared by the passenger and operator
 * profiles so both get the same guard against an accidental tap — losing a
 * session mid-trip is worse than one extra tap.
 */
export function SignOutButton({ className }: { className?: string }) {
  const [confirming, setConfirming] = useState(false);
  const signOut = useSignOut();

  return (
    <>
      <Button
        label="Sign out"
        variant="ghost"
        className={className}
        icon={<LogOut size={18} color={Colors.primary} />}
        onPress={() => setConfirming(true)}
      />

      <Modal
        visible={confirming}
        onClose={() => setConfirming(false)}
        title="Sign out?"
        dismissOnBackdropPress={false}>
        <Alert
          tone="info"
          title="You'll need to sign in again"
          message="Your bookings and tickets stay safe on your account."
        />
        <View className="mt-4 gap-2">
          <Button
            label="Sign out"
            variant="danger"
            loading={signOut.isPending}
            onPress={() =>
              signOut.mutate(undefined, {
                onSuccess: () => {
                  setConfirming(false);
                  router.replace('/(auth)/login');
                },
              })
            }
          />
          <Button label="Cancel" variant="ghost" onPress={() => setConfirming(false)} />
        </View>
      </Modal>
    </>
  );
}
