/**
 * The controls above a management table: search, filter chips, sort, and the
 * page footer beneath it.
 *
 * Split from `DataTable` rather than folded into it, because the table is also
 * used for small embedded summaries on the dashboards where a search box and a
 * pager would be noise.
 */

import { Pressable, ScrollView, View } from 'react-native';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';
import type { SortDirection } from '@/utils/table';

export interface FilterChip {
  value: string;
  label: string;
}

export interface TableToolbarProps<K extends string> {
  searchValue: string;
  onSearch: (value: string) => void;
  searchPlaceholder?: string;

  /** One row of chips. `null` is the "all" chip and is always offered first. */
  filters?: FilterChip[];
  filterValue?: string | null;
  onFilter?: (value: string | null) => void;
  allLabel?: string;

  sortOptions?: SelectOption<K>[];
  sortKey?: K | null;
  onSortKey?: (value: K) => void;
  sortDirection?: SortDirection;
  onToggleSortDirection?: () => void;

  /** Rendered at the end of the row — usually the "Add…" button. */
  action?: React.ReactNode;
}

export function TableToolbar<K extends string>({
  searchValue,
  onSearch,
  searchPlaceholder = 'Search…',
  filters,
  filterValue = null,
  onFilter,
  allLabel = 'All',
  sortOptions,
  sortKey = null,
  onSortKey,
  sortDirection = 'asc',
  onToggleSortDirection,
  action,
}: TableToolbarProps<K>) {
  const isDesktop = useIsDesktop();

  const sortControls =
    sortOptions && sortOptions.length > 0 ? (
      <View className={cn('flex-row items-end gap-2', isDesktop ? 'w-[190px]' : 'flex-1')}>
        <Select
          className="flex-1"
          placeholder="Sort by"
          value={sortKey}
          options={sortOptions}
          onChange={(value) => onSortKey?.(value)}
        />
        <IconButton
          accessibilityLabel={
            sortDirection === 'asc'
              ? 'Sorted ascending, switch to descending'
              : 'Sorted descending, switch to ascending'
          }
          variant="soft"
          onPress={() => onToggleSortDirection?.()}>
          {/* The direction is spelled out, not an arrow glyph: an arrow alone
              does not say which way "up" sorts a status column. */}
          <Text variant="caption" tone="primary" className="font-semibold">
            {sortDirection === 'asc' ? 'A→Z' : 'Z→A'}
          </Text>
        </IconButton>
      </View>
    ) : null;

  return (
    <View className="gap-3 px-4 pb-3">
      {/*
        Three controls in one row fits a console and not a phone: at 360px the
        search box is squeezed to a few characters and the action button is
        pushed off the edge. Below `md` they stack — search over sort and
        action — which is also the order somebody uses them in.
      */}
      {isDesktop ? (
        <View className="flex-row items-end gap-3">
          <Input
            containerClassName="flex-1"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChangeText={onSearch}
            autoCapitalize="none"
            autoCorrect={false}
            leading={<Search size={16} color={Colors.textMuted} />}
          />
          {sortControls}
          {action}
        </View>
      ) : (
        <View className="gap-3">
          <Input
            placeholder={searchPlaceholder}
            value={searchValue}
            onChangeText={onSearch}
            autoCapitalize="none"
            autoCorrect={false}
            leading={<Search size={16} color={Colors.textMuted} />}
          />
          <View className="flex-row items-end gap-3">
            {sortControls}
            {action}
          </View>
        </View>
      )}

      {filters && filters.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            {[{ value: '', label: allLabel }, ...filters].map((chip) => {
              const chipValue = chip.value === '' ? null : chip.value;
              const selected = filterValue === chipValue;
              return (
                <Pressable
                  key={chip.label}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter: ${chip.label}`}
                  accessibilityState={{ selected }}
                  onPress={() => onFilter?.(chipValue)}
                  className={cn(
                    'min-h-11 justify-center rounded-full border px-4',
                    selected
                      ? 'border-primary bg-primary-soft'
                      : 'border-border bg-surface active:bg-background-tint',
                  )}>
                  {/* Selected is carried by the border and the label weight as
                      well as the fill, so it does not rely on colour alone. */}
                  <Text
                    variant="caption"
                    className={cn(selected ? 'font-semibold text-primary' : 'text-content-muted')}>
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

export interface TablePaginationProps {
  page: number;
  pageCount: number;
  total: number;
  /** What the rows are, for the count line: "24 buses". */
  noun: string;
  onPage: (page: number) => void;
}

export function TablePagination({ page, pageCount, total, noun, onPage }: TablePaginationProps) {
  return (
    <View className="flex-row items-center gap-3">
      <Text variant="caption" tone="muted">
        {total} {noun}
        {pageCount > 1 ? ` · page ${page} of ${pageCount}` : ''}
      </Text>

      {pageCount > 1 ? (
        <View className="flex-row items-center gap-2">
          <IconButton
            accessibilityLabel="Previous page"
            variant="soft"
            disabled={page <= 1}
            onPress={() => onPage(page - 1)}>
            <ChevronLeft size={18} color={page <= 1 ? Colors.textMuted : Colors.primary} />
          </IconButton>
          <IconButton
            accessibilityLabel="Next page"
            variant="soft"
            disabled={page >= pageCount}
            onPress={() => onPage(page + 1)}>
            <ChevronRight size={18} color={page >= pageCount ? Colors.textMuted : Colors.primary} />
          </IconButton>
        </View>
      ) : null}
    </View>
  );
}
