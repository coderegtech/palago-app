/**
 * Fleet management.
 *
 * Reads `operator_fleet`, never `buses`: the base table is world-readable so
 * trip search can show a coach's type and capacity, and selecting from it
 * directly once listed a rival operator's vehicles here.
 *
 * Capacity is set once, at creation, and is not editable. `create_bus` builds
 * the seat layout from it in the same transaction, so a coach can never exist
 * with a seat map that disagrees with how many people it holds — and changing
 * the number afterwards without regenerating that map would make every seat
 * assignment on every future trip wrong.
 *
 * "Delete" is deactivation. A coach is referenced by trips, tickets and
 * boarding scans; taking it off the road stops it being scheduled or sold, and
 * leaves the record of everywhere it has been.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Bus, Plus, Ship } from 'lucide-react-native';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Header } from '@/components/ui/header';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { TablePagination, TableToolbar } from '@/components/ui/table-toolbar';
import { Text } from '@/components/ui/text';
import { BusType, OperatorStatus } from '@/constants/enums';
import { AdminContentMaxWidth, Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useBuses, useCreateBus, useSetBusStatus, useUpdateBus } from '@/hooks/use-operator';
import { AppError } from '@/lib/errors';
import type { FleetBus } from '@/services/operator-service';
import { useUIStore } from '@/stores/ui-store';
import { applyTableControls, type SortDirection } from '@/utils/table';

type SortKey = 'busNumber' | 'plateNumber' | 'capacity' | 'status';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'busNumber', label: 'Bus number' },
  { value: 'plateNumber', label: 'Plate' },
  { value: 'capacity', label: 'Capacity' },
  { value: 'status', label: 'Status' },
];

interface Draft {
  busNumber: string;
  plateNumber: string;
  name: string;
  capacity: string;
  busType: BusType;
}

const EMPTY: Draft = {
  busNumber: '',
  plateNumber: '',
  name: '',
  capacity: '',
  busType: BusType.BUS,
};

function message(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

export default function BusesScreen() {
  const { profile } = useAuth();
  const buses = useBuses();
  const create = useCreateBus();
  const update = useUpdateBus();
  const setStatus = useSetBusStatus();
  const showToast = useUIStore((state) => state.showToast);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('busNumber');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FleetBus | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [withdrawing, setWithdrawing] = useState<FleetBus | null>(null);

  const listed = useMemo(
    () =>
      applyTableControls(buses.data ?? [], {
        query,
        searchFields: ['busNumber', 'plateNumber', 'name'],
        filters: { status: filter },
        sortKey,
        sortDirection,
        page,
        pageSize: 20,
      }),
    [buses.data, query, filter, sortKey, sortDirection, page],
  );

  const capacity = Number(draft.capacity);
  const canCreate =
    draft.busNumber.trim().length > 0 &&
    draft.plateNumber.trim().length > 0 &&
    Number.isInteger(capacity) &&
    capacity > 0 &&
    capacity <= 80;

  async function onCreate() {
    try {
      const result = await create.mutateAsync({
        operatorId: profile!.operatorId!,
        busNumber: draft.busNumber,
        plateNumber: draft.plateNumber,
        capacity,
        busType: draft.busType,
        name: draft.name || null,
      });
      setAdding(false);
      setDraft(EMPTY);
      showToast({
        tone: 'success',
        title: `${draft.busNumber} added`,
        message: `${result.seats} seats laid out.`,
      });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not add the coach',
        message: message(error, 'Check the plate and bus number are not already in use.'),
      });
    }
  }

  async function onSaveEdit() {
    if (!editing) return;
    try {
      await update.mutateAsync({
        busId: editing.id,
        busNumber: draft.busNumber,
        plateNumber: draft.plateNumber,
        name: draft.name || null,
      });
      setEditing(null);
      showToast({ tone: 'success', title: 'Saved' });
    } catch (error) {
      showToast({ tone: 'danger', title: 'Could not save', message: message(error, 'Try again.') });
    }
  }

  async function onStatus(bus: FleetBus, status: OperatorStatus) {
    try {
      const result = await setStatus.mutateAsync({ busId: bus.id, status });
      setWithdrawing(null);
      showToast({
        tone: 'success',
        title:
          status === OperatorStatus.ACTIVE
            ? `${bus.busNumber} is back on the road`
            : `${bus.busNumber} is off the road`,
        message:
          status === OperatorStatus.INACTIVE && result.upcomingTrips > 0
            ? `${result.upcomingTrips} scheduled departure${result.upcomingTrips === 1 ? '' : 's'} can no longer sell seats. Move or cancel any that will not run.`
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

  return (
    <Screen padded={false} maxWidth={AdminContentMaxWidth} edges={['left', 'right']}>
      <View className="px-4">
        <Header
          title="Fleet"
          subtitle="Buses and RoRo coaches"
          showBack
          fallbackHref="/(operator)/dashboard"
        />
      </View>

      <TableToolbar<SortKey>
        searchValue={query}
        onSearch={(value) => {
          setQuery(value);
          setPage(1);
        }}
        searchPlaceholder="Search by bus number, plate or name"
        filters={[
          { value: OperatorStatus.ACTIVE, label: 'On the road' },
          { value: OperatorStatus.INACTIVE, label: 'Off the road' },
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
            label="Add coach"
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

      {buses.isPending ? (
        <Loading label="Loading fleet…" />
      ) : buses.isError ? (
        <ErrorState message="Could not load your fleet." onRetry={() => void buses.refetch()} />
      ) : (
        <DataTable
          data={listed.rows}
          keyExtractor={(row) => row.id}
          minWidth={820}
          empty={
            <EmptyState
              title={query || filter ? 'Nothing matches' : 'No coaches yet'}
              message={
                query || filter
                  ? 'Try a different search or filter.'
                  : 'Add your first coach to start scheduling departures.'
              }
            />
          }
          footer={
            <TablePagination
              page={listed.page}
              pageCount={listed.pageCount}
              total={listed.total}
              noun="coaches"
              onPage={setPage}
            />
          }
          columns={[
            {
              key: 'bus',
              header: 'Coach',
              flex: 2,
              primary: true,
              cell: (row) => (
                <View className="flex-row items-center gap-3">
                  <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
                    {row.busType === BusType.RORO ? (
                      <Ship size={16} color={Colors.primary} />
                    ) : (
                      <Bus size={16} color={Colors.primary} />
                    )}
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text variant="bodyStrong">{row.name ?? row.busNumber}</Text>
                    <Text variant="caption" tone="muted">
                      {row.busNumber} · {row.plateNumber}
                    </Text>
                  </View>
                </View>
              ),
            },
            {
              key: 'capacity',
              header: 'Seats',
              width: 90,
              cell: (row) => <Text variant="caption">{row.capacity}</Text>,
            },
            {
              key: 'status',
              header: 'Status',
              width: 130,
              cell: (row) => (
                <Badge
                  label={row.status === OperatorStatus.ACTIVE ? 'On the road' : 'Off the road'}
                  tone={row.status === OperatorStatus.ACTIVE ? 'success' : 'neutral'}
                />
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              width: 220,
              align: 'right',
              cell: (row) => (
                <View className="flex-row flex-wrap items-center justify-end gap-2">
                  <Button
                    label="Edit"
                    size="sm"
                    variant="outline"
                    fullWidth={false}
                    onPress={() => {
                      setDraft({
                        busNumber: row.busNumber,
                        plateNumber: row.plateNumber,
                        name: row.name ?? '',
                        capacity: String(row.capacity),
                        busType: row.busType,
                      });
                      setEditing(row);
                    }}
                  />
                  {row.status === OperatorStatus.ACTIVE ? (
                    <Button
                      label="Take off the road"
                      size="sm"
                      variant="danger"
                      fullWidth={false}
                      onPress={() => setWithdrawing(row)}
                    />
                  ) : (
                    <Button
                      label="Put back"
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

      <Modal visible={adding} onClose={() => setAdding(false)} title="Add a coach">
        <View className="gap-4 pt-2">
          <Input
            label="Bus number"
            placeholder="CB-004"
            value={draft.busNumber}
            onChangeText={(busNumber) => setDraft((d) => ({ ...d, busNumber }))}
            autoCapitalize="characters"
          />
          <Input
            label="Plate number"
            placeholder="ABC 1234"
            value={draft.plateNumber}
            onChangeText={(plateNumber) => setDraft((d) => ({ ...d, plateNumber }))}
            autoCapitalize="characters"
          />
          <Input
            label="Name (optional)"
            placeholder="Cherry Express 4"
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
          />
          <Select<BusType>
            label="Type"
            value={draft.busType}
            options={[
              { value: BusType.BUS, label: 'Bus' },
              { value: BusType.RORO, label: 'RoRo coach' },
            ]}
            onChange={(busType) => setDraft((d) => ({ ...d, busType }))}
          />
          <Input
            label="Capacity"
            placeholder="45"
            hint="Set once. The seat map is built from it now, and cannot be changed later without rebuilding every seat."
            value={draft.capacity}
            onChangeText={(value) => setDraft((d) => ({ ...d, capacity: value.replace(/\D/g, '') }))}
            keyboardType="number-pad"
          />
          <Button
            label="Add coach"
            disabled={!canCreate}
            loading={create.isPending}
            onPress={() => void onCreate()}
          />
          <Button label="Cancel" variant="ghost" onPress={() => setAdding(false)} />
        </View>
      </Modal>

      <Modal
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.busNumber ?? ''}`}>
        <View className="gap-4 pt-2">
          <Input
            label="Bus number"
            value={draft.busNumber}
            onChangeText={(busNumber) => setDraft((d) => ({ ...d, busNumber }))}
            autoCapitalize="characters"
          />
          <Input
            label="Plate number"
            value={draft.plateNumber}
            onChangeText={(plateNumber) => setDraft((d) => ({ ...d, plateNumber }))}
            autoCapitalize="characters"
          />
          <Input
            label="Name"
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
          />
          <Input
            label="Capacity"
            value={draft.capacity}
            editable={false}
            hint="Not editable. The seat map was built from this number, and changing one without the other would make every seat assignment wrong."
          />
          <Button
            label="Save"
            disabled={draft.busNumber.trim().length === 0 || draft.plateNumber.trim().length === 0}
            loading={update.isPending}
            onPress={() => void onSaveEdit()}
          />
          <Button label="Cancel" variant="ghost" onPress={() => setEditing(null)} />
        </View>
      </Modal>

      <ConfirmDialog
        visible={withdrawing !== null}
        title="Take this coach off the road?"
        message={`${withdrawing?.busNumber ?? ''} will not appear in passenger search and cannot be put on a new departure.`}
        consequence="Nothing is deleted. Its scheduled trips are not cancelled either — decide those one by one, because passengers are already on them."
        confirmLabel="Take off the road"
        destructive
        loading={setStatus.isPending}
        onConfirm={() => withdrawing && void onStatus(withdrawing, OperatorStatus.INACTIVE)}
        onCancel={() => setWithdrawing(null)}
      />
    </Screen>
  );
}
