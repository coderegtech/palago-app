/**
 * The trip a scanner is boarding — "the door".
 *
 * Every scan is judged against one specific trip: the server refuses a ticket
 * for another bus, day or route, and boards nothing before that trip opens
 * boarding. So a scanner is never opened on its own; it is opened *for* a
 * door, and the door is shown on screen the whole time so the operator can
 * see which bus they are letting people onto.
 *
 * Operators pick from their trips today; crew from their own assignments.
 * Both map onto this one shape.
 */

import type { TripStatus } from '@/constants/enums';
import type { TripOverview } from '@/services/operator-service';
import type { DriverAssignment } from '@/services/tracking-service';
import type { ISODate, ISOTime, UUID } from '@/types/models';
import { formatTime } from '@/utils/datetime';

export interface BoardingDoor {
  tripId: UUID;
  tripNumber: string;
  status: TripStatus;
  departureDate: ISODate;
  departureTime: ISOTime;
  originCode: string;
  destinationCode: string;
  busNumber: string;
  passengerCount: number;
  boardedCount: number;
}

export function doorFromTrip(trip: TripOverview): BoardingDoor {
  return {
    tripId: trip.id,
    tripNumber: trip.tripNumber,
    status: trip.status,
    departureDate: trip.departureDate,
    departureTime: trip.departureTime,
    originCode: trip.originCode,
    destinationCode: trip.destinationCode,
    busNumber: trip.busNumber,
    passengerCount: trip.passengerCount,
    boardedCount: trip.boardedCount,
  };
}

export function doorFromAssignment(assignment: DriverAssignment): BoardingDoor {
  return {
    tripId: assignment.tripId,
    tripNumber: assignment.tripNumber,
    status: assignment.tripStatus,
    departureDate: assignment.departureDate,
    departureTime: assignment.departureTime,
    originCode: assignment.originCode,
    destinationCode: assignment.destinationCode,
    busNumber: assignment.busNumber,
    passengerCount: assignment.passengerCount,
    boardedCount: assignment.boardedCount,
  };
}

/** Only these can take passengers now or soon. Departed trips are done boarding. */
export function isBoardable(door: BoardingDoor): boolean {
  return door.status === 'SCHEDULED' || door.status === 'BOARDING';
}

/**
 * What to send as `passengerIds` when boarding.
 *
 * When every passenger still waiting is ticked, send nothing: the server then
 * boards "everyone not yet on", which also absorbs a passenger boarded at
 * another door since this ticket was checked. Naming them instead would
 * include someone already aboard. Ticks for passengers not waiting are ignored.
 */
export function idsToBoard(waiting: readonly UUID[], ticked: ReadonlySet<UUID>): UUID[] | undefined {
  const chosen = waiting.filter((id) => ticked.has(id));
  return chosen.length === waiting.length ? undefined : chosen;
}

/** "PPS → ELN · 06:00 · Bus 12" — what the operator reads to confirm the bus. */
export function doorLabel(door: Pick<BoardingDoor, 'originCode' | 'destinationCode' | 'departureTime' | 'busNumber'>): string {
  return `${door.originCode} → ${door.destinationCode} · ${formatTime(door.departureTime)} · Bus ${door.busNumber}`;
}
