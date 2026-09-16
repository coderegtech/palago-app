/**
 * Schedules, platform-wide.
 *
 * Reads `trip_search`, not the operator views: those are scoped through
 * `current_operator_id()`, which is null for an admin, so they would correctly
 * return nothing. `trip_search` also carries the status of the operator, the
 * route and the coach, which is exactly what an admin needs — a departure whose
 * bus has been withdrawn is the interesting one, and it is the one the operator
 * views hide.
 *
 * The admin can do everything an operator can to a departure, for any company.
 * What they cannot do is delete one: a trip is referenced by tickets, payments
 * and boarding scans, so it is cancelled or withdrawn and stays on the record.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { ArrowRight, Plus, Timer } from 'lucide-react-native';

import { TripForm, type TripFormOption, type TripFormValues } from '@/components/common/trip-form';
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
import { AvailabilityStatus, CrewKind, OperatorStatus, TripStatus } from '@/constants/enums';
import { AdminContentMaxWidth, Colors } from '@/constants/theme';
import { useAdminBuses, useAdminOperators, useAdminRoutes } from '@/hooks/use-admin';
import {
  useAllTrips,
  useAssignCrew,
  useCancelTrip,
  useCreateTrip,
  useSetTurnaroundMinutes,
  useTurnaroundMinutes,
  useUpdateTrip,
} from '@/hooks/use-schedule';
import { useCrew } from '@/hooks/use-staff';
import { AppError } from '@/lib/errors';
import type { ScheduleRow } from '@/services/schedule-service';
import { useUIStore } from '@/stores/ui-store';
import { formatDateShort, formatTime } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';
import { applyTableControls, type SortDirection } from '@/utils/table';

type SortKey = 'departure_date' | 'trip_number' | 'operator_name' | 'status';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'departure_date', label: 'Departure' },
  { value: 'trip_number', label: 'Trip number' },
  { value: 'operator_name', label: 'Operator' },
  { value: 'status', label: 'Status' },
];

function message(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

export default function AdminSchedulesScreen() {
  const trips = useAllTrips();
  const operators = useAdminOperators();
  const routes = useAdminRoutes();
  const buses = useAdminBuses();
  const drivers = useCrew(CrewKind.DRIVER);
  const assistants = useCrew(CrewKind.CREW);
  const turnaround = useTurnaroundMinutes();
  const showToast = useUIStore((state) => state.showToast);

  const createTrip = useCreateTrip();
  const updateTrip = useUpdateTrip();
  const cancelTrip = useCancelTrip();
  const assignCrew = useAssignCrew();
  const setTurnaround = useSetTurnaroundMinutes();

  const [query, setQuery] = useState('');
  const [operatorFilter, setOperatorFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('departure_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);

  /** The company a new departure is being scheduled for. */
  const [schedulingFor, setSchedulingFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduleRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [crewFor, setCrewFor] = useState<ScheduleRow | null>(null);
  const [crewDraft, setCrewDraft] = useState<{ driverId: string | null; assistantId: string | null }>(
    { driverId: null, assistantId: null },
  );
  const [crewError, setCrewError] = useState<string | null>(null);

  const [cancelling, setCancelling] = useState<ScheduleRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [tuning, setTuning] = useState(false);
  const [bufferDraft, setBufferDraft] = useState('');

  const listed = useMemo(
    () =>
      applyTableControls(trips.data ?? [], {
        query,
        searchFields: [
          'trip_number',
          'operator_name',
          'origin_code',
          'destination_code',
          'bus_number',
        ],
        filters: { operator_id: operatorFilter },
        sortKey,
        sortDirection,
        page,
        pageSize: 25,
      }),
    [trips.data, query, operatorFilter, sortKey, sortDirection, page],
  );

  /** The company being scheduled for, when a form is open. */
  const formOperatorId = editing?.operator_id ?? schedulingFor;

  const routeOptions: TripFormOption[] = (routes.data ?? [])
    .filter((route) => route.operatorId === formOperatorId)
    .map((route) => ({
      id: route.id,
      label: `${route.originCode} → ${route.destinationCode}`,
      description: `${route.originName} to ${route.destinationName}`,
      status: route.status,
    }));

  const busOptions: TripFormOption[] = (buses.data ?? [])
    .filter((bus) => bus.operatorId === formOperatorId)
    .map((bus) => ({
      id: bus.id,
      label: `${bus.busNumber} · ${bus.capacity} seats`,
      description: bus.plateNumber,
      status: bus.status,
    }));

  const rosterable = (kind: CrewKind, operatorId: string | undefined) =>
    ((kind === CrewKind.DRIVER ? drivers.data : assistants.data) ?? [])
      .filter(
        (member) =>
          member.operatorId === operatorId &&
          member.availabilityStatus === AvailabilityStatus.AVAILABLE &&
          (member.accountStatus === null || member.accountStatus === 'ACTIVE'),
      )
      .map((member) => ({ value: member.id, label: member.name }));

  async function onSubmit(values: TripFormValues & { fareCentavos: number }) {
    setFormError(null);
    try {
      if (editing) {
        await updateTrip.mutateAsync({
          tripId: editing.id,
          routeId: values.routeId,
          busId: values.busId,
          tripNumber: values.tripNumber,
          departureDate: values.departureDate,
          departureTime: values.departureTime,
          arrivalTime: values.arrivalTime,
          fare: values.fareCentavos,
        });
      } else {
        await createTrip.mutateAsync({
          routeId: values.routeId,
          busId: values.busId,
          tripNumber: values.tripNumber,
          departureDate: values.departureDate,
          departureTime: values.departureTime,
          arrivalTime: values.arrivalTime,
          fare: values.fareCentavos,
          operatorId: schedulingFor ?? undefined,
        });
      }
      setEditing(null);
      setSchedulingFor(null);
      showToast({ tone: 'success', title: editing ? 'Departure updated' : 'Departure scheduled' });
    } catch (error) {
      setFormError(message(error, 'Check the details and try again.'));
    }
  }

  async function onAssign() {
    if (!crewFor) return;
    setCrewError(null);
    try {
      await assignCrew.mutateAsync({
        tripId: crewFor.id,
        driverId: crewDraft.driverId,
        assistantId: crewDraft.assistantId,
      });
      setCrewFor(null);
      showToast({ tone: 'success', title: 'Crew updated' });
    } catch (error) {
      setCrewError(message(error, 'Check the crew are available and try again.'));
    }
  }

  async function onCancel() {
    if (!cancelling) return;
    try {
      const result = await cancelTrip.mutateAsync({ tripId: cancelling.id, reason: cancelReason });
      setCancelling(null);
      setCancelReason('');
      showToast({
        tone: 'success',
        title: `${cancelling.trip_number} cancelled`,
        message:
          result.bookingsCancelled > 0
            ? `${result.bookingsCancelled} booking${result.bookingsCancelled === 1 ? '' : 's'} cancelled and the passengers told.`
            : 'Nobody had booked it.',
      });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not cancel',
        message: message(error, 'Try again.'),
      });
    }
  }

  async function onSaveBuffer() {
    const minutes = Number(bufferDraft);
    try {
      const result = await setTurnaround.mutateAsync(minutes);
      setTuning(false);
      showToast({
        tone: 'success',
        title: `Turnaround is now ${minutes} minutes`,
        message: `${result.tripsRestamped} future departure${result.tripsRestamped === 1 ? '' : 's'} re-checked.`,
      });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not change the turnaround',
        message: message(
          error,
          'Widening it would put two coaches on top of each other. Move one of them first.',
        ),
      });
    }
  }

  const activeOperators = (operators.data ?? []).filter(
    (operator) => operator.status === OperatorStatus.ACTIVE,
  );

  return (
    <Screen padded={false} maxWidth={AdminContentMaxWidth} edges={['left', 'right']}>
      <View className="px-4">
        <Header title="Schedules" subtitle="Every departure on the platform" />
      </View>

      <TableToolbar<SortKey>
        searchValue={query}
        onSearch={(value) => {
          setQuery(value);
          setPage(1);
        }}
        searchPlaceholder="Search by trip number, operator, route or coach"
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
        action={
          <View className="flex-row gap-2">
            <Button
              label={`Turnaround ${turnaround.data ?? 30}m`}
              size="sm"
              variant="outline"
              fullWidth={false}
              icon={<Timer size={14} color={Colors.primary} />}
              onPress={() => {
                setBufferDraft(String(turnaround.data ?? 30));
                setTuning(true);
              }}
            />
            <Button
              label="Schedule"
              size="sm"
              fullWidth={false}
              icon={<Plus size={16} color={Colors.textInverse} />}
              disabled={activeOperators.length === 0}
              onPress={() => {
                setFormError(null);
                setSchedulingFor(operatorFilter ?? activeOperators[0]?.id ?? null);
              }}
            />
          </View>
        }
      />

      {trips.isPending ? (
        <Loading label="Loading schedules…" />
      ) : trips.isError ? (
        <ErrorState message="Could not load the schedules." onRetry={() => void trips.refetch()} />
      ) : (
        <DataTable
          data={listed.rows}
          keyExtractor={(row) => row.id}
          minWidth={1060}
          empty={
            <EmptyState
              title={query || operatorFilter ? 'Nothing matches' : 'No departures'}
              message={
                query || operatorFilter
                  ? 'Try a different search or operator.'
                  : 'Schedule the first departure, or let an operator do it from their own console.'
              }
            />
          }
          footer={
            <TablePagination
              page={listed.page}
              pageCount={listed.pageCount}
              total={listed.total}
              noun="departures"
              onPage={setPage}
            />
          }
          columns={[
            {
              key: 'trip',
              header: 'Departure',
              flex: 2,
              primary: true,
              cell: (row) => (
                <View className="gap-0.5">
                  <View className="flex-row items-center gap-2">
                    <Text variant="bodyStrong">{row.origin_code}</Text>
                    <ArrowRight size={12} color={Colors.textMuted} />
                    <Text variant="bodyStrong">{row.destination_code}</Text>
                  </View>
                  <Text variant="caption" tone="muted">
                    {row.trip_number} · {formatDateShort(row.departure_date)}{' '}
                    {formatTime(row.departure_time)}–{formatTime(row.arrival_time)}
                  </Text>
                </View>
              ),
            },
            {
              key: 'operator',
              header: 'Operator',
              flex: 1.2,
              cell: (row) => (
                <View className="gap-0.5">
                  <Text variant="caption">{row.operator_name}</Text>
                  {row.operator_status !== OperatorStatus.ACTIVE ? (
                    <Text variant="caption" tone="danger" className="text-[10px]">
                      Operator inactive
                    </Text>
                  ) : null}
                </View>
              ),
            },
            {
              key: 'bus',
              header: 'Coach',
              flex: 1,
              cell: (row) => (
                <View className="gap-0.5">
                  <Text variant="caption">{row.bus_number}</Text>
                  {/* An inactive coach or route is exactly what an admin is
                      looking for here, so it is said outright rather than
                      filtered out of the list. */}
                  <Text
                    variant="caption"
                    tone={
                      row.bus_status !== OperatorStatus.ACTIVE ||
                      row.route_status !== OperatorStatus.ACTIVE
                        ? 'danger'
                        : 'muted'
                    }
                    className="text-[10px]">
                    {row.bus_status !== OperatorStatus.ACTIVE
                      ? 'Bus off the road'
                      : row.route_status !== OperatorStatus.ACTIVE
                        ? 'Route inactive'
                        : `${row.available_seats}/${row.capacity} free · ${formatMoney(row.fare)}`}
                  </Text>
                </View>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: 130,
              cell: (row) => (
                <View className="gap-1">
                  <Badge
                    label={row.status}
                    tone={
                      row.status === TripStatus.CANCELLED
                        ? 'danger'
                        : row.status === TripStatus.COMPLETED
                          ? 'neutral'
                          : 'primary'
                    }
                  />
                  {!row.is_active ? (
                    <Text variant="caption" tone="muted" className="text-[10px]">
                      Withdrawn from sale
                    </Text>
                  ) : null}
                </View>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              width: 250,
              align: 'right',
              cell: (row) =>
                row.status === TripStatus.SCHEDULED || row.status === TripStatus.BOARDING ? (
                  <View className="flex-row flex-wrap items-center justify-end gap-2">
                    <Button
                      label="Crew"
                      size="sm"
                      variant="outline"
                      fullWidth={false}
                      onPress={() => {
                        setCrewDraft({ driverId: null, assistantId: null });
                        setCrewError(null);
                        setCrewFor(row);
                      }}
                    />
                    {row.status === TripStatus.SCHEDULED ? (
                      <Button
                        label="Edit"
                        size="sm"
                        variant="outline"
                        fullWidth={false}
                        onPress={() => {
                          setFormError(null);
                          setEditing(row);
                        }}
                      />
                    ) : null}
                    <Button
                      label="Cancel"
                      size="sm"
                      variant="danger"
                      fullWidth={false}
                      onPress={() => {
                        setCancelReason('');
                        setCancelling(row);
                      }}
                    />
                  </View>
                ) : (
                  <Text variant="caption" tone="muted">
                    {row.status === TripStatus.CANCELLED ? 'Cancelled' : 'Closed'}
                  </Text>
                ),
            },
          ]}
        />
      )}

      {editing || schedulingFor ? (
        <TripForm
          title={
            editing
              ? `Edit ${editing.trip_number}`
              : `Schedule for ${activeOperators.find((o) => o.id === schedulingFor)?.name ?? ''}`
          }
          initial={
            editing
              ? {
                  routeId: editing.route_id,
                  busId: editing.bus_id,
                  tripNumber: editing.trip_number,
                  departureDate: editing.departure_date,
                  departureTime: editing.departure_time.slice(0, 5),
                  arrivalTime: editing.arrival_time.slice(0, 5),
                  fare: String(editing.fare / 100),
                }
              : undefined
          }
          routes={routeOptions}
          buses={busOptions}
          submitting={createTrip.isPending || updateTrip.isPending}
          error={formError}
          turnaroundMinutes={turnaround.data}
          onSubmit={(values) => void onSubmit(values)}
          onClose={() => {
            setEditing(null);
            setSchedulingFor(null);
          }}
        />
      ) : null}

      <Modal
        visible={crewFor !== null}
        onClose={() => setCrewFor(null)}
        title={`Crew for ${crewFor?.trip_number ?? ''}`}>
        <View className="gap-4 pt-2">
          {crewError ? (
            <Text variant="body" tone="danger">
              {crewError}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted">
            Only {crewFor?.operator_name}&apos;s own crew can take this departure, and only those
            whose account is active and who are available for work.
          </Text>
          <Select
            label="Driver"
            placeholder="Nobody"
            value={crewDraft.driverId}
            options={rosterable(CrewKind.DRIVER, crewFor?.operator_id)}
            onChange={(driverId) => setCrewDraft((d) => ({ ...d, driverId }))}
          />
          <Select
            label="Conductor"
            placeholder="Nobody"
            value={crewDraft.assistantId}
            options={rosterable(CrewKind.CREW, crewFor?.operator_id)}
            onChange={(assistantId) => setCrewDraft((d) => ({ ...d, assistantId }))}
          />
          <Button
            label="Save crew"
            disabled={!crewDraft.driverId && !crewDraft.assistantId}
            loading={assignCrew.isPending}
            onPress={() => void onAssign()}
          />
          <Button label="Cancel" variant="ghost" onPress={() => setCrewFor(null)} />
        </View>
      </Modal>

      <Modal
        visible={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={`Cancel ${cancelling?.trip_number ?? ''}?`}
        dismissOnBackdropPress={false}>
        <View className="gap-4 pt-2">
          <Text variant="body" tone="muted">
            Every live booking on this departure will be cancelled, the seats released and the
            passengers told. Nothing is deleted, and refunds are separate.
          </Text>
          <Input
            label="Reason (optional)"
            placeholder="Why it is not running"
            value={cancelReason}
            onChangeText={setCancelReason}
          />
          <Button
            label="Cancel this departure"
            variant="danger"
            loading={cancelTrip.isPending}
            onPress={() => void onCancel()}
          />
          <Button label="Keep it" variant="ghost" onPress={() => setCancelling(null)} />
        </View>
      </Modal>

      <Modal visible={tuning} onClose={() => setTuning(false)} title="Turnaround buffer">
        <View className="gap-4 pt-2">
          <Text variant="body" tone="muted">
            How long a coach and its crew stay spoken for after a trip arrives. A bus docking at
            14:00 cannot leave again until this much later.
          </Text>
          <Input
            label="Minutes"
            value={bufferDraft}
            onChangeText={(value) => setBufferDraft(value.replace(/\D/g, ''))}
            keyboardType="number-pad"
          />
          <Text variant="caption" tone="muted">
            Widening it re-checks every future departure at once. If that would put two coaches on
            top of each other, the change is refused outright and names the pair — move one of them
            first.
          </Text>
          <Button
            label="Save"
            disabled={bufferDraft === '' || Number(bufferDraft) > 720}
            loading={setTurnaround.isPending}
            onPress={() => void onSaveBuffer()}
          />
          <Button label="Cancel" variant="ghost" onPress={() => setTuning(false)} />
        </View>
      </Modal>

    </Screen>
  );
}
