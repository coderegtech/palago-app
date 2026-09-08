import { zodResolver } from '@hookform/resolvers/zod';
import { Link, router } from 'expo-router';
import { Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';

import { BrandHero } from '@/components/common/brand-hero';
import { FormInput } from '@/components/common/form-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useSignUp } from '@/hooks/use-auth-mutations';
import { AppError } from '@/lib/errors';
import { PASSWORD_MIN_LENGTH, registerSchema, type RegisterInput } from '@/schemas/auth';

export default function RegisterScreen() {
  const [showPassword, setShowPassword] = useState(false);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
  const signUp = useSignUp();

  const { control, handleSubmit } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: '', email: '', phone: '', password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(({ fullName, email, phone, password }) => {
    signUp.mutate(
      { fullName, email, phone, password },
      {
        onSuccess: (session) => {
          // With email confirmations enabled the account exists but there is no
          // session yet, so we must not pretend the user is signed in.
          if (session) router.replace('/');
          else setNeedsEmailConfirmation(true);
        },
      },
    );
  });

  const errorMessage = signUp.error
    ? signUp.error instanceof AppError
      ? signUp.error.message
      : 'Could not create your account. Please try again.'
    : null;

  if (needsEmailConfirmation) {
    return (
      <Screen scroll>
        <Header title="Check your email" showBack />
        <Alert
          tone="success"
          title="Account created"
          message="We sent you a confirmation link. Open it to finish setting up your PalaGo account, then sign in."
          className="mt-4"
        />
        <Button
          label="Back to sign in"
          variant="outline"
          className="mt-6"
          onPress={() => router.replace('/(auth)/login')}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BrandHero
        title="Create your account"
        subtitle="Book Cherry Bus and RoRo Bus trips across Palawan."
        withTagline={false}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="pt-8">
        {errorMessage ? (
          <Alert
            tone="danger"
            title="Registration failed"
            message={errorMessage}
            className="mb-4"
          />
        ) : null}

        <View className="gap-4">
          <FormInput
            control={control}
            name="fullName"
            label="Full name"
            placeholder="Juan Dela Cruz"
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
          />

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
            name="phone"
            label="Mobile number"
            placeholder="0917 123 4567"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
          />

          <FormInput
            control={control}
            name="password"
            label="Password"
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
            label="Confirm password"
            placeholder="Re-enter your password"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmitEditing={onSubmit}
            returnKeyType="go"
          />
        </View>

        <Button
          label="Create account"
          className="mt-6"
          loading={signUp.isPending}
          onPress={onSubmit}
        />

        <View className="mt-6 flex-row items-center justify-center gap-1">
          <Text variant="body" tone="muted">
            Already have an account?
          </Text>
          <Link href="/(auth)/login" asChild>
            <Pressable accessibilityRole="link" accessibilityLabel="Sign in" hitSlop={8}>
              <Text variant="bodyStrong" tone="primary">
                Sign in
              </Text>
            </Pressable>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
