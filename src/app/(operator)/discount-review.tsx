/**
 * Reviewing discount claims.
 *
 * The reviewer is deciding whether a stranger pays 20% less on every future
 * booking, so three things are deliberate:
 *
 *   * **The ID is only ever shown through a short-lived signed URL.** The
 *     bucket is private and serves nothing over its public route; the link is
 *     minted on demand and stops working within minutes.
 *   * **Rejecting requires a reason.** It is shown to the passenger, and "no"
 *     with no explanation just produces another upload of the same photo.
 *   * **A decision cannot be reversed here.** The server refuses it. Approving
 *     something already approved is a no-op rather than an error, because a
 *     double tap on a slow connection is ordinary.
 */

import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { IdCard, ShieldCheck } from 'lucide-react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { usePendingDiscountReviews, useReviewDiscount } from '@/hooks/use-discount';
import { AppError } from '@/lib/errors';
import {
  DISCOUNT_LABELS,
  discountService,
  type DiscountEligibility,
} from '@/services/discount-service';

function ReviewCard({ submission }: { submission: DiscountEligibility }) {
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadingProof, setLoadingProof] = useState(false);

  const review = useReviewDiscount();

  const openProof = useCallback(async () => {
    setError(null);
    setLoadingProof(true);
    try {
      setProofUrl(await discountService.proofUrl(submission.proofPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the document.');
    } finally {
      setLoadingProof(false);
    }
  }, [submission.proofPath]);

  const decide = useCallback(
    async (approve: boolean) => {
      setError(null);
      if (!approve && !note.trim()) {
        setError('Say why, so the passenger knows what to fix.');
        return;
      }
      try {
        await review.mutateAsync({
          id: submission.id,
          approve,
          note: note.trim() || undefined,
        });
      } catch (err) {
        setError(
          err instanceof AppError || err instanceof Error
            ? err.message
            : 'The decision did not go through.',
        );
      }
    },
    [note, review, submission.id],
  );

  return (
    <Card className="gap-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="bodyStrong">{DISCOUNT_LABELS[submission.kind]}</Text>
          <Text variant="caption" tone="muted">
            Sent {new Date(submission.submittedAt).toLocaleString()}
          </Text>
        </View>
        <IdCard size={20} color={Colors.textMuted} />
      </View>

      {proofUrl ? (
        <Image
          source={{ uri: proofUrl }}
          style={{ width: '100%', height: 220, borderRadius: 12 }}
          contentFit="contain"
          accessibilityLabel="The submitted identity document"
        />
      ) : (
        <Button
          label={loadingProof ? 'Opening…' : 'View the ID'}
          variant="secondary"
          onPress={openProof}
          loading={loadingProof}
          accessibilityLabel="View the submitted identity document"
        />
      )}

      <Divider />

      <Input
        label="Note to the passenger"
        placeholder="Required when rejecting"
        value={note}
        onChangeText={setNote}
        multiline
      />

      {error ? <Alert tone="danger" title="Not saved" message={error} /> : null}

      <View className="flex-row gap-2">
        <Button
          label="Reject"
          variant="secondary"
          onPress={() => decide(false)}
          disabled={review.isPending}
          className="flex-1"
          accessibilityLabel="Reject this discount claim"
        />
        <Button
          label="Approve"
          onPress={() => decide(true)}
          loading={review.isPending}
          disabled={review.isPending}
          className="flex-1"
          accessibilityLabel="Approve this discount claim"
        />
      </View>
    </Card>
  );
}

export default function DiscountReviewScreen() {
  const pending = usePendingDiscountReviews();

  return (
    <Screen padded={false}>
      <ScrollView contentContainerClassName="gap-4 px-4 pb-8" showsVerticalScrollIndicator={false}>
        <Header
          title="Discount claims"
          subtitle="Senior, student and PWD IDs waiting to be checked"
        />

        <Card className="flex-row gap-3 border-info/40 bg-info-soft">
          <ShieldCheck size={18} color={Colors.info} />
          <Text variant="caption" tone="muted" className="flex-1">
            Approving sets a 20% discount on one seat of every booking this passenger makes. Check
            the name and the ID number are readable, and that the document has not expired.
          </Text>
        </Card>

        {pending.isPending ? (
          <Skeleton className="h-40" />
        ) : pending.isError ? (
          <ErrorState message="Could not load the queue." onRetry={() => pending.refetch()} />
        ) : !pending.data?.length ? (
          <EmptyState title="Nothing waiting" message="Claims appear here as passengers send them." />
        ) : (
          pending.data.map((submission) => (
            <ReviewCard key={submission.id} submission={submission} />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
