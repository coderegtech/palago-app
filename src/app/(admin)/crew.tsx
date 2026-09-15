/**
 * Drivers and crew, platform-wide.
 *
 * An admin sees every company's people — `operator_crew` returns all of them
 * for an admin and only their own for an operator, and that filter is inside
 * the view rather than in this screen, so there is no way to forget it.
 *
 * Read and account status only: the day-to-day of a roster — hiring, editing,
 * rest days — belongs to the operator who employs them. What an admin needs is
 * to see who exists and, when something is wrong, to close a door.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { TablePagination, TableToolbar } from '@/components/ui/table-toolbar';
import { Text } from '@/components/ui/text';
import { AccountStatus, AvailabilityStatus, CrewKind } from '@/constants/enums';
import { AdminContentMaxWidth } from '@/constants/theme';
import { useAdminOperators } from '@/hooks/use-admin';
import { useCrew, useSetAccountStatus } from '@/hooks/use-staff';
import { AppError } from '@/lib/errors';
import type { CrewMember } from '@/services/staff-service';
import { useUIStore } from '@/stores/ui-store';
import { applyTableControls, type SortDirection } from '@/utils/table';

type SortKey = 'name' | 'kind' | 'accountStatus' | 'availabilityStatus';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'kind', label: 'Role' },
  { value: 'accountStatus', label: 'Account status' },
  { value: 'availabilityStatus', label: 'Availability' },
];

export default function AdminCrewScreen() {
  const crew = useCrew();
  const operators = useAdminOperators();
  const setAccountStatus = useSetAccountStatus();
  const showToast = useUIStore((state) => state.showToast);

  const [query, setQuery] = useState('');
  const [operatorFilter, setOperatorFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);
  const [deactivating, setDeactivating] = useState<CrewMember | null>(null);

  const byOperator = useMemo(() => {
    const map = new Map((operators.data ?? []).map((o) => [o.id, o.name]));
    return (id: string) => map.get(id) ?? '—';
  }, [operators.data]);

  const listed = useMemo(
    () =>
      applyTableControls(crew.data ?? [], {
        query,
        searchFields: ['name', 'accountEmail', 'phone', 'licenseNumber'],
        filters: { operatorId: operatorFilter },
        sortKey,
        sortDirection,
        page,
        pageSize: 25,
      }),
    [crew.data, query, operatorFilter, sortKey, sortDirection, page],
  );

  async function onAccountStatus(member: CrewMember, status: AccountStatus) {
    if (!member.userId) return;
    try {
      await setAccountStatus.mutateAsync({ userId: member.userId, status });
      setDeactivating(null);
      showToast({
        tone: 'success',
        title:
          status === AccountStatus.ACTIVE
            ? `${member.name} can sign in again`
            : `${member.name} can no longer sign in`,
      });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not change the account',
        message: error instanceof AppError ? error.message : 'Try again.',
      });
    }
  }

  return (
    <Screen padded={false} maxWidth={AdminContentMaxWidth} edges={['left', 'right']}>
      <View className="px-4">
        <Header title="Drivers and crew" subtitle="Everyone on the platform, and their access" />
      </View>

      <TableToolbar<SortKey>
        searchValue={query}
        onSearch={(value) => {
          setQuery(value);
          setPage(1);
        }}
        searchPlaceholder="Search by name, email, phone or licence"
        filters={(operators.data ?? []).map((operator) => ({
          value: operator.id,
          label: operator.name,
        }))}
        filterValue={operatorFilter}
        onFilter={(value) => {
          setOperatorFilter(value);
          setPage(1);
        }}
        allLabel="All operators"
        sortOptions={SORT_OPTIONS}
        sortKey={sortKey}
        onSortKey={setSortKey}
        sortDirection={sortDirection}
        onToggleSortDirection={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
      />

      {crew.isPending ? (
        <Loading label="Loading crew…" />
      ) : crew.isError ? (
        <ErrorState message="Could not load the crew." onRetry={() => void crew.refetch()} />
      ) : (
        <DataTable
          data={listed.rows}
          keyExtractor={(row) => `${row.kind}-${row.id}`}
          minWidth={960}
          empty={
            <EmptyState
              title={query || operatorFilter ? 'Nothing matches' : 'No crew yet'}
              message={
                query || operatorFilter
                  ? 'Try a different search or operator.'
                  : 'Operators add their own drivers and crew from their console.'
              }
            />
          }
          footer={
            <TablePagination
              page={listed.page}
              pageCount={listed.pageCount}
              total={listed.total}
              noun="people"
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
                    {row.accountEmail ?? 'No login'} · {byOperator(row.operatorId)}
                  </Text>
                </View>
              ),
            },
            {
              key: 'kind',
              header: 'Role',
              width: 110,
              cell: (row) => (
                <Badge
                  label={row.kind === CrewKind.DRIVER ? 'Driver' : 'Crew'}
                  tone={row.kind === CrewKind.DRIVER ? 'primary' : 'neutral'}
                />
              ),
            },
            {
              key: 'account',
              header: 'Account status',
              width: 140,
              cell: (row) =>
                row.hasAccount ? (
                  <Badge
                    label={row.accountStatus === AccountStatus.ACTIVE ? 'Active' : 'Inactive'}
                    tone={row.accountStatus === AccountStatus.ACTIVE ? 'success' : 'danger'}
                  />
                ) : (
                  <Badge label="No login" tone="neutral" />
                ),
            },
            {
              key: 'availability',
              header: 'Availability',
              width: 140,
              cell: (row) => (
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
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              width: 190,
              align: 'right',
              cell: (row) =>
                row.hasAccount ? (
                  row.accountStatus === AccountStatus.ACTIVE ? (
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
                  )
                ) : (
                  <Text variant="caption" tone="muted">
                    Roster only
                  </Text>
                ),
            },
          ]}
        />
      )}

      <ConfirmDialog
        visible={deactivating !== null}
        title="Deactivate this account?"
        message={`${deactivating?.name ?? ''} will not be able to sign in, and any session they have open will end.`}
        consequence="Nothing is deleted. Their trips, scans and assignments stay on the record. Their availability for work is a separate setting, managed by their operator."
        confirmLabel="Deactivate account"
        destructive
        loading={setAccountStatus.isPending}
        onConfirm={() => deactivating && void onAccountStatus(deactivating, AccountStatus.INACTIVE)}
        onCancel={() => setDeactivating(null)}
      />
    </Screen>
  );
}
