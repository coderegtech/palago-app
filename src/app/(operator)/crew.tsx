/**
 * Crew / Assistant Management.
 *
 * Split from Drivers because the brief asks for them separately, and because
 * the two rosters are managed by different people at different times — but
 * both render `CrewManagement`, so the two statuses can never drift apart
 * between the screens.
 */

import { CrewManagement } from '@/components/common/crew-management';
import { CrewKind } from '@/constants/enums';

export default function CrewScreen() {
  return (
    <CrewManagement
      kind={CrewKind.ASSISTANT}
      title="Crew"
      subtitle="Conductors and assistants"
      fallbackHref="/(operator)/dashboard"
    />
  );
}
