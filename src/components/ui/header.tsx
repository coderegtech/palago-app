import { router } from 'expo-router';
import { View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';

export interface HeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  /** Trailing controls, e.g. a notification bell. */
  right?: React.ReactNode;
  className?: string;
}

export function Header({ title, subtitle, showBack, onBack, right, className }: HeaderProps) {
  return (
    <View className={cn('flex-row items-center gap-2 py-3', className)}>
      {showBack ? (
        <IconButton
          accessibilityLabel="Go back"
          onPress={onBack ?? (() => router.back())}
          className="-ml-2">
          <ChevronLeft size={24} color={Colors.text} />
        </IconButton>
      ) : null}

      <View className="flex-1">
        <Text variant="title" numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {right}
    </View>
  );
}
