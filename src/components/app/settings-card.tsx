import type { ReactNode } from 'react';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';

/** A titled group of settings fields. */
export function SettingsCard(props: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      {(props.title || props.description) && (
        <CardHeader>
          {props.title && <CardTitle>{props.title}</CardTitle>}
          {props.description && <CardDescription>{props.description}</CardDescription>}
          {props.action && <CardAction>{props.action}</CardAction>}
        </CardHeader>
      )}
      <CardContent>
        <FieldGroup>{props.children}</FieldGroup>
      </CardContent>
    </Card>
  );
}
