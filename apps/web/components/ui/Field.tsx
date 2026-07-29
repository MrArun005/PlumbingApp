import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const CONTROL =
  'w-full min-h-tap rounded-control border border-line-strong bg-surface px-3 py-2.5 ' +
  'text-base text-ink placeholder:text-ink-faint ' +
  'focus:border-primary focus:outline-none';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}

/** Label + control + hint + error, wired together for screen readers. */
export function FieldShell({ id, label, hint, error, optional, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
        {optional === true ? (
          <span className="ml-1.5 font-normal text-ink-faint">(optional)</span>
        ) : null}
      </label>
      {children}
      {hint !== undefined && error === undefined ? (
        <p id={`${id}-hint`} className="text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={`${id}-error`} className="text-xs font-semibold text-sos" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'>;

export function TextField({ id, label, hint, error, optional, ...rest }: TextFieldProps) {
  const describedBy =
    error !== undefined ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <input
        id={id}
        className={error === undefined ? CONTROL : `${CONTROL} border-sos`}
        aria-describedby={describedBy}
        aria-invalid={error !== undefined}
        {...rest}
      />
    </FieldShell>
  );
}

type SelectFieldProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: ReactNode;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className' | 'children'>;

export function SelectField({
  id,
  label,
  hint,
  error,
  optional,
  children,
  ...rest
}: SelectFieldProps) {
  const describedBy =
    error !== undefined ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <select
        id={id}
        className={CONTROL}
        aria-describedby={describedBy}
        aria-invalid={error !== undefined}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
}

interface ChoiceProps {
  name: string;
  value: string;
  checked: boolean;
  onSelect: (value: string) => void;
  title: string;
  description?: string;
  /** Radios by default; `checkbox` look for a standalone toggle. */
  kind?: 'radio' | 'checkbox';
}

/** A large, thumb-friendly option row. Used for slots, tiers and answers. */
export function Choice({
  name,
  value,
  checked,
  onSelect,
  title,
  description,
  kind = 'radio',
}: ChoiceProps) {
  return (
    <label
      className={`flex min-h-tap cursor-pointer items-start gap-3 rounded-control border px-3 py-2.5 text-left transition-colors ${
        checked
          ? 'border-primary bg-primary-soft text-primary-soft-ink'
          : 'border-line-strong bg-surface text-ink hover:bg-surface-2'
      }`}
    >
      <input
        type={kind}
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="mt-1 size-4 shrink-0 accent-[var(--color-primary)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        {description !== undefined ? (
          <span className="text-xs text-ink-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
