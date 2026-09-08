import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/utils/cn';

export interface DividerProps {
  /** Optional centred caption, e.g. "or". */
  label?: string;
  className?: string;
}

export function Divider({ label, className }: DividerProps) {
  if (!label) {
    return <View accessibilityRole="none" className={cn('h-px w-full bg-border', className)} />;
  }

  return (
    <View className={cn('w-full flex-row items-center gap-3', className)}>
      <View className="h-px flex-1 bg-border" />
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}
