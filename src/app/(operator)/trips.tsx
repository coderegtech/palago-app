/**
 * Schedule management.
 *
 * Every departure this company runs, and the four things that can be done to
 * one: edit it, roster a crew onto it, withdraw it from sale, or cancel it.
 *
 * Two words that look alike and are not:
 *
 *   Withdraw — the departure is not being sold. Refused while anyone holds a
 *              seat on it, because the honest word for that is "cancel".
 *   Cancel   — the trip was going to run and will not. Every live booking is
 *              cancelled with it, the seats are released, the crew is freed and
 *              the passengers are told.
 *
 * Neither deletes anything. A ticket has to keep resolving to the trip it was
 * bought for, however that trip ended.
 */

import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { ArrowRight, Plus } from 'lucide-react-native';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
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
import { useAuth } from '@/hooks/use-auth';
import { useBuses, useOperatorRoutes, useOperatorTrips } from '@/hooks/use-operator';
import {
  useAssignCrew,
  useCancelTrip,
  useCreateTrip,
  useSetTripActive,
  useTurnaroundMinutes,
  useUnassignCrew,
  useUpdateTrip,
} from '@/hooks/use-schedule';
import { useCrew } from '@/hooks/use-staff';
import { AppError } from '@/lib/errors';
import type { TripOverview } from '@/services/operator-service';
import { useUIStore } from '@/stores/ui-store';
import { formatDateShort, formatTime } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';
import { applyTableControls, type SortDirection } from '@/utils/table';

type SortKey = 'departureDate' | 'tripNumber' | 'status';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'departureDate', label: 'Departure' },
  { value: 'tripNumber', label: 'Trip number' },
  { value: 'status', label: 'Status' },
];

/** Statuses that can still be edited or cancelled. */
const OPEN_STATUSES: string[] = [TripStatus.SCHEDULED, TripStatus.BOARDING];

