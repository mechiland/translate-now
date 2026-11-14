import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface SelectOption {
  value: string;
  label: string;
}

/** A shadcn Select fed from a flat option list. */
export function SimpleSelect(props: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  id?: string;
  label?: string;
  size?: 'sm' | 'default';
  className?: string;
}) {
  return (
    <Select
      value={props.value}
      items={props.options}
      onValueChange={(v) => {
        if (typeof v === 'string') props.onChange(v);
      }}
    >
      <SelectTrigger
        id={props.id}
        aria-label={props.label}
        size={props.size}
        className={props.className}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end">
        {props.options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
