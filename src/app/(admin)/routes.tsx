import { ArrowRight, Plus } from 'lucide-react-native';
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
import { AdminContentMaxWidth, Colors } from '@/constants/theme';
import { useAdminOperators, useAdminRoutes, useAdminTerminals, useCreateRoute } from '@/hooks/use-admin';
import { AppError } from '@/lib/errors';
import { useUIStore } from '@/stores/ui-store';
import type { UUID } from '@/types/models';

export default function AdminRoutesScreen() {
  const routes = useAdminRoutes();
  const operators = useAdminOperators();
  const terminals = useAdminTerminals();
  const create = useCreateRoute();
  const showToast = useUIStore((state) => state.showToast);

  const [adding, setAdding] = useState(false);
  const [operatorId, setOperatorId] = useState<UUID | null>(null);
  const [originId, setOriginId] = useState<UUID | null>(null);
  const [destinationId, setDestinationId] = useState<UUID | null>(null);
  const [duration, setDuration] = useState('');
  const [distance, setDistance] = useState('');

  function reset() {
    setAdding(false);
    setOperatorId(null);
    setOriginId(null);
    setDestinationId(null);
    setDuration('');
    setDistance('');
  }

  const durationMinutes = Number(duration.trim());
  const durationValid = Number.isInteger(durationMinutes) && durationMinutes > 0;
  // The schema refuses a route that starts and ends at the same terminal, so
  // the form does too rather than letting the insert fail.
  const sameTerminal = originId !== null && originId === destinationId;
  const canSubmit =
    operatorId !== null && originId !== null && destinationId !== null && !sameTerminal && durationValid;

  const readyToAdd = (operators.data?.length ?? 0) > 0 && (terminals.data?.length ?? 0) >= 2;

  async function onAdd() {
    if (!operatorId || !originId || !destinationId) return;
    try {
      await create.mutateAsync({
        operatorId,
        originTerminalId: originId,
        destinationTerminalId: destinationId,
        durationMinutes,
        distanceKm: distance.trim() ? Number(distance.trim()) : null,
      });
      showToast({ tone: 'success', title: 'Route added' });
      reset();
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not add route',
        message:
          error instanceof AppError
            ? error.message
            : 'That operator may already run this exact route.',
      });
    }
  }

  return (
    <Screen padded={false} maxWidth={AdminContentMaxWidth} edges={['left', 'right']}>
      <View className="px-4">
        <Header title="Routes" subtitle="Which operator runs which corridor" />
      </View>

      {routes.isPending ? (
        <Loading label="Loading routes…" />
      ) : routes.isError ? (
        <ErrorState message="Could not load routes." onRetry={() => void routes.refetch()} />
      ) : (
        <DataTable
          data={routes.data}
          keyExtractor={(route) => route.id}
          minWidth={780}
          empty={<EmptyState title="No routes" message="Add a route to make trips schedulable." />}
          footer={
            <Button
              label="Add route"
              variant="outline"
              icon={<Plus size={16} color={Colors.primary} />}
              disabled={!readyToAdd}
              onPress={() => setAdding(true)}
            />
          }
          columns={[
            {
              key: 'corridor',
              header: 'Route',
              flex: 2,
              primary: true,
              cell: (row) => (
                <View className="gap-0.5">
                  <View className="flex-row items-center gap-2">
                    <Text variant="bodyStrong">{row.originCode}</Text>
                    <ArrowRight size={14} color={Colors.textMuted} />
                    <Text variant="bodyStrong">{row.destinationCode}</Text>
                  </View>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {row.originName} to {row.destinationName}
                  </Text>
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
              key: 'duration',
              header: 'Duration',
              width: 110,
              cell: (row) => (
                <Text variant="caption" tone="muted">
                  {Math.floor(row.durationMinutes / 60)}h {row.durationMinutes % 60}m
                </Text>
              ),
            },
            {
              key: 'distance',
              header: 'Distance',
              width: 100,
              cell: (row) => (
                <Text variant="caption" tone="muted">
                  {row.distanceKm !== null ? `${row.distanceKm} km` : '—'}
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

      <Modal visible={adding} onClose={reset} title="Add a route">
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
          <Select
            label="From"
            placeholder="Origin terminal"
            value={originId}
            onChange={setOriginId}
            options={(terminals.data ?? []).map((terminal) => ({
              value: terminal.id,
              label: terminal.name,
              description: `${terminal.code} · ${terminal.city}`,
            }))}
          />
          <Select
            label="To"
            placeholder="Destination terminal"
            value={destinationId}
            onChange={setDestinationId}
            error={sameTerminal ? 'Origin and destination must differ.' : undefined}
            options={(terminals.data ?? []).map((terminal) => ({
              value: terminal.id,
              label: terminal.name,
              description: `${terminal.code} · ${terminal.city}`,
            }))}
          />
          <Input
            label="Duration (minutes)"
            placeholder="300"
            value={duration}
            onChangeText={setDuration}
            keyboardType="number-pad"
            error={
              duration.length > 0 && !durationValid ? 'Whole minutes, greater than zero.' : undefined
            }
          />
          <Input
            label="Distance in km (optional)"
            placeholder="238"
            value={distance}
            onChangeText={setDistance}
            keyboardType="numbers-and-punctuation"
          />

          <Text variant="caption" tone="muted">
            A route is the corridor, not a departure. Scheduling trips on it is done from the
            operator console.
          </Text>

          <Button
            label="Add route"
            disabled={!canSubmit}
            loading={create.isPending}
            onPress={() => void onAdd()}
          />
          <Button label="Cancel" variant="ghost" onPress={reset} />
        </View>
      </Modal>

      {!readyToAdd && !routes.isPending ? (
        <View className="px-4 pb-4">
          <Alert
            tone="info"
            title="Operators and terminals come first"
            message="A route needs an operator and two terminals. Add those before returning here."
          />
        </View>
      ) : null}
    </Screen>
  );
}
