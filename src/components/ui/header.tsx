import { router, type Href } from 'expo-router';
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
  /**
   * Where to go when there is no navigation history — a deep link, a reload, or
   * a `replace` that wiped the stack. Without this, `router.back()` throws
   * "The action 'GO_BACK' was not handled by any navigator".
   */
  fallbackHref?: Href;
  /** Trailing controls, e.g. a notification bell. */
  right?: React.ReactNode;
  className?: string;
}

export function Header({
  title,
  subtitle,
  showBack,
  onBack,
  fallbackHref = '/',
  right,
  className,
}: HeaderProps) {
  function goBack() {
    // Someone who opened this screen from a link has no stack to pop.
    if (router.canGoBack()) router.back();
    else router.replace(fallbackHref);
  }

  return (
    <View className={cn('flex-row items-center gap-2 py-3', className)}>
      {showBack ? (
        <IconButton
          accessibilityLabel="Go back"
          onPress={onBack ?? goBack}
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
