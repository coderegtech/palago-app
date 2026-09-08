import { Modal as RNModal, Pressable, View } from 'react-native';
import { X } from 'lucide-react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';

export interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Set false for destructive confirmations that must be answered explicitly. */
  dismissOnBackdropPress?: boolean;
  className?: string;
}

/** Bottom sheet. Used for pickers and confirmations alike. */
export function Modal({
  visible,
  onClose,
  title,
  children,
  dismissOnBackdropPress = true,
  className,
}: ModalProps) {
  return (
    <RNModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable
          accessible={false}
          className="flex-1"
          onPress={dismissOnBackdropPress ? onClose : undefined}
        />
        <View
          accessibilityViewIsModal
          className={cn('max-h-[80%] rounded-t-sheet bg-surface px-4 pb-8 pt-3', className)}>
          <View className="mb-3 h-1 w-10 self-center rounded-full bg-border" />
          {title ? (
            <View className="mb-2 flex-row items-center justify-between">
              <Text variant="subtitle" className="flex-1">
                {title}
              </Text>
              <IconButton accessibilityLabel="Close" onPress={onClose}>
                <X size={20} color={Colors.textMuted} />
              </IconButton>
            </View>
          ) : null}
          {children}
        </View>
      </View>
    </RNModal>
  );
}
