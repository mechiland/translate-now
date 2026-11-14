import type { ReactNode } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/** Single-choice segmented control (ToggleGroup) with a clearly highlighted selection. */
export function Choice<T extends string>(props: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <ToggleGroup
      variant="outline"
      aria-label={props.label}
      value={[props.value]}
      onValueChange={(v: string[]) => v[0] && props.onChange(v[0] as T)}
      className={props.className}
    >
      {props.options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="gap-2 data-pressed:border-primary data-pressed:bg-primary/10 data-pressed:text-primary"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
