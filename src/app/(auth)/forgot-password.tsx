import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { FormInput } from '@/components/common/form-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useRequestPasswordReset } from '@/hooks/use-auth-mutations';
import { AppError } from '@/lib/errors';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@/schemas/auth';

export default function ForgotPasswordScreen() {
  const requestReset = useRequestPasswordReset();

  const { control, handleSubmit } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(({ email }) => requestReset.mutate(email));

  const errorMessage = requestReset.error
    ? requestReset.error instanceof AppError
      ? requestReset.error.message
      : 'Could not send the reset email. Please try again.'
    : null;

  return (
    <Screen scroll>
      <Header title="Reset password" showBack />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {requestReset.isSuccess ? (
          <View className="gap-6">
            {/*
              Deliberately worded so it reads the same whether or not an account
              exists. Confirming that an address is registered would turn this
              form into an account-enumeration tool.
            */}
            <Alert
              tone="success"
              title="Check your email"
              message="If that address has a PalaGo account, we've sent a link to reset the password. The link expires in one hour."
            />
            <Button
              label="Back to sign in"
              variant="outline"
              onPress={() => router.replace('/(auth)/login')}
            />
          </View>
        ) : (
          <>
            <Text variant="body" tone="muted" className="mb-6">
              Enter the email address on your account and we&apos;ll send you a link to set a new
              password.
            </Text>

            {errorMessage ? (
              <Alert
                tone="danger"
                title="Something went wrong"
                message={errorMessage}
                className="mb-4"
              />
            ) : null}

            <FormInput
              control={control}
              name="email"
              label="Email"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />

            <Button
              label="Send reset link"
              className="mt-6"
              loading={requestReset.isPending}
              onPress={onSubmit}
            />
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
