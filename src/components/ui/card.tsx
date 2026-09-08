import { View, type ViewProps } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/utils/cn';

export interface CardProps extends ViewProps {
  className?: string;
}

export function Card({ className, ...rest }: CardProps) {
  return (
    <View
      className={cn(
        'rounded-card border border-border bg-surface p-4',
        // Subtle lift only — the design language is flat surfaces, not shadows.
        'shadow-sm shadow-black/5',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: CardProps) {
  return <View className={cn('mb-3 gap-1', className)} {...rest} />;
}

export function CardTitle({ children, className }: { children: string; className?: string }) {
  return (
    <Text variant="subtitle" className={className}>
      {children}
    </Text>
  );
}

export function CardDescription({ children, className }: { children: string; className?: string }) {
  return (
    <Text variant="caption" tone="muted" className={className}>
      {children}
    </Text>
  );
}

export function CardFooter({ className, ...rest }: CardProps) {
  return <View className={cn('mt-4 flex-row items-center gap-2', className)} {...rest} />;
}
