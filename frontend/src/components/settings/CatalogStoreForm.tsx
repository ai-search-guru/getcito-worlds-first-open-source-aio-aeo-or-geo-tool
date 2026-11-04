'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { StoreConnector } from '@/lib/catalogClient';

/**
 * A store's sign-in, as its connector asks for it (00282): to connect the
 * store, or to replace its sign-in. A secret field is typed like a password
 * and never shown again; what's typed goes to the API only.
 */
export function StoreSignInForm({
  connector,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  connector: StoreConnector;
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('settings.catalog.stores');
  const [values, setValues] = useState<Record<string, string>>({});
  const complete = connector.fields.every((field) => (values[field.name] ?? '').trim());

  return (
    <form
      className="space-y-3 rounded-md border bg-muted/30 p-3"
      aria-label={t('formLabel', { store: connector.label })}
      onSubmit={(e) => {
        e.preventDefault();
        if (complete && !busy) onSubmit(values);
      }}
    >
      {connector.fields.map((field) => {
        const id = `store-${connector.kind}-${field.name}`;
        return (
          <div key={field.name} className="space-y-1">
            <Label htmlFor={id}>{field.label}</Label>
            <Input
              id={id}
              type={field.secret ? 'password' : 'text'}
              autoComplete={field.secret ? 'new-password' : 'off'}
              spellCheck={false}
              placeholder={field.placeholder ?? undefined}
              maxLength={2000}
              value={values[field.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
            />
            {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">{t('kept')}</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!complete || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
