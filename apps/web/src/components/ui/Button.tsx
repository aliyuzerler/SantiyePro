import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Yükleme durumunda buton kilitlenir ve spinner gösterilir. */
  loading?: boolean;
  /** loading sırasında buton metninin yerine geçen erişilebilir açıklama. */
  loadingLabel?: string;
  /** Buton içindeki ikon (ör. "+") — preview.html birincil aksiyonu gibi. */
  leading?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-brand-900 text-white hover:bg-brand-800 disabled:bg-brand-900/40',
  secondary:
    'bg-surface-0 text-text-primary border border-border-default hover:bg-surface-50 disabled:text-text-secondary/50',
  tertiary: 'bg-transparent text-brand-600 hover:bg-surface-100 disabled:text-text-secondary/40',
  destructive: 'bg-danger-600 text-white hover:bg-danger-600/90 disabled:bg-danger-600/40',
};

/**
 * Buton — design/04 buton hiyerarşisi.
 * Primary: sayfada tek ana aksiyon; Secondary: alternatif; Tertiary: düşük öncelik; Destructive: silme/iptal.
 * Dokunma hedefi: min 40px (web), focus halkası globals.css :focus-visible ile.
 */
export function Button({
  variant = 'primary',
  loading = false,
  loadingLabel,
  leading,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-button px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {loading ? (
        <Spinner aria-hidden />
      ) : (
        leading !== undefined && (
          <span aria-hidden className="text-base leading-none">
            {leading}
          </span>
        )
      )}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}
