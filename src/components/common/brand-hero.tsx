import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

import { PalaGoLogo, type LogoSize } from '@/components/common/palago-logo';
import { Text } from '@/components/ui/text';
import { Gradients, Radius } from '@/constants/theme';

export interface BrandHeroProps {
  title?: string;
  subtitle?: string;
  size?: LogoSize;
  withTagline?: boolean;
}

/**
 * Green gradient banner carrying the PalaGo lockup — the recurring header in
 * the brand design.
 *
 * The gradient is one of only two places the identity uses one (see
 * `Gradients`); everywhere else is a flat surface. It bleeds past the screen's
 * horizontal padding with negative margins so the colour reaches the edges
 * while the content column stays aligned.
 */
export function BrandHero({ title, subtitle, size = 'md', withTagline = true }: BrandHeroProps) {
  return (
    <LinearGradient
      colors={[...Gradients.brand]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        borderBottomLeftRadius: Radius.sheet,
        borderBottomRightRadius: Radius.sheet,
        marginHorizontal: -16,
        paddingHorizontal: 16,
      }}>
      <View className="items-center gap-3 px-2 pb-8 pt-10">
        <PalaGoLogo size={size} layout="stacked" withTagline={withTagline} inverse />

        {title ? (
          <View className="mt-2 items-center gap-1">
            <Text variant="title" tone="inverse" className="text-center">
              {title}
            </Text>
            {subtitle ? (
              <Text variant="body" tone="inverse" className="text-center opacity-80">
                {subtitle}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </LinearGradient>
  );
}
