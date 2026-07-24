import React from 'react';
import { AlertCircle, CheckCircle2, Inbox, Loader2, WifiOff } from 'lucide-react';

/**
 * Shared UI primitives for the console.
 *
 * The point of centralising these is consistency of FEEDBACK: every async
 * action in the app must be able to express loading, success, failure and
 * empty in the same way, and every form field must be able to show a
 * server-supplied error against the specific input that caused it.
 */

export function Spinner({ className = 'w-5 h-5' }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden />;
}

/** Full-panel loading state. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500" role="status">
      <Spinner className="w-7 h-7" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** Nothing here yet — distinct from "failed to load", which is an error. */
export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <div className="text-zinc-300">{icon || <Inbox className="w-10 h-10" />}</div>
      <p className="text-sm font-semibold text-zinc-700">{title}</p>
      {hint ? <p className="text-xs text-zinc-500 max-w-sm">{hint}</p> : null}
    </div>
  );
}

export type BannerTone = 'error' | 'success' | 'info' | 'offline';

const BANNER_STYLES: Record<BannerTone, string> = {
  error: 'bg-red-50 border-red-200 text-red-800',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  offline: 'bg-amber-50 border-amber-200 text-amber-900'
};

export function Banner({
  tone,
  children,
  onDismiss
}: {
  tone: BannerTone;
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'offline' ? WifiOff : AlertCircle;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 border rounded-xl px-4 py-3 text-sm ${BANNER_STYLES[tone]}`}
    >
      <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1">{children}</div>
      {onDismiss ? (
        <button onClick={onDismiss} className="text-xs underline opacity-70 hover:opacity-100">
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

/**
 * A labelled input that renders its own validation error.
 * `error` is fed straight from the server's `fields` map, so the message the
 * user sees is the one the API actually produced — no client-side guessing.
 */
export function Field({
  label,
  error,
  hint,
  children,
  required
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-zinc-700">
        {label}
        {required ? <span className="text-red-500 ml-0.5">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="w-3 h-3 shrink-0" aria-hidden />
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs text-zinc-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function inputClass(hasError?: boolean) {
  return [
    'w-full rounded-xl px-3.5 py-2.5 text-sm bg-white border outline-none transition',
    hasError
      ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-100'
      : 'border-zinc-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
  ].join(' ');
}

export function Button({
  children,
  busy,
  variant = 'primary',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  const variants = {
    primary: 'bg-zinc-900 text-white hover:bg-zinc-800',
    secondary: 'bg-white text-zinc-800 border border-zinc-200 hover:bg-zinc-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-zinc-600 hover:bg-zinc-100'
  };
  return (
    <button
      {...rest}
      // Busy must also disable: a double-submitted disbursement is real money.
      disabled={busy || rest.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {busy ? <Spinner className="w-4 h-4" /> : null}
      {children}
    </button>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Escape closes — a modal you can only leave with the mouse is a trap.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-zinc-900/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-bold text-zinc-900">{title}</h2>
          {subtitle ? <p className="text-sm text-zinc-500 mt-0.5">{subtitle}</p> : null}
        </div>
        <div className="px-6 pb-6 space-y-4">{children}</div>
      </div>
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'red' | 'amber' | 'green' | 'zinc' | 'indigo'; children: React.ReactNode }) {
  const tones = {
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-800',
    green: 'bg-emerald-100 text-emerald-700',
    zinc: 'bg-zinc-100 text-zinc-600',
    indigo: 'bg-indigo-100 text-indigo-700'
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Naira formatting, used everywhere money is shown. */
export function ngn(amount: number | null | undefined): string {
  const n = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  return `₦${n.toLocaleString('en-NG')}`;
}

/** "3 hours ago" / "Never" — defaulter lists are unreadable as raw timestamps. */
export function sinceLabel(hours: number | null, neverPaid: boolean): string {
  if (neverPaid) return 'Never paid';
  if (hours === null) return 'Unknown';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
