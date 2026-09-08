import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';

import { FormInput } from '@/components/common/form-input';
import { BrandHero } from '@/components/common/brand-hero';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useUpdatePassword } from '@/hooks/use-auth-mutations';
import { AppError } from '@/lib/errors';
import { PASSWORD_MIN_LENGTH, updatePasswordSchema, type UpdatePasswordInput } from '@/schemas/auth';

/**
 * Target of the password-reset email.
 *
 * Lives at the root rather than inside `(auth)` because the user arrives here
 * carrying a recovery token, and supabase-js turns that into a real session
 * (`detectSessionInUrl` on web). An `(auth)` layout that bounces signed-in
 * users to the home screen would therefore throw them straight back out.
 */
export default function ResetPasswordScreen() {
  const [showPassword, setShowPassword] = useState(false);
  const { initialized, isAuthenticated } = useAuth();
  const updatePassword = useUpdatePassword();

  const { control, handleSubmit } = useForm<UpdatePasswordInput>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(({ password }) => updatePassword.mutate(password));

  const errorMessage = updatePassword.error
    ? updatePassword.error instanceof AppError
      ? updatePassword.error.message
      : 'Could not update your password. Please try again.'
    : null;

  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
      <BrandHero title="Set a new password" size="md" withTagline={false} />

      <View className="pt-8" />

      {updatePassword.isSuccess ? (
        <View className="gap-6">
          <Alert
            tone="success"
            title="Password updated"
            message="You can now sign in with your new password."
          />
          <Button label="Continue" onPress={() => router.replace('/')} />
        </View>
      ) : !initialized ? null : !isAuthenticated ? (
        <View className="gap-6">
          <Alert
            tone="warning"
            title="This link is no longer valid"
            message="Reset links expire after one hour and can only be used once. Request a new one to continue."
          />
          <Button
            label="Request a new link"
            variant="outline"
            onPress={() => router.replace('/(auth)/forgot-password')}
          />
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {errorMessage ? (
            <Alert
              tone="danger"
              title="Could not update password"
              message={errorMessage}
              className="mb-4"
            />
          ) : null}

          <View className="gap-4">
            <FormInput
              control={control}
              name="password"
              label="New password"
              placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  hitSlop={12}
                  onPress={() => setShowPassword((current) => !current)}>
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
              placeholder="Re-enter your new password"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
          </View>

          <Button
            label="Update password"
            className="mt-6"
            loading={updatePassword.isPending}
            onPress={onSubmit}
          />
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}
