/**
 * Fare discount verification — senior, student and PWD.
 *
 * The screen is careful about one distinction, because getting it wrong would
 * be a lie about money: **uploading is not approval.** A submitted ID sits
 * PENDING until a person checks it, and until then bookings are charged at the
 * ordinary fare. Every state below says which of those two things is true.
 *
 * It also never states the discounted price itself. The reduction is computed
 * inside `reserve_seats` from the approved row; showing a number here would be
 * a second, drifting copy of a rule that decides what someone pays.
 */

import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { BadgeCheck, Clock, IdCard, TriangleAlert } from 'lucide-react-native';

import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import {
  useActiveDiscount,
  useMyDiscountSubmissions,
  useSubmitDiscountProof,
} from '@/hooks/use-discount';
import { AppError } from '@/lib/errors';
import {
  DISCOUNT_LABELS,
  PROOF_HINTS,
  discountService,
  type DiscountEligibility,
  type DiscountKind,
  type EligibilityStatus,
} from '@/services/discount-service';

const KINDS: DiscountKind[] = ['SENIOR', 'STUDENT', 'PWD'];

const STATUS_PRESENTATION: Record<
  EligibilityStatus,
  { label: string; tone: BadgeTone; meaning: string }
> = {
  PENDING: {
    label: 'Being checked',
    tone: 'warning',
    meaning: 'Sent for review. Bookings are charged the ordinary fare until it is approved.',
  },
  APPROVED: {
    label: 'Approved',
    tone: 'success',
    meaning: 'Verified. Your seat is discounted when you book with this passenger type.',
  },
  REJECTED: {
    label: 'Not approved',
    tone: 'danger',
    meaning: 'The ID could not be verified. You can upload a clearer photo.',
  },
  REVOKED: {
    label: 'Withdrawn',
    tone: 'neutral',
    meaning: 'This verification is no longer valid.',
  },
};

function SubmissionCard({ submission }: { submission: DiscountEligibility }) {
  const presentation = STATUS_PRESENTATION[submission.status];

  return (
    <Card className="gap-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="bodyStrong">{DISCOUNT_LABELS[submission.kind]}</Text>
          <Text variant="caption" tone="muted">
            Sent {new Date(submission.submittedAt).toLocaleDateString()}
          </Text>
        </View>
        <Badge label={presentation.label} tone={presentation.tone} />
      </View>

      <Text variant="caption" tone="muted">
        {presentation.meaning}
      </Text>

      {submission.reviewNote ? (
        <View className="rounded-lg bg-primary-soft p-2">
          <Text variant="caption">{submission.reviewNote}</Text>
        </View>
      ) : null}

      {submission.status === 'APPROVED' && submission.expiresAt ? (
        <Text variant="caption" tone="muted">
          Valid until {new Date(submission.expiresAt).toLocaleDateString()}
        </Text>
      ) : null}
    </Card>
  );
}

export default function DiscountScreen() {
  const [selected, setSelected] = useState<DiscountKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const active = useActiveDiscount();
  const submissions = useMyDiscountSubmissions();
  const submit = useSubmitDiscountProof();

  const hasOpenSubmission = submissions.data?.some((s) => s.status === 'PENDING') ?? false;
  const isVerified = Boolean(active.data);

  const upload = useCallback(async () => {
    if (!selected) return;
    setError(null);
    setPicking(true);
    try {
      const proof = await discountService.pickProof();
      // Backing out of the picker is not a failure — the passenger simply
      // carries on at the ordinary fare.
      if (!proof) return;
      await submit.mutateAsync({ kind: selected, proof });
      setSelected(null);
    } catch (err) {
      setError(
        err instanceof AppError || err instanceof Error
          ? err.message
          : 'The ID could not be sent. Nothing was saved.',
      );
    } finally {
      setPicking(false);
    }
  }, [selected, submit]);

  const busy = picking || submit.isPending;

  return (
    <ScrollView
      contentContainerClassName="gap-4 px-4 pb-8 pt-4"
      showsVerticalScrollIndicator={false}
    >
      <Card className="gap-2">
        <View className="flex-row items-center gap-2">
          <IdCard size={20} color={Colors.primary} />
          <Text variant="label">Discounted fares</Text>
        </View>
        <Text variant="caption" tone="muted">
          Seniors, students and persons with disability travel at 20% off. Upload your ID once and
          it applies to your seat on every booking.
        </Text>
      </Card>

      {active.isPending || submissions.isPending ? (
        <Skeleton className="h-32" />
      ) : submissions.isError ? (
        <ErrorState
          message="Could not load your verification status."
          onRetry={() => submissions.refetch()}
        />
      ) : isVerified ? (
        <Card className="gap-2 border-success/40 bg-success-soft">
          <View className="flex-row items-center gap-2">
            <BadgeCheck size={20} color={Colors.success} />
            <Text variant="bodyStrong">
              Verified as {DISCOUNT_LABELS[active.data as DiscountKind].toLowerCase()}
            </Text>
          </View>
          <Text variant="caption" tone="muted">
            Choose this passenger type when you book and 20% comes off that seat. The reduction is
            shown on the booking summary before you pay.
          </Text>
        </Card>
      ) : hasOpenSubmission ? (
        <Card className="gap-2 border-warning/40 bg-warning-soft">
          <View className="flex-row items-center gap-2">
            <Clock size={20} color={Colors.warning} />
            <Text variant="bodyStrong">Your ID is being checked</Text>
          </View>
          <Text variant="caption" tone="muted">
            You can book now, but the ordinary fare applies until someone has approved it.
          </Text>
        </Card>
      ) : (
        <Card className="gap-3">
          <Text variant="label" tone="muted">
            Which discount are you claiming?
          </Text>

          <View className="gap-2">
            {KINDS.map((kind) => {
              const isSelected = selected === kind;
              return (
                <Button
                  key={kind}
                  label={DISCOUNT_LABELS[kind]}
                  variant={isSelected ? 'primary' : 'secondary'}
                  onPress={() => setSelected(isSelected ? null : kind)}
                  accessibilityLabel={`Claim the ${DISCOUNT_LABELS[kind]} discount`}
                  accessibilityState={{ selected: isSelected }}
                />
              );
            })}
          </View>

          {selected ? (
            <>
              <Divider />
              <Text variant="caption" tone="muted">
                {PROOF_HINTS[selected]}
              </Text>
              <Text variant="caption" tone="muted">
                Make sure the name and the ID number are readable. The photo is private — only PalaGo
                staff reviewing it can open it.
              </Text>
              <Button
                label={busy ? 'Sending…' : 'Choose a photo of your ID'}
                onPress={upload}
                loading={busy}
                disabled={busy}
                accessibilityLabel="Choose a photo of your ID"
              />
            </>
          ) : null}

          {error ? <Alert tone="danger" title="Not sent" message={error} /> : null}
        </Card>
      )}

      <Card className="flex-row gap-3">
        <TriangleAlert size={18} color={Colors.textMuted} />
        <Text variant="caption" tone="muted" className="flex-1">
          Bring the same ID with you. Crew check it at the door, and a discounted ticket without a
          matching ID can be refused.
        </Text>
      </Card>

      {submissions.data?.length ? (
        <View className="gap-2">
          <Text variant="label" tone="muted">
            Your submissions
          </Text>
          {submissions.data.map((submission) => (
            <SubmissionCard key={submission.id} submission={submission} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
