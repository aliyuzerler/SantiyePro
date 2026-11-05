import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldFrameProps {
  id: string;
  label: string;
  required?: boolean;
  helpText?: string;
  error?: string;
  children: ReactNode;
}

/** Ortak form çerçevesi: üstte etiket, altta yardım/hata (design/03 form standardı). */
function FieldFrame({ id, label, required, helpText, error, children }: FieldFrameProps) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-text-primary">
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-danger-600">
            *
          </span>
        )}
      </label>
      {children}
      {helpText && !error && (
        <p id={helpId} className="text-xs text-text-secondary">
          {helpText}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(hasHelp: boolean, hasError: boolean, id: string): string | undefined {
  const ids: string[] = [];
  if (hasHelp) ids.push(`${id}-help`);
  if (hasError) ids.push(`${id}-error`);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  required?: boolean;
  helpText?: string;
  error?: string;
  id?: string;
}

/** Metin girişi — web input yüksekliği 42px, radius 8 (tokens.json control/layout). */
export function TextField({ label, required, helpText, error, id, className = '', ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldFrame id={inputId} label={label} required={required} helpText={helpText} error={error}>
      <input
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(Boolean(helpText), Boolean(error), inputId)}
        className={`min-h-[42px] rounded-input border bg-surface-0 px-3 text-sm text-text-primary placeholder:text-text-secondary/60 disabled:cursor-not-allowed disabled:bg-surface-100 ${
          error ? 'border-danger-600' : 'border-border-default focus:border-brand-600'
        } ${className}`}
        {...rest}
      />
    </FieldFrame>
  );
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  required?: boolean;
  helpText?: string;
  error?: string;
  id?: string;
}

export function TextArea({ label, required, helpText, error, id, className = '', rows = 4, ...rest }: TextAreaProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldFrame id={inputId} label={label} required={required} helpText={helpText} error={error}>
      <textarea
        id={inputId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(Boolean(helpText), Boolean(error), inputId)}
        className={`rounded-input border bg-surface-0 px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 disabled:cursor-not-allowed disabled:bg-surface-100 ${
          error ? 'border-danger-600' : 'border-border-default focus:border-brand-600'
        } ${className}`}
        {...rest}
      />
    </FieldFrame>
  );
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'> {
  label: string;
  required?: boolean;
  helpText?: string;
  error?: string;
  id?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

/** Seçim kutusu — native select tabanlı, klavye erişimi doğaldır. */
export function Select({ label, required, helpText, error, id, options, placeholder, className = '', ...rest }: SelectProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldFrame id={inputId} label={label} required={required} helpText={helpText} error={error}>
      <select
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(Boolean(helpText), Boolean(error), inputId)}
        className={`min-h-[42px] rounded-input border bg-surface-0 px-3 text-sm text-text-primary disabled:cursor-not-allowed disabled:bg-surface-100 ${
          error ? 'border-danger-600' : 'border-border-default focus:border-brand-600'
        } ${className}`}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}
