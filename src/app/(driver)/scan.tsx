import { BoardingScanner } from '@/components/common/boarding-scanner';

/**
 * Crew scanner. Identical checks to the operator console's — a driver at the
 * door and a dispatcher at the terminal must not be able to reach different
 * verdicts on the same ticket, so both render the same component.
 */
export default function DriverScanScreen() {
  return <BoardingScanner subtitle="Scan at the door" />;
}
