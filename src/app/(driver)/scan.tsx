import { useState } from 'react';

import {
  type BoardingDoor,
  doorFromAssignment,
  isBoardable,
} from '@/components/common/boarding-door';
import { BoardingScanner } from '@/components/common/boarding-scanner';
import { BoardingTripPicker } from '@/components/common/boarding-trip-picker';
import { UserRole } from '@/constants/enums';
import { useAuth } from '@/hooks/use-auth';
import { useMyAssignments } from '@/hooks/use-tracking';

/**
 * Crew scanner. Identical checks to the operator console's — a driver at the
 * door and a dispatcher at the terminal must not be able to reach different
 * verdicts on the same ticket, so both render the same component.
 *
 * Crew only see trips they crew; the server refuses the rest anyway. When
 * exactly one of them is boarding, that is the bus they are standing at, so the
 * scanner opens on it directly.
 */
export default function DriverScanScreen() {
  const { role } = useAuth();
  const assignments = useMyAssignments();
  const [chosen, setChosen] = useState<BoardingDoor | null>(null);
  // Set once the driver asks for the list, so the auto-pick below does not
  // immediately put them back on the trip they were trying to leave.
  const [picking, setPicking] = useState(false);

  const doors = assignments.data?.map(doorFromAssignment).filter(isBoardable);
  const boardingNow = doors?.filter((d) => d.status === 'BOARDING') ?? [];
  const door = chosen ?? (!picking && boardingNow.length === 1 ? boardingNow[0] : null);

  if (door) {
    return (
      <BoardingScanner
        door={door}
        onChangeTrip={
          (doors?.length ?? 0) > 1
            ? () => {
                setChosen(null);
                setPicking(true);
                void assignments.refetch();
              }
            : undefined
        }
      />
    );
  }

  return (
    <BoardingTripPicker
      doors={doors}
      isPending={assignments.isPending}
      isError={assignments.isError}
      onRetry={() => void assignments.refetch()}
      onChoose={(next) => {
        setChosen(next);
        setPicking(false);
      }}
      // Drivers open boarding; assistants scan once it is open.
      canOpenBoarding={role === UserRole.DRIVER}
      subtitle="Your trips — choose the bus you are boarding"
    />
  );
}
