import { BoardingScanner } from '@/components/common/boarding-scanner';

/**
 * Operator console scanner. The implementation is shared with the crew app —
 * see `src/components/common/boarding-scanner.tsx`.
 */
export default function OperatorScannerScreen() {
  return <BoardingScanner subtitle="Scan a boarding pass" />;
}
