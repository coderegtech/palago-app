import { Bus, Plus, Ship } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Header } from '@/components/ui/header';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { BusType, OperatorStatus } from '@/constants/enums';
import { AdminContentMaxWidth, Colors } from '@/constants/theme';
import {
  useAdminBuses,
  useAdminOperators,
  useCreateBus,
} from '@/hooks/use-admin';
import { useSetBusStatus, useUpdateBus } from '@/hooks/use-operator';
import { AppError } from '@/lib/errors';
import { useUIStore } from '@/stores/ui-store';
import type { BusRecord } from '@/services/admin-service';
import type { UUID } from '@/types/models';

export default function AdminFleetScreen() {
  const buses = useAdminBuses();
  const operators = useAdminOperators();
  const create = useCreateBus();
  const showToast = useUIStore((state) => state.showToast);

  const update = useUpdateBus();
  const setStatus = useSetBusStatus();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BusRecord | null>(null);
  const [withdrawing, setWithdrawing] = useState<BusRecord | null>(null);
  const [editDraft, setEditDraft] = useState({
    busNumber: '',
    plateNumber: '',
    name: '',
    operatorId: '' as UUID,
  });
  const [operatorId, setOperatorId] = useState<UUID | null>(null);
  const [plate, setPlate] = useState('');
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [busType, setBusType] = useState<BusType>(BusType.BUS);
  const [capacity, setCapacity] = useState('');

  async function onSaveEdit() {
    if (!editing) return;
    try {
      await update.mutateAsync({
        busId: editing.id,
        busNumber: editDraft.busNumber,
        plateNumber: editDraft.plateNumber,
        name: editDraft.name || null,
        // Only sent when it actually changes: moving a coach between companies
        // is refused while it is on anybody's schedule, and sending the same
        // value would fail that check for no reason.
        operatorId:
          editDraft.operatorId !== editing.operatorId ? editDraft.operatorId : undefined,
      });
      setEditing(null);
      showToast({ tone: 'success', title: 'Saved' });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not save',
        message:
          error instanceof AppError
            ? error.message
            : 'A coach can only change hands while it is on nobody\'s schedule.',
      });
    }
  }

  async function onStatus(bus: BusRecord, status: OperatorStatus) {
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
            ? `${result.upcomingTrips} scheduled departure${result.upcomingTrips === 1 ? '' : 's'} can no longer sell seats.`
            : undefined,
      });
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not change the status',
        message: error instanceof AppError ? error.message : 'Try again.',
      });
    }
  }

  function reset() {
    setAdding(false);
    setOperatorId(null);
    setPlate('');
    setNumber('');
    setName('');
    setBusType(BusType.BUS);
    setCapacity('');
  }

  const seats = Number(capacity.trim());
  const capacityValid = Number.isInteger(seats) && seats > 0 && seats <= 100;
  const canSubmit =
    operatorId !== null && plate.trim().length > 1 && number.trim().length > 1 && capacityValid;

  async function onAdd() {
    if (!operatorId) return;
    try {
      const result = await create.mutateAsync({
        operatorId,
        plateNumber: plate,
        busNumber: number,
        capacity: seats,
        busType,
        name,
      });
      showToast({
        tone: 'success',
        title: 'Bus added',
        message: `${result.seats} seats generated.`,
      });
      reset();
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not add bus',
        message:
          error instanceof AppError
            ? error.message
            : 'That plate or bus number may already be in use.',
      });
    }
  }

  return (
    <Screen padded={false} maxWidth={AdminContentMaxWidth} edges={['left', 'right']}>
      <View className="px-4">
        <Header title="Fleet" subtitle="Every coach across all operators" />
      </View>

      {buses.isPending ? (
        <Loading label="Loading fleet…" />
      ) : buses.isError ? (
        <ErrorState message="Could not load the fleet." onRetry={() => void buses.refetch()} />
      ) : (
        <DataTable
          data={buses.data}
          keyExtractor={(bus) => bus.id}
          minWidth={760}
          empty={<EmptyState title="No buses" message="Add a coach to an operator to get started." />}
          footer={
            <Button
              label="Add bus"
              variant="outline"
              icon={<Plus size={16} color={Colors.primary} />}
              disabled={(operators.data?.length ?? 0) === 0}
              onPress={() => setAdding(true)}
            />
          }
          columns={[
            {
              key: 'bus',
              header: 'Bus',
              flex: 2,
              primary: true,
              cell: (row) => (
                <View className="flex-row items-center gap-2">
                  {row.busType === BusType.RORO ? (
                    <Ship size={18} color={Colors.primary} />
                  ) : (
                    <Bus size={18} color={Colors.primary} />
                  )}
                  <View className="shrink">
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {row.busNumber}
                      {row.name ? ` · ${row.name}` : ''}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {row.plateNumber}
                    </Text>
                  </View>
                </View>
              ),
            },
            {
              key: 'operator',
              header: 'Operator',
              flex: 1,
              cell: (row) => (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {row.operatorName}
                </Text>
              ),
            },
            {
              key: 'type',
              header: 'Type',
              width: 90,
              cell: (row) => (
                <Text variant="caption" tone="muted">
                  {row.busType === BusType.RORO ? 'RoRo' : 'Bus'}
                </Text>
              ),
            },
            {
              key: 'capacity',
              header: 'Seats',
              width: 80,
              cell: (row) => (
                <Text variant="caption" tone="muted">
                  {row.capacity}
                </Text>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: 110,
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
              width: 230,
              align: 'right',
              cell: (row) => (
                <View className="flex-row flex-wrap items-center justify-end gap-2">
                  <Button
                    label="Edit"
                    size="sm"
                    variant="outline"
                    fullWidth={false}
                    onPress={() => {
                      setEditDraft({
                        busNumber: row.busNumber,
                        plateNumber: row.plateNumber,
                        name: row.name ?? '',
                        operatorId: row.operatorId,
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

      <Modal
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.busNumber ?? ''}`}>
        <View className="gap-4 pt-2">
          <Input
            label="Bus number"
            value={editDraft.busNumber}
            onChangeText={(busNumber) => setEditDraft((d) => ({ ...d, busNumber }))}
            autoCapitalize="characters"
          />
          <Input
            label="Plate number"
            value={editDraft.plateNumber}
            onChangeText={(plateNumber) => setEditDraft((d) => ({ ...d, plateNumber }))}
            autoCapitalize="characters"
          />
          <Input
            label="Name"
            value={editDraft.name}
            onChangeText={(name) => setEditDraft((d) => ({ ...d, name }))}
          />
          <Select
            label="Operator"
            value={editDraft.operatorId}
            onChange={(value) => setEditDraft((d) => ({ ...d, operatorId: value }))}
            options={(operators.data ?? []).map((operator) => ({
              value: operator.id,
              label: operator.name,
            }))}
          />
          <Text variant="caption" tone="muted">
            A coach can only change hands while it is on nobody&apos;s schedule — otherwise its
            trips would point at another company&apos;s bus. Capacity is fixed: the seat map was
            built from it.
          </Text>
          <Button
            label="Save"
            disabled={
              editDraft.busNumber.trim().length === 0 || editDraft.plateNumber.trim().length === 0
            }
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
        consequence="Nothing is deleted, and its scheduled trips are not cancelled — those are decided one by one, because passengers are already on them."
        confirmLabel="Take off the road"
        destructive
        loading={setStatus.isPending}
        onConfirm={() => withdrawing && void onStatus(withdrawing, OperatorStatus.INACTIVE)}
        onCancel={() => setWithdrawing(null)}
      />

      <Modal visible={adding} onClose={reset} title="Add a bus">
        <View className="gap-4 pt-2">
          <Select
            label="Operator"
            placeholder="Choose an operator"
            value={operatorId}
            onChange={setOperatorId}
            options={(operators.data ?? []).map((operator) => ({
              value: operator.id,
              label: operator.name,
              description: operator.code,
            }))}
          />
          <Input
            label="Plate number"
            placeholder="PLW 1001"
            value={plate}
            onChangeText={setPlate}
            autoCapitalize="characters"
          />
          <Input
            label="Bus number"
            placeholder="CB-001"
            hint="Unique within the operator."
            value={number}
            onChangeText={setNumber}
            autoCapitalize="characters"
          />
          <Input
            label="Name (optional)"
            placeholder="Cherry Bus 001"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <Select
            label="Type"
            value={busType}
            onChange={setBusType}
            options={[
              { value: BusType.BUS, label: 'Bus', description: 'Road coach' },
              { value: BusType.RORO, label: 'RoRo', description: 'Roll-on/roll-off service' },
            ]}
          />
          <Input
            label="Capacity"
            placeholder="44"
            value={capacity}
            onChangeText={setCapacity}
            keyboardType="number-pad"
            error={
              capacity.length > 0 && !capacityValid ? 'Between 1 and 100 seats.' : undefined
            }
          />

          <Alert
            tone="info"
            title="Seats are generated for you"
            message="A 2+2 layout is created from the capacity in the same step, so the seat map and the seat count can never disagree."
          />

          <Button
            label="Add bus"
            disabled={!canSubmit}
            loading={create.isPending}
            onPress={() => void onAdd()}
          />
          <Button label="Cancel" variant="ghost" onPress={reset} />
        </View>
      </Modal>
    </Screen>
  );
}
