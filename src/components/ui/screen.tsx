import { ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { MaxContentWidth } from '@/constants/theme';
import { cn } from '@/utils/cn';

export interface ScreenProps extends ViewProps {
  /** Wrap content in a ScrollView. Off for screens that own their own list. */
  scroll?: boolean;
  edges?: readonly Edge[];
  /** Remove the default horizontal padding for edge-to-edge content. */
  padded?: boolean;
  className?: string;
  contentClassName?: string;
}

/**
 * Standard screen frame: safe-area insets, page background, and a content
 * column that stops widening past `MaxContentWidth` on tablets and web.
 */
export function Screen({
  scroll = false,
  edges = ['top', 'left', 'right'],
  padded = true,
  children,
  className,
  contentClassName,
  ...rest
}: ScreenProps) {
  const content = (
    <View
      style={{ maxWidth: MaxContentWidth }}
      className={cn('w-full flex-1 self-center', padded && 'px-4', contentClassName)}>
      {children}
    </View>
  );

  return (
    <SafeAreaView edges={edges} className={cn('flex-1 bg-background', className)} {...rest}>
      {scroll ? (
        <ScrollView
          contentContainerClassName="grow pb-8"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}
