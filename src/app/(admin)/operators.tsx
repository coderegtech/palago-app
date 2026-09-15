/**
 * Operator Management.
 *
 * This is where the hierarchy starts: only an admin creates an operator, and
 * only an admin creates the login that lets that company into its own console.
 * Operator registration is not public and there is no self-service path to it —
 * `authorize_staff_provision` refuses an OPERATOR account from anybody but an
 * admin, and this screen is the only place that asks.
 *
 * "Delete" is deactivation throughout. An operator is referenced by routes,
 * buses, trips, bookings and tickets; removing the row would take the history
 * of every journey with it, so the row stays and stops being usable for
 * anything new.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { KeyRound, Plus, UserPlus } from 'lucide-react-native';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Header } from '@/components/ui/header';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { TablePagination, TableToolbar } from '@/components/ui/table-toolbar';
import { Text } from '@/components/ui/text';
import { AccountStatus, OperatorStatus } from '@/constants/enums';
import { AdminContentMaxWidth, Colors } from '@/constants/theme';
import {
  useAdminOperators,
  useAdminStaff,
  useCreateOperator,
  useSetOperatorStatus,
  useUpdateOperator,
} from '@/hooks/use-admin';
import {
  useCreateStaffAccount,
  useResetStaffPassword,
  useSetAccountStatus,
  useStaffActivity,
} from '@/hooks/use-staff';
import { AppError } from '@/lib/errors';
import type { OperatorRecord } from '@/services/admin-service';
import { useUIStore } from '@/stores/ui-store';
import { timeAgo } from '@/utils/datetime';
import { applyTableControls, type SortDirection } from '@/utils/table';

type SortKey = 'name' | 'code' | 'status';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Company' },
  { value: 'code', label: 'Code' },
  { value: 'status', label: 'Status' },
];

interface Draft {
  name: string;
  code: string;
  phone: string;
  email: string;
}

const EMPTY: Draft = { name: '', code: '', phone: '', email: '' };

function message(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

export default function AdminOperatorsScreen() {
  const operators = useAdminOperators();
  const create = useCreateOperator();
  const update = useUpdateOperator();
  const setStatus = useSetOperatorStatus();
  const createAccount = useCreateStaffAccount();
  const resetPassword = useResetStaffPassword();
  const setAccountStatus = useSetAccountStatus();
  const showToast = useUIStore((state) => state.showToast);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<OperatorRecord | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  /** The company whose accounts and activity are open. */
  const [viewing, setViewing] = useState<OperatorRecord | null>(null);
  const [deactivating, setDeactivating] = useState<OperatorRecord | null>(null);

  const [accountFor, setAccountFor] = useState<OperatorRecord | null>(null);
  const [accountDraft, setAccountDraft] = useState({ fullName: '', email: '', phone: '' });
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  const staff = useAdminStaff(viewing?.id ?? null);
  const [activityFor, setActivityFor] = useState<string | null>(null);
  const activity = useStaffActivity(activityFor);

  const listed = useMemo(
    () =>
      applyTableControls(operators.data ?? [], {
        query,
        searchFields: ['name', 'code', 'contactEmail', 'contactPhone'],
        filters: { status: filter },
        sortKey,
        sortDirection,
        page,
        pageSize: 20,
      }),
    [operators.data, query, filter, sortKey, sortDirection, page],
  );

  function openEdit(operator: OperatorRecord) {
    setDraft({
      name: operator.name,
      code: operator.code,
      phone: operator.contactPhone ?? '',
      email: operator.contactEmail ?? '',
    });
    setEditing(operator);
  }

  async function onCreate() {
    try {
      await create.mutateAsync({
        name: draft.name,
        code: draft.code,
        contactPhone: draft.phone,
        contactEmail: draft.email,
      });
      setAdding(false);
      setDraft(EMPTY);
      showToast({ tone: 'success', title: 'Operator added' });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not add the operator',
        message: message(error, 'Check the code is not already taken and try again.'),
      });
    }
  }

  async function onSaveEdit() {
    if (!editing) return;
    try {
      await update.mutateAsync({
        operatorId: editing.id,
        name: draft.name,
        contactPhone: draft.phone,
        contactEmail: draft.email,
      });
      setEditing(null);
      showToast({ tone: 'success', title: 'Saved' });
    } catch (error) {
      showToast({ tone: 'danger', title: 'Could not save', message: message(error, 'Try again.') });
    }
  }

  async function onStatus(operator: OperatorRecord, status: OperatorStatus) {
    try {
      const result = await setStatus.mutateAsync({ operatorId: operator.id, status });
      setDeactivating(null);
      showToast({
        tone: 'success',
        title:
          status === OperatorStatus.ACTIVE
            ? `${operator.name} is active again`
            : `${operator.name} is deactivated`,
        message:
          status === OperatorStatus.INACTIVE && result.upcomingTrips > 0
            ? `${result.upcomingTrips} scheduled departure${result.upcomingTrips === 1 ? '' : 's'} can no longer sell seats. Cancel any that will not run.`
            : undefined,
      });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not change the status',
        message: message(error, 'Try again.'),
      });
    }
  }

  async function onCreateAccount() {
    if (!accountFor) return;
    try {
      const result = await createAccount.mutateAsync({
        email: accountDraft.email,
        fullName: accountDraft.fullName,
        role: 'OPERATOR',
        operatorId: accountFor.id,
        phone: accountDraft.phone || undefined,
      });
      setAccountFor(null);
      setAccountDraft({ fullName: '', email: '', phone: '' });
      setIssued({ email: result.email, password: result.temporaryPassword });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not create the account',
        message: message(error, 'Check the email is not already in use.'),
      });
    }
  }

  const canCreate = draft.name.trim().length > 1 && draft.code.trim().length > 1;
  const canCreateAccount =
    accountDraft.fullName.trim().length > 1 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountDraft.email.trim());

  return (
    <Screen padded={false} maxWidth={AdminContentMaxWidth} edges={['left', 'right']}>
      <View className="px-4">
        <Header title="Operators" subtitle="Bus companies on PalaGo, and who can sign in for them" />
      </View>

      <TableToolbar<SortKey>
        searchValue={query}
        onSearch={(value) => {
          setQuery(value);
          setPage(1);
        }}
        searchPlaceholder="Search by company, code or contact"
        filters={[
          { value: OperatorStatus.ACTIVE, label: 'Active' },
          { value: OperatorStatus.INACTIVE, label: 'Inactive' },
        ]}
        filterValue={filter}
        onFilter={(value) => {
          setFilter(value);
          setPage(1);
        }}
        sortOptions={SORT_OPTIONS}
        sortKey={sortKey}
        onSortKey={setSortKey}
        sortDirection={sortDirection}
        onToggleSortDirection={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
        action={
          <Button
            label="Add operator"
            size="sm"
            fullWidth={false}
            icon={<Plus size={16} color={Colors.textInverse} />}
            onPress={() => {
              setDraft(EMPTY);
              setAdding(true);
            }}
          />
        }
      />

      {operators.isPending ? (
        <Loading label="Loading operators…" />
      ) : operators.isError ? (
        <ErrorState message="Could not load operators." onRetry={() => void operators.refetch()} />
      ) : (
        <DataTable
          data={listed.rows}
          keyExtractor={(row) => row.id}
          minWidth={840}
          empty={
            <EmptyState
              title={query || filter ? 'Nothing matches' : 'No operators'}
              message={
                query || filter
                  ? 'Try a different search or filter.'
                  : 'Add the first bus company to get started.'
              }
            />
          }
          footer={
            <TablePagination
              page={listed.page}
              pageCount={listed.pageCount}
              total={listed.total}
              noun="operators"
              onPage={setPage}
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Company',
              flex: 2,
              primary: true,
              cell: (row) => (
                <View className="gap-0.5">
                  <Text variant="bodyStrong">{row.name}</Text>
                  <Text variant="caption" tone="muted">
                    {row.code}
                  </Text>
                </View>
              ),
            },
            {
              key: 'contact',
              header: 'Contact',
              flex: 2,
              cell: (row) => (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {[row.contactPhone, row.contactEmail].filter(Boolean).join(' · ') || '—'}
                </Text>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: 110,
              cell: (row) => (
                <Badge
                  label={row.status === OperatorStatus.ACTIVE ? 'Active' : 'Inactive'}
                  tone={row.status === OperatorStatus.ACTIVE ? 'success' : 'neutral'}
                />
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              width: 300,
              align: 'right',
              cell: (row) => (
                <View className="flex-row flex-wrap items-center justify-end gap-2">
                  <Button
                    label="View"
                    size="sm"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => setViewing(row)}
                  />
                  <Button
                    label="Edit"
                    size="sm"
                    variant="outline"
                    fullWidth={false}
                    onPress={() => openEdit(row)}
                  />
                  <Button
                    label="Add login"
                    size="sm"
                    variant="outline"
                    fullWidth={false}
                    icon={<UserPlus size={14} color={Colors.primary} />}
                    onPress={() => {
                      setAccountDraft({ fullName: '', email: '', phone: '' });
                      setAccountFor(row);
                    }}
                  />
                  {row.status === OperatorStatus.ACTIVE ? (
                    <Button
                      label="Deactivate"
                      size="sm"
                      variant="danger"
                      fullWidth={false}
                      onPress={() => setDeactivating(row)}
                    />
                  ) : (
                    <Button
                      label="Activate"
                      size="sm"
                      variant="outline"
                      fullWidth={false}
                      loading={setStatus.isPending}
                      onPress={() => void onStatus(row, OperatorStatus.ACTIVE)}
                    />
                  )}
                </View>
              ),
            },
          ]}
        />
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Add a company                                                    */}
      {/* ---------------------------------------------------------------- */}
      <Modal visible={adding} onClose={() => setAdding(false)} title="Add an operator">
        <View className="gap-4 pt-2">
          <Input
            label="Company name"
            placeholder="Cherry Bus"
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            autoCapitalize="words"
          />
          <Input
            label="Code"
            placeholder="CHERRY"
            hint="Short, unique, and permanent — routes, buses and staff all resolve through it."
            value={draft.code}
            onChangeText={(code) => setDraft((d) => ({ ...d, code }))}
            autoCapitalize="characters"
          />
          <Input
            label="Contact number (optional)"
            placeholder="0917 123 4567"
            value={draft.phone}
            onChangeText={(phone) => setDraft((d) => ({ ...d, phone }))}
            keyboardType="phone-pad"
          />
          <Input
            label="Contact email (optional)"
            placeholder="support@example.com"
            value={draft.email}
            onChangeText={(email) => setDraft((d) => ({ ...d, email }))}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text variant="caption" tone="muted">
            Creating the company does not create a login for it. Use “Add login” afterwards — that is
            the only way an operator account can be made, and only you can make one.
          </Text>
          <Button
            label="Add operator"
            disabled={!canCreate}
            loading={create.isPending}
            onPress={() => void onCreate()}
          />
          <Button label="Cancel" variant="ghost" onPress={() => setAdding(false)} />
        </View>
      </Modal>

      {/* ---------------------------------------------------------------- */}
      {/* Edit                                                             */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.name ?? ''}`}>
        <View className="gap-4 pt-2">
          <Input
            label="Company name"
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            autoCapitalize="words"
          />
          <Input
            label="Code"
            value={draft.code}
            editable={false}
            hint="Not editable. Changing it would orphan every route, bus and account that resolves through it."
          />
          <Input
            label="Contact number"
            value={draft.phone}
            onChangeText={(phone) => setDraft((d) => ({ ...d, phone }))}
            keyboardType="phone-pad"
          />
          <Input
            label="Contact email"
            value={draft.email}
            onChangeText={(email) => setDraft((d) => ({ ...d, email }))}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Button
            label="Save"
            disabled={draft.name.trim().length < 2}
            loading={update.isPending}
            onPress={() => void onSaveEdit()}
          />
          <Button label="Cancel" variant="ghost" onPress={() => setEditing(null)} />
        </View>
      </Modal>

      {/* ---------------------------------------------------------------- */}
      {/* View: the company's accounts, and what has been done to them      */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        visible={viewing !== null}
        onClose={() => {
          setViewing(null);
          setActivityFor(null);
        }}
        title={viewing?.name ?? ''}>
        <View className="gap-4 pt-2">
          <Text variant="label" tone="muted">
            Accounts
          </Text>

          {staff.isPending ? (
            <Loading label="Loading accounts…" className="py-4" />
          ) : (staff.data ?? []).length === 0 ? (
            <Text variant="body" tone="muted">
              Nobody can sign in for this company yet. Use “Add login”.
            </Text>
          ) : (
            <View className="gap-3">
              {(staff.data ?? []).map((account) => (
                <View key={account.id} className="gap-2 rounded-card border border-border p-3">
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="flex-1 gap-0.5">
                      <Text variant="bodyStrong">{account.fullName || account.email}</Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {account.email} · {account.role}
                      </Text>
                    </View>
                    <Badge
                      label={account.accountStatus === AccountStatus.ACTIVE ? 'Active' : 'Inactive'}
                      tone={account.accountStatus === AccountStatus.ACTIVE ? 'success' : 'danger'}
                    />
                  </View>

                  {account.mustChangePassword ? (
                    <Text variant="caption" tone="muted">
                      Has not chosen their own password yet.
                    </Text>
                  ) : null}

                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      label="Reset password"
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      icon={<KeyRound size={14} color={Colors.primary} />}
                      loading={resetPassword.isPending}
                      onPress={() =>
                        void resetPassword
                          .mutateAsync(account.id)
                          .then((r) =>
                            setIssued({ email: account.email, password: r.temporaryPassword }),
                          )
                          .catch((error) =>
                            showToast({
                              tone: 'danger',
                              title: 'Could not reset it',
                              message: message(error, 'Try again.'),
                            }),
                          )
                      }
                    />
                    <Button
                      label={
                        account.accountStatus === AccountStatus.ACTIVE ? 'Deactivate' : 'Activate'
                      }
                      size="sm"
                      variant={
                        account.accountStatus === AccountStatus.ACTIVE ? 'danger' : 'outline'
                      }
                      fullWidth={false}
                      loading={setAccountStatus.isPending}
                      onPress={() =>
                        void setAccountStatus
                          .mutateAsync({
                            userId: account.id,
                            status:
                              account.accountStatus === AccountStatus.ACTIVE
                                ? AccountStatus.INACTIVE
                                : AccountStatus.ACTIVE,
                          })
                          .catch((error) =>
                            showToast({
                              tone: 'danger',
                              title: 'Could not change the account',
                              message: message(error, 'Try again.'),
                            }),
                          )
                      }
                    />
                    <Button
                      label={activityFor === account.id ? 'Hide activity' : 'Activity'}
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      onPress={() =>
                        setActivityFor((current) => (current === account.id ? null : account.id))
                      }
                    />
                  </View>

                  {activityFor === account.id ? (
                    <View className="gap-1 border-t border-border pt-2">
                      {activity.isPending ? (
                        <Text variant="caption" tone="muted">
                          Loading…
                        </Text>
                      ) : (activity.data ?? []).length === 0 ? (
                        <Text variant="caption" tone="muted">
                          Nothing recorded yet.
                        </Text>
                      ) : (
                        (activity.data ?? []).slice(0, 10).map((entry) => (
                          <View key={entry.id} className="flex-row justify-between gap-3">
                            <Text variant="caption" className="flex-1">
                              {entry.action.replaceAll('_', ' ').toLowerCase()}
                            </Text>
                            <Text variant="caption" tone="muted">
                              {timeAgo(entry.created_at)}
                            </Text>
                          </View>
                        ))
                      )}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          <Button
            label="Close"
            variant="ghost"
            onPress={() => {
              setViewing(null);
              setActivityFor(null);
            }}
          />
        </View>
      </Modal>

      {/* ---------------------------------------------------------------- */}
      {/* Provision an operator login                                      */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        visible={accountFor !== null}
        onClose={() => setAccountFor(null)}
        title={`Add a login for ${accountFor?.name ?? ''}`}>
        <View className="gap-4 pt-2">
          <Text variant="body" tone="muted">
            They will be able to manage this company&apos;s buses, crew and schedule — and nothing
            belonging to any other company.
          </Text>
          <Input
            label="Full name"
            placeholder="Cherry Bus Ops"
            value={accountDraft.fullName}
            onChangeText={(fullName) => setAccountDraft((d) => ({ ...d, fullName }))}
            autoCapitalize="words"
          />
          <Input
            label="Email"
            placeholder="ops@example.com"
            value={accountDraft.email}
            onChangeText={(email) => setAccountDraft((d) => ({ ...d, email }))}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Input
            label="Mobile number (optional)"
            value={accountDraft.phone}
            onChangeText={(phone) => setAccountDraft((d) => ({ ...d, phone }))}
            keyboardType="phone-pad"
          />
          <Button
            label="Create account"
            disabled={!canCreateAccount}
            loading={createAccount.isPending}
            onPress={() => void onCreateAccount()}
          />
          <Button label="Cancel" variant="ghost" onPress={() => setAccountFor(null)} />
        </View>
      </Modal>

      <ConfirmDialog
        visible={deactivating !== null}
        title="Deactivate this operator?"
        message={`${deactivating?.name ?? ''} will stop selling seats. No new booking can be made on any of its trips.`}
        consequence="Nothing is deleted, and its staff can still sign in to wind the schedule down. Tickets already sold stay valid and travellable."
        confirmLabel="Deactivate operator"
        destructive
        loading={setStatus.isPending}
        onConfirm={() => deactivating && void onStatus(deactivating, OperatorStatus.INACTIVE)}
        onCancel={() => setDeactivating(null)}
      />

      <Modal
        visible={issued !== null}
        onClose={() => setIssued(null)}
        title="Temporary password"
        dismissOnBackdropPress={false}>
        <View className="gap-4 pt-2">
          <Alert
            tone="warning"
            title="Write this down now"
            message="It is shown once and is not stored anywhere. If it is lost, reset the password to issue a new one."
          />
          <View className="gap-1 rounded-card border border-border bg-background-tint p-4">
            <Text variant="caption" tone="muted">
              Email
            </Text>
            <Text variant="bodyStrong" selectable>
              {issued?.email}
            </Text>
            <Text variant="caption" tone="muted" className="pt-2">
              Temporary password
            </Text>
            <Text variant="mono" selectable className="text-[18px]">
              {issued?.password}
            </Text>
          </View>
          <Text variant="caption" tone="muted">
            They will be asked to choose their own password the first time they sign in.
          </Text>
          <Button label="Done" onPress={() => setIssued(null)} />
        </View>
      </Modal>
    </Screen>
  );
}
