import { Pressable, View, type PressableProps, type ViewProps } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/utils/cn';

export interface CardProps extends ViewProps {
  className?: string;
  /**
   * Makes the whole card the tap target.
   *
   * Use this rather than wrapping a `Card` in a `Pressable` — see below.
   */
  onPress?: PressableProps['onPress'];
}

/**
 * A surface. Tappable when given `onPress`.
 *
 * ## Why `onPress` lives here rather than on a wrapping Pressable
 *
 * A card with an `active:` class is not a View on device. NativeWind implements
 * pseudo-classes by *upgrading the component*: `render-component.js` swaps a
 * `View` carrying `:active`, `:hover` or `:focus` styles for a real `Pressable`
 * so it has somewhere to hang `onPressIn`/`onPressOut`.
 *
 * So `<Pressable onPress><Card className="active:bg-…"/></Pressable>` is two
 * nested Pressables on native. The inner one takes the touch responder and the
 * outer `onPress` never fires — the card highlights under your finger and does
 * nothing. On web none of this happens: `:active` is ordinary CSS, no component
 * is swapped, and the click bubbles to the outer handler as intended. Which is
 * why this shipped: every one of these cards worked perfectly in the browser.
 *
 * Passing `onPress` here keeps the handler and the `active:` style on the same
 * element, so there is only ever one Pressable.
 */
export function Card({ className, onPress, ...rest }: CardProps) {
  const classes = cn(
    'rounded-card border border-border bg-surface p-4',
    // Subtle lift only — the design language is flat surfaces, not shadows.
    'shadow-sm shadow-black/5',
    className,
  );

  if (onPress) {
    return <Pressable onPress={onPress} className={classes} {...(rest as PressableProps)} />;
  }

  return <View className={classes} {...rest} />;
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
