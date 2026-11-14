import type { TFunction } from '@/lib/i18n';
import type { Settings } from '@/lib/settings/schema';
import type { UpdateSettings } from '@/hooks/use-settings';

export interface SectionProps {
  settings: Settings;
  update: UpdateSettings;
  t: TFunction;
}
