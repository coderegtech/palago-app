import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/utils/cn';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const containerClasses: Record<BadgeTone, string> = {
  neutral: 'bg-border',
  primary: 'bg-primary-soft',
  success: 'bg-success-soft',
  warning: 'bg-warning-soft',
  danger: 'bg-danger-soft',
  info: 'bg-info-soft',
};

const textClasses: Record<BadgeTone, string> = {
  neutral: 'text-content-muted',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  className?: string;
}

/**
 * Status pill. Tone carries meaning, so the label always spells the status out
 * as well — colour alone must never be the only signal (accessibility).
 */
export function Badge({ label, tone = 'neutral', className }: BadgeProps) {
  return (
    <View
      className={cn('self-start rounded-full px-2.5 py-1', containerClasses[tone], className)}>
      <Text variant="caption" className={cn('font-semibold', textClasses[tone])}>
        {label}
      </Text>
    </View>
  );
}
