import { View } from 'react-native';

import { PalaGoMark } from '@/components/common/palago-mark';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';

export type LogoSize = 'sm' | 'md' | 'lg' | 'xl';
export type LogoLayout = 'horizontal' | 'stacked' | 'mark';

const markSize: Record<LogoSize, number> = { sm: 24, md: 36, lg: 56, xl: 88 };
const wordSize: Record<LogoSize, number> = { sm: 20, md: 28, lg: 40, xl: 54 };
const taglineSize: Record<LogoSize, number> = { sm: 9, md: 11, lg: 13, xl: 15 };

export interface PalaGoLogoProps {
  size?: LogoSize;
  /** `mark` renders the badge alone — for tab bars, avatars and tight headers. */
  layout?: LogoLayout;
  withTagline?: boolean;
  /** Use on a dark or photographic background. */
  inverse?: boolean;
  className?: string;
}

/**
 * The PalaGo lockup: badge plus the two-tone "PalaGo" wordmark.
 *
 * The wordmark is real text rather than outlines, so it renders with the
 * platform's own font and is readable by screen readers; the whole lockup
 * exposes a single "PalaGo" label rather than announcing two fragments.
 */
export function PalaGoLogo({
  size = 'md',
  layout = 'horizontal',
  withTagline = false,
  inverse = false,
  className,
}: PalaGoLogoProps) {
  const palaColor = inverse ? Colors.textInverse : Colors.primaryDark;
  const goColor = inverse ? Colors.secondary : Colors.secondaryDark;

  if (layout === 'mark') {
    return (
      <View className={className} accessibilityRole="image" accessibilityLabel="PalaGo">
        <PalaGoMark size={markSize[size]} />
      </View>
    );
  }

  const wordmark = (
    <View className="items-center">
      <Text
        style={{ fontSize: wordSize[size], lineHeight: wordSize[size] * 1.18, fontWeight: '800' }}>
        <Text style={{ color: palaColor, fontSize: wordSize[size], fontWeight: '800' }}>Pala</Text>
        <Text style={{ color: goColor, fontSize: wordSize[size], fontWeight: '800' }}>Go</Text>
      </Text>
      {withTagline ? (
        <Text
          style={{
            fontSize: taglineSize[size],
            color: inverse ? Colors.textInverse : Colors.primaryDark,
            opacity: inverse ? 0.9 : 0.75,
            fontWeight: '600',
          }}>
          Your Ride. Your Palawan. Your Way.
        </Text>
      ) : null}
    </View>
  );

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="PalaGo"
      className={cn(
        layout === 'stacked' ? 'items-center gap-2' : 'flex-row items-center gap-2',
        className,
      )}>
      <PalaGoMark size={markSize[size]} />
      {wordmark}
    </View>
  );
}
