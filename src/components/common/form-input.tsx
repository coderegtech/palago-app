import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';

import { Input, type InputProps } from '@/components/ui/input';

export interface FormInputProps<T extends FieldValues>
  extends Omit<InputProps, 'value' | 'onChangeText' | 'onBlur' | 'error'> {
  control: Control<T>;
  name: FieldPath<T>;
}

/**
 * Bridges React Hook Form to `Input`. React Native has no native form element,
 * so every field is controlled — this keeps that wiring in one place instead of
 * repeating a `Controller` in each screen.
 */
export function FormInput<T extends FieldValues>({ control, name, ...rest }: FormInputProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange, onBlur }, fieldState: { error } }) => (
        <Input
          value={value ?? ''}
          onChangeText={onChange}
          onBlur={onBlur}
          error={error?.message}
          {...rest}
        />
      )}
    />
  );
}
