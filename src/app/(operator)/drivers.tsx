import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { IdCard, Phone, Plus, UserRound } from 'lucide-react-native';

import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { StaffStatus } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import {
  useAddAssistant,
  useAddDriver,
  useAssistants,
  useDrivers,
  useSetCrewStatus,
} from '@/hooks/use-operator';
import { AppError } from '@/lib/errors';
import type { CrewMember } from '@/services/operator-service';
import { useUIStore } from '@/stores/ui-store';

const statusTone: Record<StaffStatus, BadgeTone> = {
  [StaffStatus.ACTIVE]: 'success',
  [StaffStatus.INACTIVE]: 'neutral',
  [StaffStatus.SUSPENDED]: 'danger',
};

/** The next status in the cycle a dispatcher actually uses. */
function nextStatus(current: StaffStatus): StaffStatus {
  if (current === StaffStatus.ACTIVE) return StaffStatus.INACTIVE;
  if (current === StaffStatus.INACTIVE) return StaffStatus.ACTIVE;
  return StaffStatus.ACTIVE;
}

function CrewRow({
  member,
  kind,
  onToggleStatus,
  busy,
}: {
  member: CrewMember;
  kind: 'DRIVER' | 'ASSISTANT';
  onToggleStatus: (member: CrewMember) => void;
  busy: boolean;
}) {
  return (
    <Card className="gap-3">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
          <UserRound size={18} color={Colors.primary} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text variant="bodyStrong">{member.name}</Text>
          <Text variant="caption" tone="muted">
            {kind === 'DRIVER' ? 'Driver' : 'Assistant'}
            {member.userId ? ' · has app access' : ' · no app account'}
          </Text>
        </View>
        <Badge label={member.status} tone={statusTone[member.status]} />
      </View>

      {member.licenseNumber ? (
        <View className="flex-row items-center gap-1.5">
          <IdCard size={12} color={Colors.textMuted} />
          <Text variant="caption" tone="muted">
            {member.licenseNumber}
          </Text>
        </View>
      ) : null}

      {member.phone ? (
        <View className="flex-row items-center gap-1.5">
          <Phone size={12} color={Colors.textMuted} />
          <Text variant="caption" tone="muted">
            {member.phone}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Set ${member.name} to ${nextStatus(member.status)}`}
        disabled={busy}
        onPress={() => onToggleStatus(member)}
        className="min-h-11 items-center justify-center rounded-xl border border-border active:bg-primary-soft">
        <Text variant="caption" tone="primary" className="font-semibold">
          {busy ? 'Saving…' : `Mark ${nextStatus(member.status).toLowerCase()}`}
        </Text>
      </Pressable>
    </Card>
  );
}

export default function CrewScreen() {
  const { profile } = useAuth();
  const drivers = useDrivers();
  const assistants = useAssistants();
  const setStatus = useSetCrewStatus();
  const addDriver = useAddDriver();
  const addAssistant = useAddAssistant();
  const showToast = useUIStore((state) => state.showToast);

  const [tab, setTab] = useState<'DRIVER' | 'ASSISTANT'>('DRIVER');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [licence, setLicence] = useState('');
  const [phone, setPhone] = useState('');

  const isDrivers = tab === 'DRIVER';
  const query = isDrivers ? drivers : assistants;
  const operatorId = profile?.operatorId ?? null;

  function resetForm() {
    setAdding(false);
    setName('');
    setLicence('');
    setPhone('');
  }

  function onToggleStatus(member: CrewMember) {
    setStatus.mutate(
      { kind: tab, id: member.id, status: nextStatus(member.status) },
      {
        onError: (error) =>
          showToast({
            tone: 'danger',
            title: 'Could not update',
            message: error instanceof AppError ? error.message : 'Please try again.',
          }),
      },
    );
  }

  function onAdd() {
    if (!operatorId) return;

    const onDone = () => {
      showToast({
        tone: 'success',
        title: isDrivers ? 'Driver added' : 'Assistant added',
        message: `${name} is now on your crew list.`,
      });
      resetForm();
    };
    const onFail = (error: Error) =>
      showToast({
        tone: 'danger',
        title: 'Could not add',
        message: error instanceof AppError ? error.message : 'Please try again.',
      });

    if (isDrivers) {
      addDriver.mutate(
        { name: name.trim(), licenseNumber: licence.trim(), phone: phone.trim(), operatorId },
        { onSuccess: onDone, onError: onFail },
      );
    } else {
      addAssistant.mutate(
        { name: name.trim(), phone: phone.trim(), operatorId },
        { onSuccess: onDone, onError: onFail },
      );
    }
  }

  const canSubmit = name.trim().length >= 2 && (!isDrivers || licence.trim().length > 0);
  const saving = addDriver.isPending || addAssistant.isPending;

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Crew" subtitle="Drivers and assistants" />

        <View className="mb-3 flex-row gap-2">
          {(['DRIVER', 'ASSISTANT'] as const).map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === option }}
              accessibilityLabel={option === 'DRIVER' ? 'Drivers' : 'Assistants'}
              onPress={() => setTab(option)}
              className={`min-h-11 flex-1 items-center justify-center rounded-xl border ${
                tab === option ? 'border-primary bg-primary' : 'border-border bg-surface'
              }`}>
              <Text
                variant="caption"
                tone={tab === option ? 'inverse' : 'default'}
                className="font-semibold">
                {option === 'DRIVER'
                  ? `Drivers (${drivers.data?.length ?? 0})`
                  : `Assistants (${assistants.data?.length ?? 0})`}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={query.data ?? []}
        keyExtractor={(member) => member.id}
        contentContainerClassName="px-4 pb-8 gap-3"
        refreshing={query.isFetching}
        onRefresh={() => query.refetch()}
        renderItem={({ item }) => (
          <CrewRow
            member={item}
            kind={tab}
            onToggleStatus={onToggleStatus}
            busy={setStatus.isPending && setStatus.variables?.id === item.id}
          />
        )}
        ListEmptyComponent={
          query.isPending ? (
            <Loading label="Loading crew…" className="py-12" />
          ) : query.isError ? (
            <ErrorState
              message="Could not load your crew."
              onRetry={() => query.refetch()}
              className="py-10"
            />
          ) : (
            <EmptyState
              title={isDrivers ? 'No drivers yet' : 'No assistants yet'}
              message="Add crew so they can be assigned to departures."
              className="py-12"
            />
          )
        }
        ListFooterComponent={
          <Button
            label={isDrivers ? 'Add driver' : 'Add assistant'}
            variant="outline"
            className="mt-2"
            icon={<Plus size={16} color={Colors.primary} />}
            disabled={!operatorId}
            onPress={() => setAdding(true)}
          />
        }
      />

      <Modal
        visible={adding}
        onClose={resetForm}
        title={isDrivers ? 'Add a driver' : 'Add an assistant'}>
        <View className="gap-4 pt-2">
          {!operatorId ? (
            <Alert
              tone="info"
              title="No operator linked"
              message="This account is not tied to an operator, so crew cannot be added."
            />
          ) : null}

          <Input
            label="Full name"
            placeholder="Juan Santos"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />

          {isDrivers ? (
            <Input
              label="Licence number"
              placeholder="DRV-001"
              value={licence}
              onChangeText={setLicence}
              autoCapitalize="characters"
            />
          ) : null}

          <Input
            label="Mobile number (optional)"
            placeholder="0917 123 4567"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />

          <Text variant="caption" tone="muted">
            Crew are recorded against your operator. Linking an app account so they can sign in is a
            separate step.
          </Text>

          <Button
            label={isDrivers ? 'Add driver' : 'Add assistant'}
            disabled={!canSubmit || !operatorId}
            loading={saving}
            onPress={onAdd}
          />
          <Button label="Cancel" variant="ghost" onPress={resetForm} />
        </View>
      </Modal>
    </Screen>
  );
}
