import type { TFunction } from '@/lib/i18n';
import type { Settings } from '@/lib/settings/schema';
import type { UpdateSettings } from '@/lib/ui/useSettings';

export interface SectionProps {
  settings: Settings;
  update: UpdateSettings;
  t: TFunction;
}
