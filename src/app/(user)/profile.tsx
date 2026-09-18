import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { IdCard, Mail, ShieldCheck } from 'lucide-react-native';

import { FormInput } from '@/components/common/form-input';
import { SignOutButton } from '@/components/common/sign-out-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useAuth, useProfile } from '@/hooks/use-auth';
import { useRequestPasswordReset, useUpdateProfile } from '@/hooks/use-auth-mutations';
import { AppError } from '@/lib/errors';
import { profileSchema, type ProfileInput } from '@/schemas/auth';
import { useUIStore } from '@/stores/ui-store';

export default function ProfileScreen() {
  const router = useRouter();
  const { email } = useAuth();
  const { data: profile, isPending, isError, refetch } = useProfile();
  const updateProfile = useUpdateProfile();
  const requestReset = useRequestPasswordReset();
  const showToast = useUIStore((state) => state.showToast);

  const { control, handleSubmit, reset, formState } = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: '',
      phone: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
    },
  });

  // The form is populated from the server's row once it arrives, and again
  // whenever it changes, so the fields never drift from what was saved.
  useEffect(() => {
    if (!profile) return;
    reset({
      fullName: profile.fullName,
      phone: profile.phone ?? '',
      emergencyContactName: profile.emergencyContactName ?? '',
      emergencyContactPhone: profile.emergencyContactPhone ?? '',
    });
  }, [profile, reset]);

  const onSave = handleSubmit((values) => {
    updateProfile.mutate(values, {
      onSuccess: () => showToast({ tone: 'success', title: 'Profile saved' }),
      onError: (error) =>
        showToast({
          tone: 'danger',
          title: 'Could not save profile',
          message: error instanceof AppError ? error.message : undefined,
        }),
    });
  });

  const onChangePassword = () => {
    if (!email) return;
    requestReset.mutate(email, {
      onSuccess: () =>
        showToast({
          tone: 'success',
          title: 'Check your email',
          message: `We sent a password reset link to ${email}.`,
        }),
      onError: () =>
        showToast({ tone: 'danger', title: 'Could not send the reset email' }),
    });
  };

  if (isPending) return <Loading label="Loading your profile…" />;

  if (isError || !profile) {
    return (
      <Screen>
        <Header title="Profile" />
        <ErrorState
          message="We could not load your profile. Check your connection and try again."
          onRetry={() => refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title="Profile" />

      <Card className="mb-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text variant="subtitle">{profile.fullName || 'Your name'}</Text>
            <View className="mt-1 flex-row items-center gap-1.5">
              <Mail size={14} color={Colors.textMuted} />
              <Text variant="caption" tone="muted">
                {profile.email}
              </Text>
            </View>
          </View>
          {/* Role is display-only. The database revokes the column grant that
              would let an account holder change it. */}
          <View className="items-end gap-1">
            <Badge label={profile.role} tone="primary" />
            {profile.isTestAccount ? <Badge label="TEST ACCOUNT" tone="warning" /> : null}
          </View>
        </View>
      </Card>

      <Text variant="label" tone="muted" className="mb-3">
        Your details
      </Text>

      <View className="gap-4">
        <FormInput
          control={control}
          name="fullName"
          label="Full name"
          placeholder="Juan Dela Cruz"
          autoCapitalize="words"
        />
        <FormInput
          control={control}
          name="phone"
          label="Mobile number"
          placeholder="0917 123 4567"
          keyboardType="phone-pad"
        />
      </View>

      <Divider className="my-6" />

      <Text variant="label" tone="muted" className="mb-1">
        Emergency contact
      </Text>
      <Text variant="caption" tone="muted" className="mb-3">
        Notified automatically if you trigger an SOS during a trip.
      </Text>

      <View className="gap-4">
        <FormInput
          control={control}
          name="emergencyContactName"
          label="Contact name"
          placeholder="Maria Dela Cruz"
          autoCapitalize="words"
        />
        <FormInput
          control={control}
          name="emergencyContactPhone"
          label="Contact number"
          placeholder="0917 765 4321"
          keyboardType="phone-pad"
        />
      </View>

      <Button
        label="Save changes"
        className="mt-6"
        loading={updateProfile.isPending}
        disabled={!formState.isDirty}
        onPress={onSave}
      />

      <Divider className="my-6" />

      <Text variant="label" tone="muted" className="mb-3">
        Fares
      </Text>

      <Button
        label="Discount verification"
        variant="outline"
        icon={<IdCard size={18} color={Colors.primary} />}
        onPress={() => router.push('/discount')}
      />
      <Text variant="caption" tone="muted" className="mt-2">
        Seniors, students and persons with disability travel at 20% off once an ID is approved.
      </Text>

      <Divider className="my-6" />

      <Text variant="label" tone="muted" className="mb-3">
        Security
      </Text>

      <Button
        label="Change password"
        variant="outline"
        loading={requestReset.isPending}
        icon={<ShieldCheck size={18} color={Colors.primary} />}
        onPress={onChangePassword}
      />
      <Text variant="caption" tone="muted" className="mt-2">
        We&apos;ll email you a secure link to set a new password.
      </Text>

      <SignOutButton className="mt-6" />
    </Screen>
  );
}
