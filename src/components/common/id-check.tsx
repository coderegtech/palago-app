/**
 * "Check ID" at the door, for a passenger who travels on a senior, student or
 * PWD discount.
 *
 * The discount was granted when the booking was made, against a photo of the
 * passenger's ID — often uploaded by someone else booking for them. Boarding is
 * where it is checked against the real card, so the crew see the type and can
 * open the photo that was attached. A card that does not match is the crew's
 * call: refuse, or collect the difference before boarding.
 */

import { Image } from 'expo-image';
import { IdCard } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { usePassengerProofUrl } from '@/hooks/use-passenger-proof';

const LABELS: Record<string, string> = {
  SENIOR: 'Senior citizen',
  STUDENT: 'Student',
  PWD: 'PWD',
};

export interface IdCheckProps {
  passengerName: string;
  type: string;
  proofPath: string | null;
}

export function IdCheck({ passengerName, type, proofPath }: IdCheckProps) {
  const [open, setOpen] = useState(false);
  const photo = usePassengerProofUrl(open ? proofPath : null);
  const label = LABELS[type] ?? type;

  return (
    <View className="ml-9 flex-row flex-wrap items-center gap-2 pb-1">
      <IdCard size={14} color={Colors.warning} />
      <Badge label={`Check ${label.toLowerCase()} ID`} tone="warning" />
      {proofPath ? (
        <Button
          label="View ID photo"
          variant="ghost"
          size="sm"
          fullWidth={false}
          onPress={() => setOpen(true)}
          accessibilityLabel={`View the ID photo attached for ${passengerName}`}
        />
      ) : (
        <Text variant="caption" tone="muted">
          Verified on the booker&apos;s account
        </Text>
      )}

      <Modal visible={open} onClose={() => setOpen(false)} title={`${passengerName} — ${label} ID`}>
        <View className="gap-3">
          {photo.isPending ? (
            <Loading label="Opening the photo…" />
          ) : photo.isError ? (
            <ErrorState message="Could not open the ID photo." onRetry={() => void photo.refetch()} />
          ) : photo.data ? (
            <Image
              source={{ uri: photo.data }}
              style={{ width: '100%', aspectRatio: 1.5, borderRadius: 8 }}
              contentFit="contain"
              accessibilityLabel={`ID photo attached for ${passengerName}`}
            />
          ) : null}
          <Text variant="caption" tone="muted">
            Compare it with the card the passenger shows you. The discount was given against this
            photo; if the card does not match, do not board them on it.
          </Text>
          <Button label="Close" variant="ghost" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}
