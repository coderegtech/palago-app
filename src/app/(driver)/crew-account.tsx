import { View } from 'react-native';
import { CalendarCheck, CalendarOff, Mail, ShieldCheck } from 'lucide-react-native';

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
import { AvailabilityStatus } from '@/constants/enums';
import { useAuth, useProfile } from '@/hooks/use-auth';
import { useCrew, useSetMyAvailability } from '@/hooks/use-staff';
import { useRequestPasswordReset } from '@/hooks/use-auth-mutations';
import { useUIStore } from '@/stores/ui-store';

/**
 * Crew account screen.
 *
 * Separate file from `(operator)/account.tsx` because route groups do not
 * appear in the URL: two screens named `account` in different groups would both
 * resolve to `/account` and silently collide.
 *
 * A driver cannot edit their name, licence or account status here — those
 * belong to the operator who employs them. Availability is different, and is
 * theirs: it is the difference between "I can be rostered" and "I may sign
 * in", and only the second is the operator's to decide.
 *
 * The distinction is the whole reason there are two status fields. Under the
 * single `staff_status` these replaced, letting a driver set their own status
 * really would have let them undo a suspension — which is why this screen used
 * to say duty status was the operator's alone. It is not the same lever.
 */
export default function CrewAccountScreen() {
  const { email } = useAuth();
  const { data: profile, isPending, isError, refetch } = useProfile();
  const requestReset = useRequestPasswordReset();
  const showToast = useUIStore((state) => state.showToast);

  // `operator_crew` is scoped inside the view: a driver who manages nobody sees
  // exactly their own row, so this needs no id and cannot return anyone else's.
  const crew = useCrew();
  const me = crew.data?.[0];
  const setMyAvailability = useSetMyAvailability();
  const available = me?.availabilityStatus === AvailabilityStatus.AVAILABLE;

  const setAvailability = (status: AvailabilityStatus) =>
    setMyAvailability.mutate(
      { status },
      {
        onSuccess: () =>
          showToast({
            tone: 'success',
            title:
              status === AvailabilityStatus.AVAILABLE
                ? 'You are available for trips'
                : 'You are marked unavailable',
            message:
              status === AvailabilityStatus.AVAILABLE
                ? 'Your operator can roster you again.'
                : 'Your operator will not put you on new trips. Trips already assigned to you are unchanged.',
          }),
        onError: () => showToast({ tone: 'danger', title: 'Could not change your availability' }),
      },
    );

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
        message="Your name, licence details and whether your account is active are set by your operator. Ask them to change anything that is wrong here."
        className="mt-4"
      />

      <Alert
        tone="info"
        title="Location is shared only during a trip"
        message="PalaGo shares the bus position while a trip is running and the trip screen is open. It never tracks you in the background or between trips."
        className="mt-3"
      />

      {me ? (
        <>
          <Divider className="my-6" />

          <Text variant="label" tone="muted" className="mb-3">
            Availability
          </Text>

          <Card className="gap-3">
            {/* A word, not a colour — status is never conveyed by colour alone. */}
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="bodyStrong">
                {available ? 'Available for trips' : 'Not available for trips'}
              </Text>
              <Badge
                label={available ? 'AVAILABLE' : 'UNAVAILABLE'}
                tone={available ? 'success' : 'warning'}
              />
            </View>

            <Text variant="caption" tone="muted">
              This is yours to set. It decides whether your operator can put you on a{' '}
              <Text variant="caption" className="font-semibold">
                new
              </Text>{' '}
              trip — it does not sign you out, and it does not take you off a trip you are already
              on. Only your operator can do either of those.
            </Text>

            {me.unavailableReason ? (
              <Text variant="caption" tone="muted">
                Reason on file: {me.unavailableReason}
              </Text>
            ) : null}

            <Button
              label={available ? 'Mark me unavailable' : 'Mark me available'}
              variant={available ? 'outline' : 'primary'}
              loading={setMyAvailability.isPending}
              icon={
                available ? (
                  <CalendarOff size={18} color={Colors.primary} />
                ) : (
                  <CalendarCheck size={18} color={Colors.surface} />
                )
              }
              onPress={() =>
                setAvailability(
                  available ? AvailabilityStatus.UNAVAILABLE : AvailabilityStatus.AVAILABLE,
                )
              }
            />
          </Card>
        </>
      ) : null}

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
