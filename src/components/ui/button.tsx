import { ActivityIndicator, Pressable, View, type PressableProps } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const containerClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary active:bg-primary-dark',
  secondary: 'bg-secondary active:bg-secondary-dark',
  outline: 'bg-transparent border border-primary active:bg-primary-soft',
  ghost: 'bg-transparent active:bg-primary-soft',
  danger: 'bg-danger active:opacity-90',
};

const labelTone: Record<ButtonVariant, 'inverse' | 'default' | 'primary'> = {
  primary: 'inverse',
  secondary: 'default',
  outline: 'primary',
  ghost: 'primary',
  danger: 'inverse',
};

// Heights stay at or above the 44px minimum touch target on every size.
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-11 px-4',
  md: 'h-12 px-5',
  lg: 'h-14 px-6',
};

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  /** Rendered before the label. Keep it to a single icon. */
  icon?: React.ReactNode;
  className?: string;
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = true,
  icon,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      className={cn(
        'flex-row items-center justify-center gap-2 rounded-xl',
        containerClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        isDisabled && 'opacity-50',
        className,
      )}
      {...rest}>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={labelTone[variant] === 'inverse' ? '#FFFFFF' : '#087443'}
        />
      ) : (
        <>
          {icon ? <View>{icon}</View> : null}
          <Text variant="bodyStrong" tone={labelTone[variant]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}
