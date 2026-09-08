import { View } from 'react-native';
import { Construction } from 'lucide-react-native';

import { Badge } from '@/components/ui/badge';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';

export interface PlaceholderScreenProps {
  title: string;
  /** The implementation phase that will replace this screen. */
  phase: string;
  description: string;
  showBack?: boolean;
}

/**
 * Route stub used by the Phase 1 navigation skeleton.
 *
 * It exists so navigation is genuinely verifiable end to end, and it is loudly
 * labelled so nobody — including future me — mistakes a rendering route for a
 * working feature. Every one of these is deleted by the phase that owns it.
 */
export function PlaceholderScreen({
  title,
  phase,
  description,
  showBack = false,
}: PlaceholderScreenProps) {
  return (
    <Screen>
      <Header title={title} showBack={showBack} />
      <View className="flex-1 items-center justify-center gap-3">
        <Construction size={40} color={Colors.textMuted} />
        <Badge label={`Not implemented · ${phase}`} tone="warning" className="self-center" />
        <Text variant="body" tone="muted" className="text-center">
          {description}
        </Text>
      </View>
    </Screen>
  );
}
