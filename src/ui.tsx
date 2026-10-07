import type { ReactNode } from 'react'
import { STATUS, type Status } from './data'
import { Check } from 'lucide-react'

export const cx = (...a: (string | false | undefined | null)[]) => a.filter(Boolean).join(' ')

export function StatusBadge({ s, short }: { s: Status; short?: boolean }) {
  const c = STATUS[s]
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', c.badge)}>
      <span className={cx('size-1.5 rounded-full', c.dot)} />
      {short ? c.short : c.label}
    </span>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]', className)}>{children}</div>
}

export function CardHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
      <div>
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

type BtnProps = { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; className?: string; type?: 'button' | 'submit' }
export function Btn({ children, onClick, variant = 'secondary', disabled, className, type = 'button' }: BtnProps) {
  const v = {
    primary: 'bg-brand text-white hover:bg-brand-dark border-brand',
    secondary: 'bg-white text-ink hover:bg-canvas border-line',
    ghost: 'bg-transparent text-brand hover:bg-brand-soft border-transparent',
    danger: 'bg-white text-[#a12a22] hover:bg-[#fbe7e5] border-[#f1b9b4]',
  }[variant]
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40', v, className)}>
      {children}
    </button>
  )
}

export function Check2({ checked, onChange, label, disabled }: { checked: boolean; onChange?: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex items-center gap-2.5 text-sm select-none', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <span className={cx('grid size-[18px] place-items-center rounded border transition-colors', checked ? 'bg-brand border-brand text-white' : 'bg-white border-[#b8c0cc]')}>
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      {label}
    </label>
  )
}

export function Switch({ on, onChange, disabled }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange?.(!on)}
      className={cx('relative h-6 w-11 rounded-full transition-colors', on ? 'bg-brand' : 'bg-[#cdd3dd]', disabled && 'opacity-50')}>
      <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

export const inputCls = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm placeholder:text-[#98a2b3] focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15'

export function Days({ d }: { d: number }) {
  const txt = d < 0 ? `Venció hace ${-d} ${d === -1 ? 'día' : 'días'}` : d === 0 ? 'Hoy' : `${d} ${d === 1 ? 'día' : 'días'}`
  const cls = d < 0 ? 'text-[#3d4756]' : d <= 7 ? 'text-[#a12a22] font-semibold' : d <= 15 ? 'text-[#9a4a10] font-medium' : 'text-ink'
  return <span className={cx('tnum whitespace-nowrap', cls)}>{txt}</span>
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx('px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted bg-[#f8f9fb] whitespace-nowrap', className)}>{children}</th>
}
export const tdCls = 'px-4 py-3 text-sm whitespace-nowrap'

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center py-14 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-full bg-brand-soft text-brand text-xl">∅</div>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
