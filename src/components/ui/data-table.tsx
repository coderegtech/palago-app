import { FlatList, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { cn } from '@/utils/cn';

export interface DataColumn<T> {
  key: string;
  header: string;
  /** Share of the leftover width. Ignored when `width` is set. */
  flex?: number;
  /** Fixed width in px, for short predictable cells like a status pill. */
  width?: number;
  align?: 'left' | 'right';
  cell: (row: T) => React.ReactNode;
  /**
   * In stacked mode this column becomes the row's title instead of a labelled
   * field. Mark the one or two columns that identify the row.
   */
  primary?: boolean;
  /**
   * Drop this column in stacked mode. For values that are useful when scanning
   * a wide table but only noise on a phone.
   */
  tableOnly?: boolean;
}

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  empty?: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * Width below which the table scrolls sideways rather than crushing columns.
   * A table squeezed past legibility is worse than one the reader can push.
   */
  minWidth?: number;
  /**
   * Render rows directly instead of in a FlatList, for a small table sitting
   * inside a page that already scrolls. A vertical list nested in a vertical
   * ScrollView breaks virtualisation and warns, so the two cases cannot share
   * one implementation.
   */
  embedded?: boolean;
}

function cellStyle<T>(column: DataColumn<T>) {
  return column.width !== undefined
    ? { width: column.width, flexGrow: 0, flexShrink: 0 }
    : { flex: column.flex ?? 1 };
}

/**
 * A table on a wide screen, a list of cards on a phone.
 *
 * React Native has no `<table>`, so the columns are flex weights that both
 * modes read from — one definition, so a header can never drift out of step
 * with the cells beneath it.
 *
 * Stacked mode is not a degraded table: columns become labelled fields, and the
 * ones marked `primary` become the row's title. A real table at 390px wide is
 * either unreadable or a sideways scroll nobody discovers.
 */
export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  empty,
  footer,
  minWidth = 720,
  embedded = false,
}: DataTableProps<T>) {
  const isDesktop = useIsDesktop();

  if (!isDesktop) {
    const primary = columns.filter((column) => column.primary);
    const rest = columns.filter((column) => !column.primary && !column.tableOnly);

    const card = (item: T) => (
      <View
        key={keyExtractor(item)}
        className="gap-2 rounded-card border border-border bg-surface p-4">
        {primary.map((column) => (
          <View key={column.key}>{column.cell(item)}</View>
        ))}
        {rest.map((column) => (
          <View key={column.key} className="flex-row items-center justify-between gap-3">
            <Text variant="caption" tone="muted">
              {column.header}
            </Text>
            <View className="shrink items-end">{column.cell(item)}</View>
          </View>
        ))}
      </View>
    );

    if (embedded) {
      return (
        <View className="gap-3">
          {data.length === 0 ? empty : data.map(card)}
          {footer}
        </View>
      );
    }

    return (
      <FlatList
        data={data}
        keyExtractor={keyExtractor}
        contentContainerClassName="px-4 pb-8 gap-3"
        ListEmptyComponent={empty ? <>{empty}</> : null}
        ListFooterComponent={footer ? <View className="mt-2">{footer}</View> : null}
        renderItem={({ item }) => card(item)}
      />
    );
  }

  const header = (
    <View className="flex-row items-center gap-3 border-b border-border bg-background-tint px-4 py-2.5">
      {columns.map((column) => (
        <View key={column.key} style={cellStyle(column)}>
          <Text
            variant="caption"
            tone="muted"
            numberOfLines={1}
            className={cn('font-semibold uppercase', column.align === 'right' && 'text-right')}>
            {column.header}
          </Text>
        </View>
      ))}
    </View>
  );

  const row = (item: T, index: number) => (
    <View
      key={keyExtractor(item)}
      className={cn('flex-row items-center gap-3 px-4 py-3', index > 0 && 'border-t border-border')}>
      {columns.map((column) => (
        <View
          key={column.key}
          style={cellStyle(column)}
          className={column.align === 'right' ? 'items-end' : undefined}>
          {column.cell(item)}
        </View>
      ))}
    </View>
  );

  return (
    // Height behaves oppositely in the two modes. A full-page table owns the
    // screen's remaining height, so the scroller takes `flex-1` and the row
    // list scrolls within it. An embedded table sits inside a column that is
    // already scrolling, where `flex-1` has no bounded height to resolve
    // against and would collapse the table to nothing — there it must size to
    // its content instead.
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className={cn(!embedded && 'flex-1')}
      contentContainerClassName={cn(!embedded && 'grow')}>
      <View style={{ minWidth }} className={cn(!embedded && 'flex-1 px-4 pb-8')}>
        <View className="overflow-hidden rounded-card border border-border bg-surface">
          {embedded ? (
            <>
              {header}
              {data.length === 0 ? <View className="p-6">{empty}</View> : data.map(row)}
            </>
          ) : (
            <FlatList
              data={data}
              keyExtractor={keyExtractor}
              ListHeaderComponent={header}
              stickyHeaderIndices={[0]}
              ListEmptyComponent={empty ? <View className="p-6">{empty}</View> : null}
              renderItem={({ item, index }) => row(item, index)}
            />
          )}
        </View>
        {footer ? <View className={cn('self-start', embedded ? 'mt-2' : 'mt-3')}>{footer}</View> : null}
      </View>
    </ScrollView>
  );
}
