import { View } from 'react-native';
import { Mail, ShieldCheck } from 'lucide-react-native';

import { SignOutButton } from '@/components/common/sign-out-button';
import { Alert } from '@/components/ui/alert';
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
import { useRequestPasswordReset } from '@/hooks/use-auth-mutations';
import { useUIStore } from '@/stores/ui-store';

/**
 * Crew account screen.
 *
 * Separate file from `(operator)/account.tsx` because route groups do not
 * appear in the URL: two screens named `account` in different groups would both
 * resolve to `/account` and silently collide.
 *
 * A driver cannot edit their own crew record here. Name, licence and duty
 * status belong to the operator who employs them, and a driver quietly marking
 * themselves ACTIVE would put them back on a roster they were taken off.
 */
export default function CrewAccountScreen() {
  const { email } = useAuth();
  const { data: profile, isPending, isError, refetch } = useProfile();
  const requestReset = useRequestPasswordReset();
  const showToast = useUIStore((state) => state.showToast);

  if (isPending) return <Loading label="Loading your account…" />;

  if (isError || !profile) {
    return (
      <Screen>
        <Header title="Account" />
        <ErrorState
          message="We could not load your account. Check your connection and try again."
          onRetry={() => refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title="Account" />

      <Card>
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text variant="subtitle">{profile.fullName || 'Crew'}</Text>
            <View className="mt-1 flex-row items-center gap-1.5">
              <Mail size={14} color={Colors.textMuted} />
              <Text variant="caption" tone="muted">
                {profile.email}
              </Text>
            </View>
          </View>
          <Badge label={profile.role} tone="primary" />
        </View>
      </Card>

      <Alert
        tone="info"
        title="Your crew record is managed by your operator"
        message="Your name, licence details and duty status are set by your operator. Ask them to change anything that is wrong here."
        className="mt-4"
      />

      <Alert
        tone="info"
        title="Location is shared only during a trip"
        message="PalaGo shares the bus position while a trip is running and the trip screen is open. It never tracks you in the background or between trips."
        className="mt-3"
      />

      <Divider className="my-6" />

      <Text variant="label" tone="muted" className="mb-3">
        Security
      </Text>

      <Button
        label="Change password"
        variant="outline"
        loading={requestReset.isPending}
        icon={<ShieldCheck size={18} color={Colors.primary} />}
        onPress={() => {
          if (!email) return;
          requestReset.mutate(email, {
            onSuccess: () =>
              showToast({
                tone: 'success',
                title: 'Check your email',
                message: `We sent a password reset link to ${email}.`,
              }),
            onError: () => showToast({ tone: 'danger', title: 'Could not send the reset email' }),
          });
        }}
      />

      <SignOutButton className="mt-6" />
    </Screen>
  );
}
