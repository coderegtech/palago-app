import { useState } from 'react';

import { type BoardingDoor, doorFromTrip } from '@/components/common/boarding-door';
import { BoardingScanner } from '@/components/common/boarding-scanner';
import { BoardingTripPicker } from '@/components/common/boarding-trip-picker';
import { useOperatorTrips } from '@/hooks/use-operator';
import { todayISO } from '@/utils/datetime';

/**
 * Operator console scanner.
 *
 * Opens on today's trips rather than on the camera: a ticket is only ever
 * judged against the bus being boarded, so the operator says which bus first.
 * The scanner itself is shared with the crew app —
 * see `src/components/common/boarding-scanner.tsx`.
 */
export default function OperatorScannerScreen() {
  const [door, setDoor] = useState<BoardingDoor | null>(null);
  const trips = useOperatorTrips(todayISO());

  if (door) {
    return (
      <BoardingScanner
        door={door}
        onChangeTrip={() => {
          setDoor(null);
          void trips.refetch();
        }}
      />
    );
  }

  return (
    <BoardingTripPicker
      doors={trips.data?.map(doorFromTrip)}
      isPending={trips.isPending}
      isError={trips.isError}
      onRetry={() => void trips.refetch()}
      onChoose={setDoor}
      canOpenBoarding
      subtitle="Today's trips — choose the bus you are boarding"
    />
  );
}
