import { View } from 'react-native';
import { Mail, ShieldCheck } from 'lucide-react-native';

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
import { useRequestPasswordReset } from '@/hooks/use-auth-mutations';
import { useUIStore } from '@/stores/ui-store';

/**
 * Operator account screen.
 *
 * Account details and sign-out only — operator *business* settings (company
 * profile, fleet, crew) arrive with the rest of the operator app in Phase 7.
 * It exists now because Phase 2 owns sign-out, and an operator with no way to
 * sign out is a broken build.
 */
export default function OperatorProfileScreen() {
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
            <Text variant="subtitle">{profile.fullName || 'Operator'}</Text>
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
