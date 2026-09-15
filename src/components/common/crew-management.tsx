/**
 * Driver Management and Crew Management — one component, two screens.
 *
 * The drivers and the conductors differ only by whether a licence is involved,
 * so they share this rather than being two near-copies that drift apart.
 *
 * The thing this screen exists to make obvious is that a crew member has TWO
 * states, and they mean different things:
 *
 *   Account status  ACTIVE / INACTIVE     — can they sign in
 *   Availability    AVAILABLE / UNAVAILABLE — can they be given a new trip
 *
 * They are separate columns with separate labels and separate buttons, because
 * "deactivate" and "mark unavailable" are two different decisions and the one
 * that removes somebody's access should never be the easy misclick. A driver on
 * a rest day is ACTIVE + UNAVAILABLE, and the table says exactly that.
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
import { AccountStatus, AvailabilityStatus, CrewKind } from '@/constants/enums';
import { AdminContentMaxWidth, Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import {
  useCreateCrew,
  useCreateStaffAccount,
  useCrew,
  useResetStaffPassword,
  useSetAccountStatus,
  useSetCrewAvailability,
  useUpdateCrew,
} from '@/hooks/use-staff';
import { AppError } from '@/lib/errors';
import type { CrewMember } from '@/services/staff-service';
import { useUIStore } from '@/stores/ui-store';
import { applyTableControls, type SortDirection } from '@/utils/table';

type SortKey = 'name' | 'accountStatus' | 'availabilityStatus';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'accountStatus', label: 'Account status' },
  { value: 'availabilityStatus', label: 'Availability' },
];

export interface CrewManagementProps {
  kind: CrewKind;
  title: string;
  subtitle: string;
  /** Where the back arrow goes when there is no history to pop. */
  fallbackHref: string;
}

interface DraftState {
  name: string;
  phone: string;
  licenseNumber: string;
  licenseExpiry: string;
  email: string;
  withAccount: boolean;
}

const EMPTY_DRAFT: DraftState = {
  name: '',
  phone: '',
  licenseNumber: '',
  licenseExpiry: '',
  email: '',
  withAccount: true,
};

