/** Animated 4-way atomic split breakdown shown after payment confirmation. */
import { useEffect, useState } from 'react'
import { TrendingUp, Briefcase, Package, Shield } from 'lucide-react'

interface Props {
  amountUnits: bigint
  savingsBps?: number
  workingCapBps?: number
  supplierBps?: number
  bufferBps?: number
}

const DEFAULT_BPS = { savings: 2500, workingCap: 6000, supplier: 1000, buffer: 500 }

interface Split { label: string; bps: number; amount: bigint; color: string; icon: React.ReactNode }

export function SplitBreakdown({
  amountUnits,
  savingsBps    = DEFAULT_BPS.savings,
  workingCapBps = DEFAULT_BPS.workingCap,
  supplierBps   = DEFAULT_BPS.supplier,
  bufferBps     = DEFAULT_BPS.buffer,
}: Props) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80)
    return () => clearTimeout(t)
  }, [])

  const fmt = (units: bigint) => `$${(Number(units) / 1_000_000).toFixed(2)}`

  const splits: Split[] = [
    {
      label: 'Savings Vault',
      bps: savingsBps,
      amount: (amountUnits * BigInt(savingsBps)) / 10_000n,
      color: 'var(--success)',
      icon: <TrendingUp size={12} />,
    },
    {
      label: 'Working Capital',
      bps: workingCapBps,
      amount: (amountUnits * BigInt(workingCapBps)) / 10_000n,
      color: 'var(--customer-accent)',
      icon: <Briefcase size={12} />,
    },
    {
      label: 'Supplier Escrow',
      bps: supplierBps,
      amount: (amountUnits * BigInt(supplierBps)) / 10_000n,
      color: 'var(--accent)',
      icon: <Package size={12} />,
    },
    {
      label: 'Refund Buffer',
      bps: bufferBps,
      amount: (amountUnits * BigInt(bufferBps)) / 10_000n,
      color: 'var(--cashier-accent)',
      icon: <Shield size={12} />,
    },
  ]

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold tracking-widest uppercase text-[var(--muted)]">
        Atomic 4-Way Split
      </p>
      {splits.map((s, i) => (
        <div
          key={s.label}
          className="flex flex-col gap-1"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(6px)',
            transition: `opacity 300ms ease ${i * 80}ms, transform 300ms ease ${i * 80}ms`,
          }}
        >
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5" style={{ color: s.color }}>
              {s.icon}
              <span className="font-medium">{s.label}</span>
            </div>
            <span className="tabular-nums font-semibold text-[var(--ink)]">{fmt(s.amount)}</span>
          </div>
          {/* Progress bar */}
          <div className="h-1 bg-[var(--surface-muted)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                background: s.color,
                width: visible ? `${(s.bps / 10000) * 100}%` : '0%',
                transition: `width 500ms ease ${i * 80 + 100}ms`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
