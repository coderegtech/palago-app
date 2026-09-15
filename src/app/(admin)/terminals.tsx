import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Header } from '@/components/ui/header';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { OperatorStatus } from '@/constants/enums';
import { AdminContentMaxWidth, Colors } from '@/constants/theme';
import {
  useAdminTerminals,
  useCreateTerminal,
  useSetTerminalStatus,
  useUpdateTerminal,
} from '@/hooks/use-admin';
import { AppError } from '@/lib/errors';
import type { TerminalRecord } from '@/services/admin-service';
import { useUIStore } from '@/stores/ui-store';

/** Accepts a decimal degree within range, else null. */
function parseCoordinate(value: string, limit: number): number | null {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) return null;
  return parsed;
}

export default function AdminTerminalsScreen() {
  const terminals = useAdminTerminals();
  const create = useCreateTerminal();
  const showToast = useUIStore((state) => state.showToast);

  const update = useUpdateTerminal();
  const setStatus = useSetTerminalStatus();

  const [editing, setEditing] = useState<TerminalRecord | null>(null);
  const [closing, setClosing] = useState<TerminalRecord | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', city: '', latitude: '', longitude: '' });

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [city, setCity] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  function reset() {
    setAdding(false);
    setName('');
    setCode('');
    setCity('');
    setLatitude('');
    setLongitude('');
  }

  const lat = parseCoordinate(latitude, 90);
  const lng = parseCoordinate(longitude, 180);
  const canSubmit =
    name.trim().length > 1 && code.trim().length > 1 && city.trim().length > 1 && lat !== null && lng !== null;

  async function onAdd() {
    if (lat === null || lng === null) return;
    try {
      await create.mutateAsync({ name, code, city, latitude: lat, longitude: lng });
      showToast({ tone: 'success', title: 'Terminal added' });
      reset();
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not add terminal',
        message:
          error instanceof AppError ? error.message : 'Check the code is not already taken.',
      });
    }
  }

  return (
    <Screen padded={false} maxWidth={AdminContentMaxWidth} edges={['left', 'right']}>
      <View className="px-4">
        <Header title="Terminals" subtitle="Stations routes depart from and arrive at" />
      </View>

      {terminals.isPending ? (
        <Loading label="Loading terminals…" />
      ) : terminals.isError ? (
        <ErrorState message="Could not load terminals." onRetry={() => void terminals.refetch()} />
      ) : (
        <DataTable
          data={terminals.data}
          keyExtractor={(terminal) => terminal.id}
          minWidth={720}
          empty={
            <EmptyState
              title="No terminals"
              message="Routes need an origin and a destination, so add these first."
            />
          }
          footer={
            <Button
              label="Add terminal"
              variant="outline"
              icon={<Plus size={16} color={Colors.primary} />}
              onPress={() => setAdding(true)}
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Terminal',
              flex: 2,
              primary: true,
              cell: (row) => <Text variant="bodyStrong">{row.name}</Text>,
            },
            {
              key: 'code',
              header: 'Code',
              width: 90,
              cell: (row) => (
                <Text variant="caption" tone="muted">
                  {row.code}
                </Text>
              ),
            },
            {
              key: 'place',
              header: 'City',
              flex: 2,
              cell: (row) => (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {row.city}, {row.province}
                </Text>
              ),
            },
            {
              key: 'coords',
              header: 'Coordinates',
              width: 150,
              cell: (row) => (
                <Text variant="caption" tone="muted">
                  {row.latitude.toFixed(4)}, {row.longitude.toFixed(4)}
                </Text>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: 100,
              cell: (row) => (
                <Badge
                  label={row.status === OperatorStatus.ACTIVE ? 'Open' : 'Closed'}
                  tone={row.status === OperatorStatus.ACTIVE ? 'success' : 'neutral'}
                />
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              width: 190,
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
                        name: row.name,
                        city: row.city,
                        latitude: String(row.latitude),
                        longitude: String(row.longitude),
                      });
                      setEditing(row);
                    }}
                  />
                  {row.status === OperatorStatus.ACTIVE ? (
                    <Button
                      label="Close"
                      size="sm"
                      variant="danger"
                      fullWidth={false}
                      onPress={() => setClosing(row)}
                    />
                  ) : (
                    <Button
                      label="Reopen"
                      size="sm"
                      variant="outline"
                      fullWidth={false}
                      loading={setStatus.isPending}
                      onPress={() =>
                        void setStatus
                          .mutateAsync({ terminalId: row.id, status: OperatorStatus.ACTIVE })
                          .then(() => showToast({ tone: 'success', title: 'Terminal reopened' }))
                          .catch((error) =>
                            showToast({
                              tone: 'danger',
                              title: 'Could not reopen it',
                              message: error instanceof AppError ? error.message : 'Try again.',
                            }),
                          )
                      }
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
        title={`Edit ${editing?.name ?? ''}`}>
        <View className="gap-4 pt-2">
          <Input
            label="Name"
            value={editDraft.name}
            onChangeText={(name) => setEditDraft((d) => ({ ...d, name }))}
            autoCapitalize="words"
          />
          <Input
            label="City"
            value={editDraft.city}
            onChangeText={(city) => setEditDraft((d) => ({ ...d, city }))}
            autoCapitalize="words"
          />
          <View className="flex-row gap-3">
            <Input
              containerClassName="min-w-0 flex-1"
              label="Latitude"
              value={editDraft.latitude}
              onChangeText={(latitude) => setEditDraft((d) => ({ ...d, latitude }))}
              keyboardType="numbers-and-punctuation"
            />
            <Input
              containerClassName="min-w-0 flex-1"
              label="Longitude"
              value={editDraft.longitude}
              onChangeText={(longitude) => setEditDraft((d) => ({ ...d, longitude }))}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <Text variant="caption" tone="muted">
            The code is not editable — routes resolve through it.
          </Text>
          <Button
            label="Save"
            disabled={editDraft.name.trim().length < 2 || editDraft.city.trim().length < 2}
            loading={update.isPending}
            onPress={() =>
              editing &&
              void update
                .mutateAsync({
                  terminalId: editing.id,
                  name: editDraft.name,
                  city: editDraft.city,
                  latitude: Number(editDraft.latitude),
                  longitude: Number(editDraft.longitude),
                })
                .then(() => {
                  setEditing(null);
                  showToast({ tone: 'success', title: 'Saved' });
                })
                .catch((error) =>
                  showToast({
                    tone: 'danger',
                    title: 'Could not save',
                    message:
                      error instanceof AppError
                        ? error.message
                        : 'Check the coordinates are a real place.',
                  }),
                )
            }
          />
          <Button label="Cancel" variant="ghost" onPress={() => setEditing(null)} />
        </View>
      </Modal>

      <ConfirmDialog
        visible={closing !== null}
        title="Close this terminal?"
        message={`${closing?.name ?? ''} will not be offered when a passenger searches, and no new route can be built through it.`}
        consequence="Nothing is deleted. Routes and trips that already use it keep working until they are retired themselves."
        confirmLabel="Close terminal"
        destructive
        loading={setStatus.isPending}
        onConfirm={() =>
          closing &&
          void setStatus
            .mutateAsync({ terminalId: closing.id, status: OperatorStatus.INACTIVE })
            .then(() => {
              setClosing(null);
              showToast({ tone: 'success', title: 'Terminal closed' });
            })
            .catch((error) =>
              showToast({
                tone: 'danger',
                title: 'Could not close it',
                message: error instanceof AppError ? error.message : 'Try again.',
              }),
            )
        }
        onCancel={() => setClosing(null)}
      />

      <Modal visible={adding} onClose={reset} title="Add a terminal">
        <View className="gap-4 pt-2">
          <Input
            label="Terminal name"
            placeholder="San Jose Terminal"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <Input
            label="Code"
            placeholder="PPS"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
          />
          <Input
            label="City"
            placeholder="Puerto Princesa"
            value={city}
            onChangeText={setCity}
            autoCapitalize="words"
          />
          <Input
            label="Latitude"
            placeholder="9.7392"
            hint="Decimal degrees. Used to place the terminal on the tracking map."
            value={latitude}
            onChangeText={setLatitude}
            keyboardType="numbers-and-punctuation"
            error={latitude.length > 0 && lat === null ? 'Must be between -90 and 90.' : undefined}
          />
          <Input
            label="Longitude"
            placeholder="118.7353"
            value={longitude}
            onChangeText={setLongitude}
            keyboardType="numbers-and-punctuation"
            error={
              longitude.length > 0 && lng === null ? 'Must be between -180 and 180.' : undefined
            }
          />

          <Button
            label="Add terminal"
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
