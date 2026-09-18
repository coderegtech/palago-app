/**
 * System — platform-wide actions, currently one: resetting the data.
 *
 * The reset is for a single moment in a project's life: moving from demo data
 * to real data. After that it is the most dangerous button in the app, so the
 * screen is built to make pressing it by accident impossible and pressing it on
 * purpose informed:
 *
 *   * the dialog shows live counts of exactly what will go and what will stay,
 *     fetched when it opens — the admin's last look at the data;
 *   * nothing happens until RESET DATABASE is typed exactly, and the database
 *     checks that phrase itself, so the dialog is not the only thing standing in
 *     the way;
 *   * the dialog cannot be dismissed by tapping outside it mid-decision.
 *
 * Authorisation is SQL's: `reset_application_data` refuses anyone who is not an
 * active SUPER_ADMIN. The `(admin)` group's AuthGate only keeps other roles from
 * wandering onto the screen.
 */

import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { DatabaseZap, TriangleAlert } from 'lucide-react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { AdminContentMaxWidth, Colors } from '@/constants/theme';
import { useDataResetPreview, useResetData } from '@/hooks/use-admin';
import { AppError } from '@/lib/errors';
import {
  RESET_CONFIRMATION_PHRASE,
  type DataResetPreview,
  type DataResetResult,
} from '@/services/system-service';
import { timeAgo } from '@/utils/datetime';

const DELETE_LABELS: [keyof DataResetPreview['delete'], string][] = [
  ['accounts', 'Accounts (everyone except admins)'],
  ['operators', 'Operators'],
  ['terminals', 'Terminals'],
  ['routes', 'Routes'],
  ['buses', 'Coaches and seat layouts'],
  ['trips', 'Schedules'],
  ['crewRecords', 'Driver and crew records'],
  ['rewards', 'Rewards catalogue'],
  ['bookings', 'Bookings'],
  ['payments', 'Payments'],
  ['receipts', 'Receipts'],
  ['walletTransactions', 'Wallet transactions'],
  ['loyaltyTransactions', 'Points history'],
  ['rewardRedemptions', 'Reward redemptions'],
  ['notifications', 'Notifications'],
  ['sosIncidents', 'Emergency (SOS) records'],
  ['boardingScans', 'Boarding scans'],
  ['gpsPoints', 'GPS positions'],
  ['discountSubmissions', 'Discount ID submissions'],
];

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-row items-center justify-between gap-3 py-1">
      <Text variant="body">{label}</Text>
      <Text variant="bodyStrong">{value.toLocaleString()}</Text>
    </View>
  );
}

