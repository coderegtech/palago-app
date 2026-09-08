import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { cn } from '@/utils/cn';

export type TextVariant =
  | 'display'
  | 'title'
  | 'subtitle'
  | 'body'
  | 'bodyStrong'
  | 'caption'
  | 'label'
  | 'mono';

export type TextTone = 'default' | 'muted' | 'inverse' | 'primary' | 'success' | 'warning' | 'danger';

const variantClasses: Record<TextVariant, string> = {
  display: 'text-[28px] leading-[34px] font-bold',
  title: 'text-[20px] leading-[28px] font-semibold',
  subtitle: 'text-[17px] leading-[24px] font-semibold',
  body: 'text-[15px] leading-[22px] font-normal',
  bodyStrong: 'text-[15px] leading-[22px] font-semibold',
  caption: 'text-[12px] leading-[16px] font-normal',
  label: 'text-[13px] leading-[18px] font-semibold uppercase tracking-wide',
  mono: 'text-[14px] leading-[20px] font-mono',
};

const toneClasses: Record<TextTone, string> = {
  default: 'text-content',
  muted: 'text-content-muted',
  inverse: 'text-content-inverse',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  className?: string;
}

export function Text({ variant = 'body', tone = 'default', className, ...rest }: TextProps) {
  return <RNText className={cn(variantClasses[variant], toneClasses[tone], className)} {...rest} />;
}
