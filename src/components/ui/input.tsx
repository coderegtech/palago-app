import { forwardRef } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';

export interface InputProps extends TextInputProps {
  label?: string;
  /** Validation message. Presence of this switches the field to its error state. */
  error?: string;
  hint?: string;
  /** Rendered inside the field, before the text. */
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, hint, leading, trailing, containerClassName, className, ...rest },
  ref,
) {
  const hasError = Boolean(error);

  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? (
        <Text variant="caption" tone="muted" className="font-semibold">
          {label}
        </Text>
      ) : null}

      <View
        className={cn(
          'h-12 flex-row items-center gap-2 rounded-xl border bg-surface px-3',
          hasError ? 'border-danger' : 'border-border',
        )}>
        {leading}
        <TextInput
          ref={ref}
          placeholderTextColor={Colors.textMuted}
          accessibilityLabel={label ?? rest.placeholder}
          // Colour is not the only error signal — the message below is.
          accessibilityHint={error ?? hint}
          className={cn('h-full flex-1 text-[15px] text-content', className)}
          {...rest}
        />
        {trailing}
      </View>

      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});
