/**
 * The ID photo for a senior, student or PWD passenger.
 *
 * Appears only when the passenger type needs one — a regular adult or child is
 * asked for nothing, so an ordinary booking stays exactly as simple as before.
 * Change the type back and the photo is dropped, so a discount can never ride
 * along on a line that no longer claims one.
 *
 * The photo is uploaded the moment it is picked, into the booker's own folder,
 * and only its path is kept in the form. That is what makes booking for someone
 * else work: Person A picks Person B's student ID from their own phone.
 */

import { Image } from 'expo-image';
import { Camera, CircleCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useController, useWatch, type Control } from 'react-hook-form';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useUploadPassengerProof } from '@/hooks/use-passenger-proof';
import { AppError } from '@/lib/errors';
import type { PassengersFormInput } from '@/schemas/booking';
import { DISCOUNT_LABELS, PROOF_HINTS, type DiscountKind } from '@/services/discount-service';
import { requiresIdPhoto } from '@/utils/passenger-proof';

export interface PassengerIdPhotoProps {
  control: Control<PassengersFormInput>;
  index: number;
}

export function PassengerIdPhoto({ control, index }: PassengerIdPhotoProps) {
  const type = useWatch({ control, name: `passengers.${index}.type` });
  const { field, fieldState } = useController({ control, name: `passengers.${index}.proofPath` });
  const upload = useUploadPassengerProof();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needed = requiresIdPhoto(type);
  const { value, onChange } = field;

  // Leaving a discounted type drops its photo — and with it any discount.
  useEffect(() => {
    // The preview needs no reset: it is only shown while a path is attached.
    if (!needed && value) onChange(undefined);
  }, [needed, value, onChange]);

  if (!needed) return null;

  const kind = type as DiscountKind;

  async function pick() {
    setError(null);
    try {
      const uploaded = await upload.mutateAsync();
      if (!uploaded) return; // backed out of the picker
      onChange(uploaded.path);
      setPreview(uploaded.previewUri);
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'The photo could not be uploaded. Try again.');
    }
  }

  const shownError = error ?? fieldState.error?.message ?? null;

  return (
    <View className="gap-2 rounded-xl border border-border bg-background-tint p-3">
      <Text variant="bodyStrong">{DISCOUNT_LABELS[kind]} ID photo</Text>
      <Text variant="caption" tone="muted">
        {PROOF_HINTS[kind]} It gives this passenger 20% off, and the crew check the real ID when
        they board — so attach the passenger&apos;s own ID, even when you are booking for them.
      </Text>

      {value ? (
        <View className="flex-row items-center gap-3">
          {preview ? (
            <Image
              source={{ uri: preview }}
              style={{ width: 64, height: 44, borderRadius: 6 }}
              contentFit="cover"
              accessibilityLabel={`${DISCOUNT_LABELS[kind]} ID photo for passenger ${index + 1}`}
            />
          ) : null}
          <View className="flex-1 flex-row items-center gap-1.5">
            <CircleCheck size={16} color={Colors.success} />
            <Text variant="caption" tone="success">
              Photo attached
            </Text>
          </View>
        </View>
      ) : null}

      <Button
        label={value ? 'Replace photo' : 'Upload ID picture'}
        variant={value ? 'ghost' : 'outline'}
        size="sm"
        icon={value ? undefined : <Camera size={16} color={Colors.primary} />}
        loading={upload.isPending}
        onPress={() => void pick()}
        accessibilityLabel={`${value ? 'Replace' : 'Upload'} the ${DISCOUNT_LABELS[
          kind
        ].toLowerCase()} ID picture for passenger ${index + 1}`}
      />

      {shownError ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {shownError}
        </Text>
      ) : null}
    </View>
  );
}
