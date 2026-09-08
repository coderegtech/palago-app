import { Pressable, type PressableProps } from 'react-native';

import { MIN_TOUCH_TARGET } from '@/constants/theme';
import { cn } from '@/utils/cn';

export interface IconButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  /** Required — an icon-only control is invisible to screen readers without it. */
  accessibilityLabel: string;
  children: React.ReactNode;
  variant?: 'plain' | 'soft' | 'solid';
  className?: string;
}

const variantClasses = {
  plain: 'bg-transparent active:bg-border',
  soft: 'bg-primary-soft active:bg-border',
  solid: 'bg-primary active:bg-primary-dark',
} as const;

export function IconButton({
  accessibilityLabel,
  children,
  variant = 'plain',
  disabled,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={8}
      style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
      className={cn(
        'items-center justify-center rounded-full',
        variantClasses[variant],
        disabled && 'opacity-50',
        className,
      )}
      {...rest}>
      {children}
    </Pressable>
  );
}
