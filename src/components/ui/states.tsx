/**
 * The non-happy-path screen states every feature must handle: loading, empty,
 * error, and offline. Keeping them in one place is what stops each new screen
 * from inventing its own spinner and its own "something went wrong".
 */

import { ActivityIndicator, View } from 'react-native';
import { CloudOff, Inbox, TriangleAlert } from 'lucide-react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';

export function Loading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      className={cn('flex-1 items-center justify-center gap-3 p-6', className)}>
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

export interface EmptyStateProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  icon,
  className,
}: EmptyStateProps) {
  return (
    <View className={cn('flex-1 items-center justify-center gap-3 p-8', className)}>
      {icon ?? <Inbox size={40} color={Colors.textMuted} />}
      <Text variant="subtitle" className="text-center">
        {title}
      </Text>
      {message ? (
        <Text variant="body" tone="muted" className="text-center">
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} variant="outline" fullWidth={false} onPress={onAction} />
      ) : null}
    </View>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <View
      accessibilityRole="alert"
      className={cn('flex-1 items-center justify-center gap-3 p-8', className)}>
      <TriangleAlert size={40} color={Colors.danger} />
      <Text variant="subtitle" className="text-center">
        {title}
      </Text>
      <Text variant="body" tone="muted" className="text-center">
        {message}
      </Text>
      {onRetry ? (
        <Button label="Try again" variant="outline" fullWidth={false} onPress={onRetry} />
      ) : null}
    </View>
  );
}

export function OfflineState({ onRetry, className }: { onRetry?: () => void; className?: string }) {
  return (
    <View
      accessibilityRole="alert"
      className={cn('flex-1 items-center justify-center gap-3 p-8', className)}>
      <CloudOff size={40} color={Colors.textMuted} />
      <Text variant="subtitle" className="text-center">
        No internet connection
      </Text>
      <Text variant="body" tone="muted" className="text-center">
        PalaGo needs a connection to confirm anything with the server.
      </Text>
      {onRetry ? (
        <Button label="Try again" variant="outline" fullWidth={false} onPress={onRetry} />
      ) : null}
    </View>
  );
}

/** Grey placeholder block for content that is still loading in place. */
export function Skeleton({ className }: { className?: string }) {
  return <View className={cn('rounded-md bg-border', className)} />;
}
