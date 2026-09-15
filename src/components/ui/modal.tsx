import { Modal as RNModal, Pressable, ScrollView, View } from 'react-native';
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

/**
 * Bottom sheet. Used for pickers, forms and confirmations alike.
 *
 * The body scrolls. The sheet is capped at 80% of the screen, and a form with
 * more than a handful of fields is taller than that on a phone — the schedule
 * form put its Save button below the fold with no way to reach it, which makes
 * the whole sheet useless rather than merely cramped.
 */
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

          {/*
            `bounces={false}` so a short sheet does not rubber-band as though
            there were more below it, and the keyboard dismisses on drag rather
            than covering the field somebody is scrolling towards.
          */}
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    </RNModal>
  );
}
