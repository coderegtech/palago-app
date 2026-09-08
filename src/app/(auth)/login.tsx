import { zodResolver } from '@hookform/resolvers/zod';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';

import { BrandHero } from '@/components/common/brand-hero';
import { FormInput } from '@/components/common/form-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useSignIn } from '@/hooks/use-auth-mutations';
import { AppError } from '@/lib/errors';
import { loginSchema, type LoginInput } from '@/schemas/auth';

export default function LoginScreen() {
  const [showPassword, setShowPassword] = useState(false);
  const signIn = useSignIn();

  const { control, handleSubmit } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit((values) => {
    signIn.mutate(values, {
      // The root layout's index route sends the user on to the right home once
      // the session lands, so this only has to leave the auth stack.
      onSuccess: () => router.replace('/'),
    });
  });

  const errorMessage = signIn.error
    ? signIn.error instanceof AppError
      ? signIn.error.message
      : 'Could not sign you in. Please try again.'
    : null;

  return (
    <Screen scroll>
      <BrandHero title="Welcome back" subtitle="Sign in to book your next trip." />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="pt-8">
        {errorMessage ? (
          <Alert tone="danger" title="Sign in failed" message={errorMessage} className="mb-4" />
        ) : null}

        <View className="gap-4">
          <FormInput
            control={control}
            name="email"
            label="Email"
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
          />

          <FormInput
            control={control}
            name="password"
            label="Password"
            placeholder="Your password"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={onSubmit}
            returnKeyType="go"
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
        </View>

        <Link href="/(auth)/forgot-password" asChild>
          <Pressable accessibilityRole="link" className="mt-3 self-end py-2">
            <Text variant="caption" tone="primary" className="font-semibold">
              Forgot password?
            </Text>
          </Pressable>
        </Link>

        <Button
          label="Sign in"
          className="mt-6"
          loading={signIn.isPending}
          onPress={onSubmit}
        />

        <View className="mt-6 flex-row items-center justify-center gap-1">
          <Text variant="body" tone="muted">
            New to PalaGo?
          </Text>
          <Link href="/(auth)/register" asChild>
            <Pressable accessibilityRole="link" accessibilityLabel="Create an account" hitSlop={8}>
              <Text variant="bodyStrong" tone="primary">
                Create an account
              </Text>
            </Pressable>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
