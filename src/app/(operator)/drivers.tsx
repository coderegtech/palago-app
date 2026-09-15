/**
 * Driver Management.
 *
 * The table, the two statuses and every action live in `CrewManagement`, which
 * this and `crew.tsx` share — a driver and a conductor differ only by whether a
 * licence is involved, and two near-copies of a screen this size drift apart.
 */

import { CrewManagement } from '@/components/common/crew-management';
import { CrewKind } from '@/constants/enums';

export default function DriversScreen() {
  return (
    <CrewManagement
      kind={CrewKind.DRIVER}
      title="Drivers"
      subtitle="Accounts, availability and licences"
      fallbackHref="/(operator)/dashboard"
    />
  );
}