export default function SystemScreen() {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [result, setResult] = useState<DataResetResult | null>(null);

  const preview = useDataResetPreview(open);
  const reset = useResetData();

  const matches = phrase === RESET_CONFIRMATION_PHRASE;
  const totalToDelete = preview.data
    ? Object.values(preview.data.delete).reduce((sum, n) => sum + n, 0)
    : 0;

  function close() {
    if (reset.isPending) return; // never abandon a reset mid-flight
    setOpen(false);
    setPhrase('');
    reset.reset();
  }

  function confirm() {
    if (!matches) return;
    reset.mutate(phrase, {
      onSuccess: (done) => {
        setResult(done);
        setOpen(false);
        setPhrase('');
      },
    });
  }

  const errorMessage =
    reset.error instanceof AppError
      ? reset.error.message
      : reset.error
        ? 'The reset did not run. Nothing was deleted.'
        : null;

  return (
    <Screen padded={false} maxWidth={AdminContentMaxWidth} edges={['left', 'right']}>
      <ScrollView contentContainerClassName="px-4 pb-8 gap-4" showsVerticalScrollIndicator={false}>
        <Header title="System" subtitle="Platform-wide actions" />

        {result ? (
          <Alert
            tone="success"
            title="The database was reset"
            message={
              `${result.deleted.accounts.toLocaleString()} accounts, ` +
              `${result.deleted.operators.toLocaleString()} operators, ` +
              `${result.deleted.trips.toLocaleString()} schedules and ` +
              `${result.deleted.bookings.toLocaleString()} bookings were deleted ` +
              `${timeAgo(result.resetAt)}, with everything that belonged to them. Only admin ` +
              `accounts remain. Reference numbers start again at 000001.` +
              (result.proofFiles.failed > 0
                ? ` ${result.proofFiles.failed} ID photograph(s) could not be removed from storage and need deleting by hand — see the reset-data function log.`
                : '')
            }
          />
        ) : null}

        <Card className="gap-4 border-danger/40">
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-danger-soft">
              <DatabaseZap size={20} color={Colors.danger} />
            </View>
            <View className="flex-1">
              <Text variant="subtitle">Reset database</Text>
              <Text variant="caption" tone="muted">
                Danger zone — for switching from demo data to real data
              </Text>
            </View>
          </View>

          <Text variant="body">
            Permanently deletes everything except the admin accounts: every passenger, operator,
            driver and crew account, every operator, terminal, route, coach, schedule and reward, and
            every booking, payment, point, notification and emergency record.
          </Text>
          <Text variant="body" tone="muted">
            Only admin accounts remain, ready to enter the real operators, routes and schedules.
            Settings and the audit log are kept, and the reset is recorded there under your name.
          </Text>

          <Button
            label="Reset database…"
            variant="danger"
            icon={<TriangleAlert size={18} color={Colors.textInverse} />}
            onPress={() => {
              setResult(null);
              setOpen(true);
            }}
            accessibilityLabel="Reset database. Opens a confirmation."
          />
        </Card>
      </ScrollView>

      <Modal
        visible={open}
        onClose={close}
        title="Reset the database?"
        dismissOnBackdropPress={false}>
        <View className="gap-4">
          <Alert
            tone="danger"
            title="This cannot be undone"
            message="Everything listed under “Will be deleted” is removed permanently. There is no restore."
          />

          {preview.isPending ? (
            <Loading label="Counting what would be deleted…" />
          ) : preview.isError ? (
            <ErrorState
              message="Could not count the data. The reset is unavailable until it can."
              onRetry={() => preview.refetch()}
            />
          ) : preview.data ? (
            <>
              <View>
                <Text variant="label" tone="muted" className="mb-1">
                  Will be deleted
                </Text>
                {DELETE_LABELS.map(([key, label]) => (
                  <CountRow key={key} label={label} value={preview.data.delete[key]} />
                ))}
              </View>

              <View>
                <Text variant="label" tone="muted" className="mb-1">
                  Will be kept
                </Text>
                <CountRow label="Admin accounts" value={preview.data.keep.superAdmins} />
                <Text variant="caption" tone="muted" className="mt-1">
                  {preview.data.keep.superAdminEmails.join(', ')}
                </Text>
                <Text variant="caption" tone="muted" className="mt-1">
                  Settings and the audit log are also kept.
                </Text>
              </View>

              <Input
                label={`Type ${RESET_CONFIRMATION_PHRASE} to confirm`}
                placeholder={RESET_CONFIRMATION_PHRASE}
                value={phrase}
                onChangeText={setPhrase}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                editable={!reset.isPending}
                hint={
                  phrase.length > 0 && !matches ? 'It must match exactly, in capitals.' : undefined
                }
              />

              {errorMessage ? (
                <Alert tone="danger" title="The reset did not run" message={errorMessage} />
              ) : null}

              <Button
                label={
                  totalToDelete > 0
                    ? `Delete ${totalToDelete.toLocaleString()} records permanently`
                    : 'Reset database'
                }
                variant="danger"
                disabled={!matches}
                loading={reset.isPending}
                onPress={confirm}
                accessibilityLabel="Confirm the database reset"
              />
            </>
          ) : null}

          <Button
            label="Cancel"
            variant="ghost"
            disabled={reset.isPending}
            onPress={close}
          />
        </View>
      </Modal>
    </Screen>
  );
}
