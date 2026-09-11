import { Bus, Plus, Ship } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

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
import { BusType } from '@/constants/enums';
import { AdminContentMaxWidth, Colors } from '@/constants/theme';
import { useAdminBuses, useAdminOperators, useCreateBus } from '@/hooks/use-admin';
import { AppError } from '@/lib/errors';
import { useUIStore } from '@/stores/ui-store';
import type { UUID } from '@/types/models';

export default function AdminFleetScreen() {
  const buses = useAdminBuses();
  const operators = useAdminOperators();
  const create = useCreateBus();
  const showToast = useUIStore((state) => state.showToast);

  const [adding, setAdding] = useState(false);
  const [operatorId, setOperatorId] = useState<UUID | null>(null);
  const [plate, setPlate] = useState('');
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [busType, setBusType] = useState<BusType>(BusType.BUS);
  const [capacity, setCapacity] = useState('');

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
              width: 96,
              align: 'right',
              cell: (row) => (
                <Badge
                  label={row.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  tone={row.status === 'ACTIVE' ? 'success' : 'neutral'}
                />
              ),
            },
          ]}
        />
      )}

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
