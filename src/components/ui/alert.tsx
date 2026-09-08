import { View } from 'react-native';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const containerClasses: Record<AlertTone, string> = {
  info: 'bg-info-soft border-info/30',
  success: 'bg-success-soft border-success/30',
  warning: 'bg-warning-soft border-warning/40',
  danger: 'bg-danger-soft border-danger/30',
};

const iconColor: Record<AlertTone, string> = {
  info: Colors.info,
  success: Colors.success,
  warning: Colors.warning,
  danger: Colors.danger,
};

const icons: Record<AlertTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

export interface AlertProps {
  tone?: AlertTone;
  title: string;
  message?: string;
  className?: string;
}

export function Alert({ tone = 'info', title, message, className }: AlertProps) {
  const Icon = icons[tone];

  return (
    <View
      accessibilityRole="alert"
      className={cn('flex-row gap-3 rounded-card border p-3', containerClasses[tone], className)}>
      <Icon size={20} color={iconColor[tone]} />
      <View className="flex-1 gap-0.5">
        <Text variant="bodyStrong">{title}</Text>
        {message ? (
          <Text variant="caption" tone="muted">
            {message}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
