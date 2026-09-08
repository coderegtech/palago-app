import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';

import { Modal } from '@/components/ui/modal';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export interface SelectProps<T extends string> {
  label?: string;
  placeholder?: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A bottom-sheet picker. React Native has no cross-platform `<select>`, and the
 * native pickers look and behave differently enough on iOS and Android that a
 * shared sheet is the more predictable choice.
 */
export function Select<T extends string>({
  label,
  placeholder = 'Select…',
  value,
  options,
  onChange,
  error,
  disabled = false,
  className,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <View className={cn('gap-1.5', className)}>
      {label ? (
        <Text variant="caption" tone="muted" className="font-semibold">
          {label}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={cn(
          'h-12 flex-row items-center justify-between rounded-xl border bg-surface px-3',
          error ? 'border-danger' : 'border-border',
          disabled && 'opacity-50',
        )}>
        <Text tone={selected ? 'default' : 'muted'} numberOfLines={1} className="flex-1">
          {selected?.label ?? placeholder}
        </Text>
        <ChevronDown size={18} color={Colors.textMuted} />
      </Pressable>

      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}

      <Modal visible={open} onClose={() => setOpen(false)} title={label ?? 'Select an option'}>
        <FlatList
          data={options}
          keyExtractor={(option) => option.value}
          ItemSeparatorComponent={() => <View className="h-px bg-border" />}
          renderItem={({ item }) => {
            const isSelected = item.value === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
                className="min-h-[52px] flex-row items-center justify-between gap-3 px-1 py-3 active:bg-primary-soft">
                <View className="flex-1">
                  <Text variant={isSelected ? 'bodyStrong' : 'body'}>{item.label}</Text>
                  {item.description ? (
                    <Text variant="caption" tone="muted">
                      {item.description}
                    </Text>
                  ) : null}
                </View>
                {isSelected ? <Check size={18} color={Colors.primary} /> : null}
              </Pressable>
            );
          }}
        />
      </Modal>
    </View>
  );
}
