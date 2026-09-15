/**
 * The forced password change, for an account provisioned with a temporary one.
 *
 * At the router root rather than inside a role group, for the same reason
 * `reset-password.tsx` is: whoever lands here is signed in, and every group
 * layout would otherwise either bounce them somewhere else or gate them behind
 * a console they are not supposed to reach yet.
 *
 * The temporary password was read off a screen, said aloud, or written on a
 * slip of paper at a counter. It has to stop working as soon as it has been
 * used once, and `AuthGate` is what makes that stick — it sends anybody with
 * `must_change_password` back here before any console renders.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pressable, View } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';

import { BrandHero } from '@/components/common/brand-hero';
import { FormInput } from '@/components/common/form-input';
import { SignOutButton } from '@/components/common/sign-out-button';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { homeRouteForRole } from '@/components/common/auth-gate';
import { useAuth, useProfile } from '@/hooks/use-auth';
import { useUpdatePassword } from '@/hooks/use-auth-mutations';
import { AppError } from '@/lib/errors';
import { staffService } from '@/services/staff-service';
import { updatePasswordSchema, type UpdatePasswordInput } from '@/schemas/auth';
import { useUIStore } from '@/stores/ui-store';

export default function ChangePasswordScreen() {
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const { initialized, isAuthenticated, role } = useAuth();
  const { refetch } = useProfile();
  const updatePassword = useUpdatePassword();
  const showToast = useUIStore((state) => state.showToast);

  const { control, handleSubmit } = useForm<UpdatePasswordInput>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ password }) => {
    setSaving(true);
    try {
      await updatePassword.mutateAsync(password);

      // Only after the new password is actually set. Clearing the flag first
      // would leave somebody looking at a console with a password they were
      // told to change and never did.
      await staffService.markPasswordChanged();
      await refetch();

      showToast({ tone: 'success', title: 'Password updated' });
      router.replace(homeRouteForRole(role));
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not set your password',
        message:
          error instanceof AppError ? error.message : 'Please check your connection and try again.',
      });
    } finally {
      setSaving(false);
    }
  });

  if (!initialized) return null;
  if (!isAuthenticated) return <Screen />;

  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
      <BrandHero title="Choose your password" size="md" withTagline={false} />

      <View className="gap-6 pt-8">
        <Alert
          tone="info"
          title="This account was set up for you"
          message="The password you were given is temporary. Choose one only you know before you carry on."
        />

        <FormInput
          control={control}
          name="password"
          label="New password"
          placeholder="At least 8 characters"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          trailing={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              onPress={() => setShowPassword((v) => !v)}>
              {showPassword ? (
                <EyeOff size={18} color={Colors.textMuted} />
              ) : (
                <Eye size={18} color={Colors.textMuted} />
              )}
            </Pressable>
          }
        />

        <FormInput
          control={control}
          name="confirmPassword"
          label="Confirm new password"
          placeholder="Type it again"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
        />

        <Button label="Save and continue" loading={saving} onPress={() => void onSubmit()} />

        <View className="gap-2">
          <Text variant="caption" tone="muted" className="text-center">
            Not your account? Sign out and ask whoever set it up.
          </Text>
          <SignOutButton />
        </View>
      </View>
    </Screen>
  );
}
