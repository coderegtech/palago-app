import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Header } from '@/components/ui/header';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { AdminContentMaxWidth, Colors } from '@/constants/theme';
import { useAdminOperators, useCreateOperator } from '@/hooks/use-admin';
import { AppError } from '@/lib/errors';
import { useUIStore } from '@/stores/ui-store';

export default function AdminOperatorsScreen() {
  const operators = useAdminOperators();
  const create = useCreateOperator();
  const showToast = useUIStore((state) => state.showToast);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  function reset() {
    setAdding(false);
    setName('');
    setCode('');
    setPhone('');
    setEmail('');
  }

  const canSubmit = name.trim().length > 1 && code.trim().length > 1;

  async function onAdd() {
    try {
      await create.mutateAsync({
        name,
        code,
        contactPhone: phone,
        contactEmail: email,
      });
      showToast({ tone: 'success', title: 'Operator added' });
      reset();
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not add operator',
        message:
          error instanceof AppError
            ? error.message
            : 'Check the code is not already taken and try again.',
      });
    }
  }

  return (
    <Screen padded={false} maxWidth={AdminContentMaxWidth} edges={['left', 'right']}>
      <View className="px-4">
        <Header title="Operators" subtitle="Bus companies on PalaGo" />
      </View>

      {operators.isPending ? (
        <Loading label="Loading operators…" />
      ) : operators.isError ? (
        <ErrorState
          message="Could not load operators."
          onRetry={() => void operators.refetch()}
        />
      ) : (
        <DataTable
          data={operators.data}
          keyExtractor={(operator) => operator.id}
          minWidth={640}
          empty={
            <EmptyState
              title="No operators"
              message="Add the first bus company to get started."
            />
          }
          footer={
            <Button
              label="Add operator"
              variant="outline"
              icon={<Plus size={16} color={Colors.primary} />}
              onPress={() => setAdding(true)}
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Company',
              flex: 2,
              primary: true,
              cell: (row) => <Text variant="bodyStrong">{row.name}</Text>,
            },
            {
              key: 'code',
              header: 'Code',
              width: 110,
              cell: (row) => (
                <Text variant="caption" tone="muted">
                  {row.code}
                </Text>
              ),
            },
            {
              key: 'contact',
              header: 'Contact',
              flex: 2,
              cell: (row) => (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {[row.contactPhone, row.contactEmail].filter(Boolean).join(' · ') || '—'}
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

      <Modal visible={adding} onClose={reset} title="Add an operator">
        <View className="gap-4 pt-2">
          <Input
            label="Company name"
            placeholder="Cherry Bus"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <Input
            label="Code"
            placeholder="CHERRY"
            hint="Short unique identifier. Used to link routes, buses and staff accounts."
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
          />
          <Input
            label="Contact number (optional)"
            placeholder="0917 123 4567"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <Input
            label="Contact email (optional)"
            placeholder="support@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text variant="caption" tone="muted">
            Creating the company does not create a staff login for it. Linking an account so someone
            can sign in to this operator&apos;s console is a separate step.
          </Text>

          <Button
            label="Add operator"
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