function message(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

export function CrewManagement({ kind, title, subtitle, fallbackHref }: CrewManagementProps) {
  const { profile } = useAuth();
  const crew = useCrew(kind);
  const showToast = useUIStore((state) => state.showToast);

  const createCrew = useCreateCrew();
  const createAccount = useCreateStaffAccount();
  const updateCrew = useUpdateCrew();
  const setAvailability = useSetCrewAvailability();
  const setAccountStatus = useSetAccountStatus();
  const resetPassword = useResetStaffPassword();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CrewMember | null>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  /**
   * Set when the sheet is attaching a login to somebody already on the roster,
   * rather than adding a new person. Without it the same name would end up on
   * the roster twice — once as the records-only row and once as the account.
   */
  const [linkingCrewId, setLinkingCrewId] = useState<string | null>(null);

  const [resting, setResting] = useState<CrewMember | null>(null);
  const [restReason, setRestReason] = useState('');
  const [deactivating, setDeactivating] = useState<CrewMember | null>(null);

  /** Shown once, after provisioning or a reset. Nothing stores it. */
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  const isDriver = kind === CrewKind.DRIVER;
  const noun = isDriver ? 'driver' : 'crew member';

  const page_ = useMemo(
    () =>
      applyTableControls(crew.data ?? [], {
        query,
        searchFields: ['name', 'phone', 'accountEmail', 'licenseNumber'],
        filters: { availabilityStatus: filter },
        sortKey,
        sortDirection,
        page,
        pageSize: 20,
      }),
    [crew.data, query, filter, sortKey, sortDirection, page],
  );

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setLinkingCrewId(null);
    setAdding(true);
  }

  function openEdit(member: CrewMember) {
    setDraft({
      name: member.name,
      phone: member.phone ?? '',
      licenseNumber: member.licenseNumber ?? '',
      licenseExpiry: member.licenseExpirationDate ?? '',
      email: member.accountEmail ?? '',
      withAccount: member.hasAccount,
    });
    setEditing(member);
  }

  const canSubmitNew =
    draft.name.trim().length > 1 &&
    (!isDriver || draft.licenseNumber.trim().length > 0) &&
    (!draft.withAccount || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()));

  async function onAdd() {
    try {
      if (draft.withAccount) {
        const result = await createAccount.mutateAsync({
          email: draft.email,
          fullName: draft.name,
          role: isDriver ? 'DRIVER' : 'ASSISTANT',
          operatorId: profile!.operatorId!,
          phone: draft.phone || undefined,
          licenseNumber: draft.licenseNumber || undefined,
          licenseExpirationDate: draft.licenseExpiry || undefined,
          crewId: linkingCrewId ?? undefined,
        });
        setAdding(false);
        setLinkingCrewId(null);
        setIssued({ email: result.email, password: result.temporaryPassword });
      } else {
        await createCrew.mutateAsync({
          kind,
          name: draft.name,
          phone: draft.phone || undefined,
          licenseNumber: draft.licenseNumber || undefined,
          licenseExpirationDate: draft.licenseExpiry || undefined,
        });
        setAdding(false);
        showToast({ tone: 'success', title: `${draft.name} added` });
      }
    } catch (error) {
      showToast({
        tone: 'danger',
        title: `Could not add this ${noun}`,
        message: message(error, 'Check the details and try again.'),
      });
    }
  }

  async function onSaveEdit() {
    if (!editing) return;
    try {
      await updateCrew.mutateAsync({
        kind,
        crewId: editing.id,
        name: draft.name,
        phone: draft.phone || undefined,
        licenseNumber: draft.licenseNumber || undefined,
        licenseExpirationDate: draft.licenseExpiry || undefined,
      });
      setEditing(null);
      showToast({ tone: 'success', title: 'Saved' });
    } catch (error) {
      showToast({ tone: 'danger', title: 'Could not save', message: message(error, 'Try again.') });
    }
  }

  async function onAvailability(member: CrewMember, status: AvailabilityStatus, reason?: string) {
    try {
      await setAvailability.mutateAsync({ kind, crewId: member.id, status, reason });
      setResting(null);
      setRestReason('');
      showToast({
        tone: 'success',
        title:
          status === AvailabilityStatus.AVAILABLE
            ? `${member.name} is available again`
            : `${member.name} is marked unavailable`,
        message:
          status === AvailabilityStatus.UNAVAILABLE
            ? 'They can still sign in and see their trips. They just will not be given a new one.'
            : undefined,
      });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not change availability',
        message: message(error, 'Try again.'),
      });
    }
  }

  async function onAccountStatus(member: CrewMember, status: AccountStatus) {
    if (!member.userId) return;
    try {
      const result = await setAccountStatus.mutateAsync({ userId: member.userId, status });
      setDeactivating(null);
      showToast({
        tone: 'success',
        title:
          status === AccountStatus.ACTIVE
            ? `${member.name} can sign in again`
            : `${member.name} can no longer sign in`,
        message:
          status === AccountStatus.INACTIVE && !result.sessionRevoked
            ? 'Their access is blocked, but an open session may take up to an hour to end.'
            : undefined,
      });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not change the account',
        message: message(error, 'Try again.'),
      });
    }
  }

  async function onReset(member: CrewMember) {
    if (!member.userId) return;
    try {
      const result = await resetPassword.mutateAsync(member.userId);
      setIssued({ email: member.accountEmail ?? '', password: result.temporaryPassword });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not reset the password',
        message: message(error, 'Try again.'),
      });
    }
  }

  return (
    <Screen padded={false} maxWidth={AdminContentMaxWidth} edges={['left', 'right']}>
      <View className="px-4">
        <Header title={title} subtitle={subtitle} showBack fallbackHref={fallbackHref as never} />
      </View>

      <TableToolbar<SortKey>
        searchValue={query}
        onSearch={(value) => {
          setQuery(value);
          setPage(1);
        }}
        searchPlaceholder={`Search ${isDriver ? 'drivers' : 'crew'} by name, phone or email`}
        filters={[
          { value: AvailabilityStatus.AVAILABLE, label: 'Available' },
          { value: AvailabilityStatus.UNAVAILABLE, label: 'Unavailable' },
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
        onToggleSortDirection={() =>
          setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
        }
        action={
          <Button
            label={`Add ${noun}`}
            size="sm"
            fullWidth={false}
            icon={<Plus size={16} color={Colors.textInverse} />}
            onPress={openAdd}
          />
        }
      />

      {crew.isPending ? (
        <Loading label={`Loading ${isDriver ? 'drivers' : 'crew'}…`} />
      ) : crew.isError ? (
        <ErrorState
          message={`Could not load your ${isDriver ? 'drivers' : 'crew'}.`}
          onRetry={() => void crew.refetch()}
        />
      ) : (
        <DataTable
          data={page_.rows}
          keyExtractor={(row) => row.id}
          minWidth={900}
          empty={
            <EmptyState
              title={query || filter ? 'Nothing matches' : `No ${isDriver ? 'drivers' : 'crew'} yet`}
              message={
                query || filter
                  ? 'Try a different search or filter.'
                  : `Add your first ${noun} to roster them onto a trip.`
              }
            />
          }
          footer={
            <TablePagination
              page={page_.page}
              pageCount={page_.pageCount}
              total={page_.total}
              noun={isDriver ? 'drivers' : 'crew'}
              onPage={setPage}
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Name',
              flex: 2,
              primary: true,
              cell: (row) => (
                <View className="gap-0.5">
                  <Text variant="bodyStrong">{row.name}</Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {[row.accountEmail, row.phone].filter(Boolean).join(' · ') || 'No contact details'}
                  </Text>
                </View>
              ),
            },
            ...(isDriver
              ? [
                  {
                    key: 'licence',
                    header: 'Licence',
                    flex: 1.2,
                    cell: (row: CrewMember) => (
                      <View className="gap-0.5">
                        <Text variant="caption">{row.licenseNumber ?? '—'}</Text>
                        {row.licenseExpirationDate ? (
                          <Text
                            variant="caption"
                            tone={
                              row.licenseExpirationDate < new Date().toISOString().slice(0, 10)
                                ? 'danger'
                                : 'muted'
                            }
                            className="text-[10px]">
                            {row.licenseExpirationDate < new Date().toISOString().slice(0, 10)
                              ? `Expired ${row.licenseExpirationDate}`
                              : `Valid to ${row.licenseExpirationDate}`}
                          </Text>
                        ) : (
                          <Text variant="caption" tone="muted" className="text-[10px]">
                            No expiry recorded
                          </Text>
                        )}
                      </View>
                    ),
                  },
                ]
              : []),
            {
              key: 'account',
              header: 'Account status',
              width: 150,
              cell: (row) =>
                row.hasAccount ? (
                  <View className="gap-1">
                    <Badge
                      label={row.accountStatus === AccountStatus.ACTIVE ? 'Active' : 'Inactive'}
                      tone={row.accountStatus === AccountStatus.ACTIVE ? 'success' : 'danger'}
                    />
                    {row.mustChangePassword ? (
                      <Text variant="caption" tone="muted" className="text-[10px]">
                        Must change password
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <Badge label="No login" tone="neutral" />
                ),
            },
            {
              key: 'availability',
              header: 'Availability',
              width: 140,
              cell: (row) => (
                <View className="gap-1">
                  <Badge
                    label={
                      row.availabilityStatus === AvailabilityStatus.AVAILABLE
                        ? 'Available'
                        : 'Unavailable'
                    }
                    tone={
                      row.availabilityStatus === AvailabilityStatus.AVAILABLE ? 'success' : 'warning'
                    }
                  />
                  {row.unavailableReason ? (
                    <Text variant="caption" tone="muted" numberOfLines={1} className="text-[10px]">
                      {row.unavailableReason}
                    </Text>
                  ) : null}
                </View>
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
                    label="Edit"
                    size="sm"
                    variant="outline"
                    fullWidth={false}
                    onPress={() => openEdit(row)}
                  />

                  {row.availabilityStatus === AvailabilityStatus.AVAILABLE ? (
                    <Button
                      label="Set unavailable"
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      onPress={() => {
                        setRestReason('');
                        setResting(row);
                      }}
                    />
                  ) : (
                    <Button
                      label="Set available"
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      loading={setAvailability.isPending}
                      onPress={() => void onAvailability(row, AvailabilityStatus.AVAILABLE)}
                    />
                  )}

                  {row.hasAccount ? (
                    <>
                      <Button
                        label="Reset password"
                        size="sm"
                        variant="ghost"
                        fullWidth={false}
                        icon={<KeyRound size={14} color={Colors.primary} />}
                        loading={resetPassword.isPending}
                        onPress={() => void onReset(row)}
                      />
                      {row.accountStatus === AccountStatus.ACTIVE ? (
                        <Button
                          label="Deactivate account"
                          size="sm"
                          variant="danger"
                          fullWidth={false}
                          onPress={() => setDeactivating(row)}
                        />
                      ) : (
                        <Button
                          label="Activate account"
                          size="sm"
                          variant="outline"
                          fullWidth={false}
                          loading={setAccountStatus.isPending}
                          onPress={() => void onAccountStatus(row, AccountStatus.ACTIVE)}
                        />
                      )}
                    </>
                  ) : (
                    <Button
                      label="Create login"
                      size="sm"
                      variant="outline"
                      fullWidth={false}
                      icon={<UserPlus size={14} color={Colors.primary} />}
                      onPress={() => {
                        setDraft({
                          name: row.name,
                          phone: row.phone ?? '',
                          licenseNumber: row.licenseNumber ?? '',
                          licenseExpiry: row.licenseExpirationDate ?? '',
                          email: '',
                          withAccount: true,
                        });
                        setEditing(null);
                        // Attach to THIS record, not a fresh one.
                        setLinkingCrewId(row.id);
                        setAdding(true);
                      }}
                    />
                  )}
                </View>
              ),
            },
          ]}
        />
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Add                                                              */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        visible={adding}
        onClose={() => {
          setAdding(false);
          setLinkingCrewId(null);
        }}
        title={linkingCrewId ? `Create a login for ${draft.name}` : `Add a ${noun}`}>
        <View className="gap-4 pt-2">
          <Input
            label="Full name"
            placeholder="Juan Santos"
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            autoCapitalize="words"
          />
          <Input
            label="Mobile number (optional)"
            placeholder="0917 123 4567"
            value={draft.phone}
            onChangeText={(phone) => setDraft((d) => ({ ...d, phone }))}
            keyboardType="phone-pad"
          />

          {isDriver ? (
            <>
              <Input
                label="Licence number"
                placeholder="DRV-001"
                value={draft.licenseNumber}
                onChangeText={(licenseNumber) => setDraft((d) => ({ ...d, licenseNumber }))}
                autoCapitalize="characters"
              />
              <Input
                label="Licence expiry (optional)"
                placeholder="YYYY-MM-DD"
                hint="A driver whose licence has expired by the departure date cannot be rostered."
                value={draft.licenseExpiry}
                onChangeText={(licenseExpiry) => setDraft((d) => ({ ...d, licenseExpiry }))}
                autoCapitalize="none"
              />
            </>
          ) : null}

          {linkingCrewId ? (
            <Text variant="caption" tone="muted">
              This attaches a login to the record already on your roster — it does not add a second
              person.
            </Text>
          ) : (
            <View className="gap-2">
              <View className="flex-row gap-2">
                <Button
                  label="With a login"
                  size="sm"
                  variant={draft.withAccount ? 'primary' : 'outline'}
                  onPress={() => setDraft((d) => ({ ...d, withAccount: true }))}
                />
                <Button
                  label="Records only"
                  size="sm"
                  variant={draft.withAccount ? 'outline' : 'primary'}
                  onPress={() => setDraft((d) => ({ ...d, withAccount: false }))}
                />
              </View>
              <Text variant="caption" tone="muted">
                {draft.withAccount
                  ? 'They get an account and a temporary password, shown once on the next screen.'
                  : 'They go on the roster and can be rostered onto trips, but cannot sign in. A login can be added later.'}
              </Text>
            </View>
          )}

          {draft.withAccount ? (
            <Input
              label="Email"
              placeholder="name@example.com"
              value={draft.email}
              onChangeText={(email) => setDraft((d) => ({ ...d, email }))}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          ) : null}

          <Button
            label={draft.withAccount ? 'Create account' : `Add ${noun}`}
            disabled={!canSubmitNew}
            loading={createCrew.isPending || createAccount.isPending}
            onPress={() => void onAdd()}
          />
          <Button
            label="Cancel"
            variant="ghost"
            onPress={() => {
              setAdding(false);
              setLinkingCrewId(null);
            }}
          />
        </View>
      </Modal>

      {/* ---------------------------------------------------------------- */}
      {/* Edit                                                             */}
      {/* ---------------------------------------------------------------- */}
      <Modal visible={editing !== null} onClose={() => setEditing(null)} title={`Edit ${editing?.name ?? ''}`}>
        <View className="gap-4 pt-2">
          <Input
            label="Full name"
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            autoCapitalize="words"
          />
          <Input
            label="Mobile number"
            value={draft.phone}
            onChangeText={(phone) => setDraft((d) => ({ ...d, phone }))}
            keyboardType="phone-pad"
          />
          {isDriver ? (
            <>
              <Input
                label="Licence number"
                value={draft.licenseNumber}
                onChangeText={(licenseNumber) => setDraft((d) => ({ ...d, licenseNumber }))}
                autoCapitalize="characters"
              />
              <Input
                label="Licence expiry"
                placeholder="YYYY-MM-DD"
                value={draft.licenseExpiry}
                onChangeText={(licenseExpiry) => setDraft((d) => ({ ...d, licenseExpiry }))}
                autoCapitalize="none"
              />
            </>
          ) : null}

          {editing?.accountEmail ? (
            <Text variant="caption" tone="muted">
              Signs in as {editing.accountEmail}. The email is not editable here.
            </Text>
          ) : null}

          <Button
            label="Save"
            disabled={draft.name.trim().length < 2}
            loading={updateCrew.isPending}
            onPress={() => void onSaveEdit()}
          />
          <Button label="Cancel" variant="ghost" onPress={() => setEditing(null)} />
        </View>
      </Modal>

      {/* ---------------------------------------------------------------- */}
      {/* Mark unavailable — a reason, because somebody will ask why        */}
      {/* ---------------------------------------------------------------- */}
      <Modal visible={resting !== null} onClose={() => setResting(null)} title="Set unavailable">
        <View className="gap-4 pt-2">
          <Text variant="body" tone="muted">
            {resting?.name} will keep their access and can still see their trips and notifications.
            They will not be offered for a new one until you set them available again.
          </Text>
          <Input
            label="Reason (optional)"
            placeholder="Rest day, leave, not driving this week…"
            value={restReason}
            onChangeText={setRestReason}
          />
          <Button
            label="Set unavailable"
            loading={setAvailability.isPending}
            onPress={() =>
              resting && void onAvailability(resting, AvailabilityStatus.UNAVAILABLE, restReason)
            }
          />
          <Button label="Cancel" variant="ghost" onPress={() => setResting(null)} />
        </View>
      </Modal>

      <ConfirmDialog
        visible={deactivating !== null}
        title="Deactivate this account?"
        message={`${deactivating?.name ?? ''} will not be able to sign in to PalaGo, and any session they have open will end.`}
        consequence="Nothing is deleted. Their trips, scans and assignments stay on the record, and you can activate the account again at any time."
        confirmLabel="Deactivate account"
        destructive
        loading={setAccountStatus.isPending}
        onConfirm={() => deactivating && void onAccountStatus(deactivating, AccountStatus.INACTIVE)}
        onCancel={() => setDeactivating(null)}
      />

      {/* ---------------------------------------------------------------- */}
      {/* The temporary password — shown once, and only once                */}
      {/* ---------------------------------------------------------------- */}
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