function message(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

export default function OperatorTripsScreen() {
  const { profile } = useAuth();
  const trips = useOperatorTrips();
  const routes = useOperatorRoutes();
  const buses = useBuses();
  const drivers = useCrew(CrewKind.DRIVER);
  const assistants = useCrew(CrewKind.CREW);
  const turnaround = useTurnaroundMinutes();
  const showToast = useUIStore((state) => state.showToast);

  const createTrip = useCreateTrip();
  const updateTrip = useUpdateTrip();
  const cancelTrip = useCancelTrip();
  const setTripActive = useSetTripActive();
  const assignCrew = useAssignCrew();
  const unassignCrew = useUnassignCrew();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('departureDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TripOverview | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [crewFor, setCrewFor] = useState<TripOverview | null>(null);
  const [crewDraft, setCrewDraft] = useState<{ driverId: string | null; assistantId: string | null }>({
    driverId: null,
    assistantId: null,
  });
  const [crewError, setCrewError] = useState<string | null>(null);

  const [cancelling, setCancelling] = useState<TripOverview | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [withdrawing, setWithdrawing] = useState<TripOverview | null>(null);

  const listed = useMemo(
    () =>
      applyTableControls(trips.data ?? [], {
        query,
        searchFields: ['tripNumber', 'originCode', 'destinationCode', 'busNumber', 'driverName'],
        filters: { status: filter },
        sortKey,
        sortDirection,
        page,
        pageSize: 20,
      }),
    [trips.data, query, filter, sortKey, sortDirection, page],
  );

  const routeOptions: TripFormOption[] = (routes.data ?? []).map((route) => ({
    id: route.id,
    label: `${route.originCode} → ${route.destinationCode}`,
    description: `${route.originName} to ${route.destinationName}`,
    status: route.status,
  }));

  const busOptions: TripFormOption[] = (buses.data ?? []).map((bus) => ({
    id: bus.id,
    label: `${bus.busNumber} · ${bus.capacity} seats`,
    description: bus.plateNumber,
    status: bus.status,
  }));

  /**
   * Crew who can actually take a trip: an active account (or no account at
   * all — records-only crew are still on the roster) and available for work.
   * Everybody else is left out rather than offered and refused.
   */
  const rosterable = (kind: CrewKind) =>
    ((kind === CrewKind.DRIVER ? drivers.data : assistants.data) ?? [])
      .filter(
        (member) =>
          member.availabilityStatus === AvailabilityStatus.AVAILABLE &&
          (member.accountStatus === null || member.accountStatus === 'ACTIVE'),
      )
      .map((member) => ({
        value: member.id,
        label: member.name,
        description:
          kind === CrewKind.DRIVER && member.licenseNumber
            ? `Licence ${member.licenseNumber}`
            : undefined,
      }));

  function openCreate() {
    setEditing(null);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(trip: TripOverview) {
    setEditing(trip);
    setFormError(null);
    setFormOpen(true);
  }

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
          operatorId: profile?.operatorId ?? undefined,
        });
      }
      setFormOpen(false);
      showToast({ tone: 'success', title: editing ? 'Departure updated' : 'Departure scheduled' });
    } catch (error) {
      setFormError(message(error, 'Check the details and try again.'));
    }
  }

  async function onAssign() {
    if (!crewFor) return;
    setCrewError(null);
    try {
      if (!crewDraft.driverId && !crewDraft.assistantId) {
        await unassignCrew.mutateAsync(crewFor.id);
      } else {
        await assignCrew.mutateAsync({
          tripId: crewFor.id,
          driverId: crewDraft.driverId,
          assistantId: crewDraft.assistantId,
        });
      }
      setCrewFor(null);
      showToast({ tone: 'success', title: 'Crew updated' });
    } catch (error) {
      setCrewError(message(error, 'Check the crew are available and try again.'));
    }
  }

  async function onCancel() {
    if (!cancelling) return;
    try {
      const result = await cancelTrip.mutateAsync({
        tripId: cancelling.id,
        reason: cancelReason,
      });
      setCancelling(null);
      setCancelReason('');
      showToast({
        tone: 'success',
        title: `${cancelling.tripNumber} cancelled`,
        message:
          result.bookingsCancelled > 0
            ? `${result.bookingsCancelled} booking${result.bookingsCancelled === 1 ? '' : 's'} cancelled and the passengers told. Refunds are separate.`
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

  async function onWithdraw(trip: TripOverview, active: boolean) {
    try {
      await setTripActive.mutateAsync({ tripId: trip.id, active });
      showToast({
        tone: 'success',
        title: active ? `${trip.tripNumber} is on sale again` : `${trip.tripNumber} withdrawn`,
      });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: active ? 'Could not put it back on sale' : 'Could not withdraw it',
        message: message(
          error,
          'A departure with seats already sold has to be cancelled, not withdrawn.',
        ),
      });
    }
  }

  return (
    <Screen padded={false} maxWidth={AdminContentMaxWidth} edges={['left', 'right']}>
      <View className="px-4">
        <Header
          title="Schedule"
          subtitle="Departures, coaches and crew"
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
        searchPlaceholder="Search by trip number, route, coach or driver"
        filters={[
          { value: TripStatus.SCHEDULED, label: 'Scheduled' },
          { value: TripStatus.BOARDING, label: 'Boarding' },
          { value: TripStatus.ON_TRIP, label: 'Under way' },
          { value: TripStatus.COMPLETED, label: 'Completed' },
          { value: TripStatus.CANCELLED, label: 'Cancelled' },
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
            label="Schedule a departure"
            size="sm"
            fullWidth={false}
            icon={<Plus size={16} color={Colors.textInverse} />}
            onPress={openCreate}
          />
        }
      />

      {trips.isPending ? (
        <Loading label="Loading the schedule…" />
      ) : trips.isError ? (
        <ErrorState message="Could not load the schedule." onRetry={() => void trips.refetch()} />
      ) : (
        <DataTable
          data={listed.rows}
          keyExtractor={(row) => row.id}
          minWidth={1000}
          empty={
            <EmptyState
              title={query || filter ? 'Nothing matches' : 'No departures scheduled'}
              message={
                query || filter
                  ? 'Try a different search or filter.'
                  : 'Schedule your first departure to start selling seats.'
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
                    <Text variant="bodyStrong">{row.originCode}</Text>
                    <ArrowRight size={12} color={Colors.textMuted} />
                    <Text variant="bodyStrong">{row.destinationCode}</Text>
                  </View>
                  <Text variant="caption" tone="muted">
                    {row.tripNumber} · {formatDateShort(row.departureDate)}{' '}
                    {formatTime(row.departureTime)}–{formatTime(row.arrivalTime)}
                  </Text>
                </View>
              ),
            },
            {
              key: 'bus',
              header: 'Coach',
              flex: 1,
              cell: (row) => (
                <View className="gap-0.5">
                  <Text variant="caption">{row.busNumber}</Text>
                  <Text variant="caption" tone="muted" className="text-[10px]">
                    {row.seatsBooked}/{row.capacity} sold · {formatMoney(row.fare)}
                  </Text>
                </View>
              ),
            },
            {
              key: 'crew',
              header: 'Crew',
              flex: 1.4,
              cell: (row) => (
                <View className="gap-0.5">
                  <Text variant="caption" tone={row.driverName ? 'default' : 'danger'}>
                    {row.driverName ?? 'No driver'}
                  </Text>
                  <Text variant="caption" tone="muted" className="text-[10px]">
                    {row.assistantName ?? 'No conductor'}
                  </Text>
                </View>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: 120,
              cell: (row) => (
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
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              width: 320,
              align: 'right',
              cell: (row) => (
                <View className="flex-row flex-wrap items-center justify-end gap-2">
                  <Button
                    label="Manifest"
                    size="sm"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() =>
                      router.push({
                        pathname: '/(operator)/manifest',
                        params: { tripId: row.id },
                      })
                    }
                  />

                  {OPEN_STATUSES.includes(row.status) ? (
                    <>
                      <Button
                        label="Crew"
                        size="sm"
                        variant="outline"
                        fullWidth={false}
                        onPress={() => {
                          setCrewDraft({
                            driverId: row.driverId,
                            assistantId: row.assistantId,
                          });
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
                          onPress={() => openEdit(row)}
                        />
                      ) : null}
                      {/* Withdrawing is only honest while nobody holds a seat;
                          the server refuses it otherwise, and the button is
                          hidden rather than offered and refused. */}
                      {row.status === TripStatus.SCHEDULED && row.passengerCount === 0 ? (
                        <Button
                          label="Withdraw"
                          size="sm"
                          variant="ghost"
                          fullWidth={false}
                          onPress={() => setWithdrawing(row)}
                        />
                      ) : null}
                      <Button
                        label="Cancel trip"
                        size="sm"
                        variant="danger"
                        fullWidth={false}
                        onPress={() => {
                          setCancelReason('');
                          setCancelling(row);
                        }}
                      />
                    </>
                  ) : (
                    <Text variant="caption" tone="muted">
                      {row.status === TripStatus.CANCELLED ? 'Cancelled' : 'Closed'}
                    </Text>
                  )}
                </View>
              ),
            },
          ]}
        />
      )}

      {formOpen ? (
        <TripForm
        title={editing ? `Edit ${editing.tripNumber}` : 'Schedule a departure'}
        initial={
          editing
            ? {
                routeId: (routes.data ?? []).find(
                  (r) =>
                    r.originCode === editing.originCode &&
                    r.destinationCode === editing.destinationCode,
                )?.id,
                busId: (buses.data ?? []).find((b) => b.busNumber === editing.busNumber)?.id,
                tripNumber: editing.tripNumber,
                departureDate: editing.departureDate,
                departureTime: editing.departureTime.slice(0, 5),
                arrivalTime: editing.arrivalTime.slice(0, 5),
                fare: String(editing.fare / 100),
              }
            : undefined
        }
        routes={routeOptions}
        buses={busOptions.filter(
          (bus) => bus.status === OperatorStatus.ACTIVE || bus.id === editing?.id,
        )}
        submitting={createTrip.isPending || updateTrip.isPending}
        error={formError}
        turnaroundMinutes={turnaround.data}
        onSubmit={(values) => void onSubmit(values)}
        onClose={() => setFormOpen(false)}
        />
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Crew                                                             */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        visible={crewFor !== null}
        onClose={() => setCrewFor(null)}
        title={`Crew for ${crewFor?.tripNumber ?? ''}`}>
        <View className="gap-4 pt-2">
          {crewError ? (
            <Text variant="body" tone="danger">
              {crewError}
            </Text>
          ) : null}

          <Text variant="caption" tone="muted">
            Only crew who are available and whose account is active are listed. Somebody on a rest
            day keeps their access and simply is not offered here.
          </Text>

          <Select
            label="Driver"
            placeholder="Nobody"
            value={crewDraft.driverId}
            options={rosterable(CrewKind.DRIVER)}
            onChange={(driverId) => setCrewDraft((d) => ({ ...d, driverId }))}
          />

          <Select
            label="Conductor"
            placeholder="Nobody"
            value={crewDraft.assistantId}
            options={rosterable(CrewKind.CREW)}
            onChange={(assistantId) => setCrewDraft((d) => ({ ...d, assistantId }))}
          />

          <Button
            label="Save crew"
            loading={assignCrew.isPending || unassignCrew.isPending}
            onPress={() => void onAssign()}
          />
          <Button
            label="Take everyone off"
            variant="outline"
            loading={unassignCrew.isPending}
            onPress={() => {
              setCrewDraft({ driverId: null, assistantId: null });
              void onAssign();
            }}
          />
          <Button label="Cancel" variant="ghost" onPress={() => setCrewFor(null)} />
        </View>
      </Modal>

      {/* ---------------------------------------------------------------- */}
      {/* Cancel                                                           */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        visible={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={`Cancel ${cancelling?.tripNumber ?? ''}?`}
        dismissOnBackdropPress={false}>
        <View className="gap-4 pt-2">
          <Text variant="body" tone="muted">
            {cancelling && cancelling.passengerCount > 0
              ? `${cancelling.passengerCount} passenger${cancelling.passengerCount === 1 ? '' : 's'} ${cancelling.passengerCount === 1 ? 'is' : 'are'} booked on this departure. Their bookings will be cancelled and they will be told.`
              : 'Nobody is booked on this departure.'}
          </Text>

          <Input
            label="Reason (optional)"
            placeholder="Engine trouble, weather, too few passengers…"
            value={cancelReason}
            onChangeText={setCancelReason}
          />

          <Text variant="caption" tone="muted">
            Nothing is deleted, and refunds are not automatic — the money moved through the payment
            functions and goes back the same way, as a separate decision.
          </Text>

          <Button
            label="Cancel this departure"
            variant="danger"
            loading={cancelTrip.isPending}
            onPress={() => void onCancel()}
          />
          <Button label="Keep it" variant="ghost" onPress={() => setCancelling(null)} />
        </View>
      </Modal>

      <ConfirmDialog
        visible={withdrawing !== null}
        title="Withdraw this departure from sale?"
        message={`${withdrawing?.tripNumber ?? ''} will stop appearing in passenger search. It is not cancelled — nobody is told, because nobody has booked it.`}
        consequence="Its coach and crew are released, so they can be scheduled elsewhere. Putting it back on sale needs both to be free again, and the crew to be rostered afresh."
        confirmLabel="Withdraw from sale"
        destructive
        loading={setTripActive.isPending}
        onConfirm={() => {
          if (withdrawing) void onWithdraw(withdrawing, false);
          setWithdrawing(null);
        }}
        onCancel={() => setWithdrawing(null)}
      />
    </Screen>
  );
}
