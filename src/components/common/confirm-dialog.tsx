/**
 * "Are you sure?" for actions that change somebody else's access or a live
 * schedule.
 *
 * Not `Alert.alert`: the admin and operator consoles run on web, where that API
 * does nothing at all — the action would simply proceed with no prompt, which
 * is the opposite of what a confirmation is for. This is the existing bottom
 * sheet with the backdrop dismissal turned off, so the question has to be
 * answered rather than tapped past.
 *
 * `consequence` is the sentence that says what actually happens. Deactivating
 * an account and deleting one are very different things, and the dialog is the
 * last place to say which this is.
 */

import { View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Text } from '@/components/ui/text';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  /** What the reader is being asked to agree to. */
  message: string;
  /** What this will do to existing records. Shown as a warning panel. */
  consequence?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button. For anything that removes access or cancels a trip. */
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  consequence,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      visible={visible}
      onClose={onCancel}
      title={title}
      // The whole point: a stray tap on the backdrop must not answer this.
      dismissOnBackdropPress={false}>
      <View className="gap-4 pt-1">
        <Text variant="body" tone="muted">
          {message}
        </Text>

        {consequence ? (
          <Alert tone={destructive ? 'warning' : 'info'} title={consequence} />
        ) : null}

        <Button
          label={confirmLabel}
          variant={destructive ? 'danger' : 'primary'}
          loading={loading}
          onPress={onConfirm}
        />
        <Button label={cancelLabel} variant="ghost" disabled={loading} onPress={onCancel} />
      </View>
    </Modal>
  );
}
