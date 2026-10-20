import { useState, useCallback } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { isAddress, erc20Abi } from 'viem'
import { toast } from 'sonner'
import {
  Settings,
  UserPlus,
  Truck,
  Loader2,
  CheckCircle,
  ArrowUpRight,
  Wallet,
  TrendingUp,
  Shield,
} from 'lucide-react'
import type { RegisterGuardContract } from '../types'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'

interface Props {
  contract: RegisterGuardContract
  chainId: number
  ownerAddress: `0x${string}`
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
}) {
  return (
    <div className="glass p-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[var(--subtle)]">
        <Icon size={12} />
        <span className="text-xs uppercase tracking-widest">{label}</span>
      </div>
      <span className="display text-2xl font-bold tabular-nums text-[var(--ink)]">{value}</span>
      {sub && <span className="text-xs text-[var(--muted)]">{sub}</span>}
    </div>
  )
}

export function OwnerTab({ contract, chainId, ownerAddress: _ownerAddress }: Props) {
  const usdc = getUsdc(chainId)

  // Read on-chain state
  const { data: splitConfigRaw } = useReadContract({
    address: contract.address,
    abi: contract.abi,
    functionName: 'splitConfig',
    chainId,
  }) as { data: readonly [string, string, number, number, number, number, bigint] | undefined }

  const { data: refundBuffer } = useReadContract({
    address: contract.address,
    abi: contract.abi,
    functionName: 'refundBufferBalance',
    chainId,
  }) as { data: bigint | undefined }

  const { data: supplierEscrow } = useReadContract({
    address: contract.address,
    abi: contract.abi,
    functionName: 'supplierEscrowBalance',
    chainId,
  }) as { data: bigint | undefined }

  const { data: savingsBalance } = useReadContract({
    address: usdc?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: splitConfigRaw ? [splitConfigRaw[0] as `0x${string}`] : undefined,
    chainId,
    query: { enabled: !!splitConfigRaw?.[0] },
  }) as { data: bigint | undefined }

  const { data: workingCapBalance } = useReadContract({
    address: usdc?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: splitConfigRaw ? [splitConfigRaw[1] as `0x${string}`] : undefined,
    chainId,
    query: { enabled: !!splitConfigRaw?.[1] },
  }) as { data: bigint | undefined }

  const fmt6 = (v: bigint | undefined) =>
    v !== undefined ? `$${(Number(v) / 1_000_000).toFixed(2)}` : '—'
  const fmtBps = (v: number | undefined) =>
    v !== undefined ? `${(v / 100).toFixed(0)}%` : '—'

  // setSplitConfig
  const [splitForm, setSplitForm] = useState({
    ownerSavingsVault: '',
    workingCapitalWallet: '',
    savingsBps: '2500',
    workingCapitalBps: '6000',
    supplierEscrowBps: '1000',
    refundBufferBps: '500',
    maxRefundBuffer: '50000000',
  })

  const { writeContract: setSplitTx, data: setSplitHash, isPending: setSplitPending } = useWriteContract()
  const { isLoading: setSplitConfirming, isSuccess: setSplitSuccess } = useWaitForTransactionReceipt({ hash: setSplitHash })

  const handleSetSplit = useCallback(() => {
    if (!isAddress(splitForm.ownerSavingsVault) || !isAddress(splitForm.workingCapitalWallet)) {
      toast.error('Invalid addresses')
      return
    }
    const total =
      Number(splitForm.savingsBps) +
      Number(splitForm.workingCapitalBps) +
      Number(splitForm.supplierEscrowBps) +
      Number(splitForm.refundBufferBps)
    if (total !== 10000) {
      toast.error(`BPS must sum to 10000, got ${total}`)
      return
    }
    setSplitTx({
      address: contract.address,
      abi: contract.abi,
      functionName: 'setSplitConfig',
      args: [
        splitForm.ownerSavingsVault,
        splitForm.workingCapitalWallet,
        Number(splitForm.savingsBps),
        Number(splitForm.workingCapitalBps),
        Number(splitForm.supplierEscrowBps),
        Number(splitForm.refundBufferBps),
        BigInt(splitForm.maxRefundBuffer),
      ],
      chainId,
    })
  }, [splitForm, contract, chainId, setSplitTx])

  // setCashier
  const [cashierForm, setCashierForm] = useState({
    address: '',
    active: true,
    dailyRefundLimit: '30000000',
  })
  const { writeContract: setCashierTx, data: setCashierHash, isPending: setCashierPending } = useWriteContract()
  const { isLoading: setCashierConfirming, isSuccess: setCashierSuccess } = useWaitForTransactionReceipt({ hash: setCashierHash })

  const handleSetCashier = useCallback(() => {
    if (!isAddress(cashierForm.address)) {
      toast.error('Invalid cashier address')
      return
    }
    setCashierTx({
      address: contract.address,
      abi: contract.abi,
      functionName: 'setCashier',
      args: [
        cashierForm.address,
        cashierForm.active,
        BigInt(cashierForm.dailyRefundLimit),
      ],
      chainId,
    })
  }, [cashierForm, contract, chainId, setCashierTx])

  // releaseSupplierEscrow
  const [escrowForm, setEscrowForm] = useState({ supplier: '', amount: '', ref: '' })
  const { writeContract: releaseTx, data: releaseHash, isPending: releasePending } = useWriteContract()
  const { isLoading: releaseConfirming, isSuccess: releaseSuccess } = useWaitForTransactionReceipt({ hash: releaseHash })

  const handleRelease = useCallback(() => {
    if (!isAddress(escrowForm.supplier)) {
      toast.error('Invalid supplier address')
      return
    }
    const amt = Math.round(parseFloat(escrowForm.amount) * 1_000_000)
    if (isNaN(amt) || amt <= 0) {
      toast.error('Invalid amount')
      return
    }
    releaseTx({
      address: contract.address,
      abi: contract.abi,
      functionName: 'releaseSupplierEscrow',
      args: [escrowForm.supplier, BigInt(amt), escrowForm.ref],
      chainId,
    })
  }, [escrowForm, contract, chainId, releaseTx])

  return (
    <div className="flex flex-col gap-6 p-4 max-w-3xl mx-auto">
      {/* Metric Cards */}
      <div>
        <h2 className="display text-sm font-semibold text-[var(--muted)] uppercase tracking-widest mb-3">
          Live Treasury Metrics
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Savings Vault" value={fmt6(savingsBalance)} icon={Wallet} sub="Live USDC balance" />
          <StatCard label="Working Capital" value={fmt6(workingCapBalance)} icon={TrendingUp} sub="Live USDC balance" />
          <StatCard
            label="Refund Buffer"
            value={fmt6(refundBuffer)}
            icon={Shield}
            sub={splitConfigRaw ? `max ${fmt6(splitConfigRaw[6])}` : undefined}
          />
          <StatCard label="Supplier Escrow" value={fmt6(supplierEscrow)} icon={Truck} sub="On-contract" />
        </div>
      </div>

      {/* Current Split Config */}
      {splitConfigRaw && (
        <div className="glass p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 mb-1">
            <Settings size={13} className="text-[var(--accent)]" />
            <span className="text-sm font-semibold text-[var(--ink)]">Current Split Config</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between text-[var(--muted)]">
              <span>Savings</span>
              <span className="tabular-nums font-semibold text-[var(--ink-2)]">{fmtBps(splitConfigRaw[2])}</span>
            </div>
            <div className="flex justify-between text-[var(--muted)]">
              <span>Working Cap</span>
              <span className="tabular-nums font-semibold text-[var(--ink-2)]">{fmtBps(splitConfigRaw[3])}</span>
            </div>
            <div className="flex justify-between text-[var(--muted)]">
              <span>Supplier Escrow</span>
              <span className="tabular-nums font-semibold text-[var(--ink-2)]">{fmtBps(splitConfigRaw[4])}</span>
            </div>
            <div className="flex justify-between text-[var(--muted)]">
              <span>Refund Buffer</span>
              <span className="tabular-nums font-semibold text-[var(--ink-2)]">{fmtBps(splitConfigRaw[5])}</span>
            </div>
          </div>
        </div>
      )}

      {/* Update Split Config */}
      <div className="glass p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Settings size={13} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--ink)]">Update 4-Way Split</span>
        </div>
        {(['ownerSavingsVault', 'workingCapitalWallet'] as const).map(field => (
          <div key={field}>
            <label className="text-xs text-[var(--muted)] mb-1 block capitalize">
              {field === 'ownerSavingsVault' ? 'Owner Savings Vault Address' : 'Working Capital Wallet Address'}
            </label>
            <input
              type="text"
              placeholder="0x..."
              value={splitForm[field]}
              onChange={e => setSplitForm(f => ({ ...f, [field]: e.target.value }))}
              className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs mono text-[var(--ink)] outline-none focus:border-[var(--border-strong)]"
            />
          </div>
        ))}
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['savingsBps', 'Savings BPS'],
              ['workingCapitalBps', 'Working Cap BPS'],
              ['supplierEscrowBps', 'Supplier BPS'],
              ['refundBufferBps', 'Buffer BPS'],
            ] as [keyof typeof splitForm, string][]
          ).map(([field, label]) => (
            <div key={field}>
              <label className="text-xs text-[var(--muted)] mb-1 block">{label}</label>
              <input
                type="number"
                value={splitForm[field]}
                onChange={e => setSplitForm(f => ({ ...f, [field]: e.target.value }))}
                className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm tabular-nums text-[var(--ink)] outline-none focus:border-[var(--border-strong)]"
              />
            </div>
          ))}
        </div>
        <div>
          <label className="text-xs text-[var(--muted)] mb-1 block">Max Refund Buffer (USDC units, 6 dec)</label>
          <input
            type="number"
            value={splitForm.maxRefundBuffer}
            onChange={e => setSplitForm(f => ({ ...f, maxRefundBuffer: e.target.value }))}
            className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm tabular-nums text-[var(--ink)] outline-none focus:border-[var(--border-strong)]"
          />
        </div>
        <button
          onClick={handleSetSplit}
          disabled={setSplitPending || setSplitConfirming}
          className="py-2.5 px-4 rounded-xl bg-[var(--accent)] text-[#0d1b2f] font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors"
        >
          {setSplitPending || setSplitConfirming ? (
            <><Loader2 size={13} className="animate-spin" /> {setSplitPending ? 'Confirm…' : 'Updating…'}</>
          ) : setSplitSuccess ? (
            <><CheckCircle size={13} /> Updated!</>
          ) : (
            'Save Split Config'
          )}
        </button>
        {setSplitHash && (
          <a href={buildTxExplorerUrl(chainId, setSplitHash)} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--accent)] flex items-center gap-1 hover:underline">
            View tx <ArrowUpRight size={10} />
          </a>
        )}
      </div>

      {/* Cashier Management */}
      <div className="glass p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <UserPlus size={13} className="text-[var(--cashier-accent)]" />
          <span className="text-sm font-semibold text-[var(--ink)]">Cashier Permissions</span>
        </div>
        <input
          type="text"
          placeholder="Cashier address 0x..."
          value={cashierForm.address}
          onChange={e => setCashierForm(f => ({ ...f, address: e.target.value }))}
          className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs mono text-[var(--ink)] outline-none focus:border-[var(--border-strong)]"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={cashierForm.active}
              onChange={e => setCashierForm(f => ({ ...f, active: e.target.checked }))}
              className="rounded"
            />
            Active
          </label>
          <div className="flex-1">
            <input
              type="number"
              placeholder="Daily limit (USDC units)"
              value={cashierForm.dailyRefundLimit}
              onChange={e => setCashierForm(f => ({ ...f, dailyRefundLimit: e.target.value }))}
              className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs tabular-nums text-[var(--ink)] outline-none focus:border-[var(--border-strong)]"
            />
          </div>
        </div>
        <button
          onClick={handleSetCashier}
          disabled={setCashierPending || setCashierConfirming}
          className="py-2.5 px-4 rounded-xl bg-[var(--cashier-accent)] text-[#0d1b2f] font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-40"
        >
          {setCashierPending || setCashierConfirming ? (
            <><Loader2 size={13} className="animate-spin" /> {setCashierPending ? 'Confirm…' : 'Saving…'}</>
          ) : setCashierSuccess ? (
            <><CheckCircle size={13} /> Saved!</>
          ) : (
            'Set Cashier'
          )}
        </button>
      </div>

      {/* Release Supplier Escrow */}
      <div className="glass p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Truck size={13} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--ink)]">Release Supplier Escrow</span>
        </div>
        <input
          type="text"
          placeholder="Supplier address 0x..."
          value={escrowForm.supplier}
          onChange={e => setEscrowForm(f => ({ ...f, supplier: e.target.value }))}
          className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs mono text-[var(--ink)] outline-none focus:border-[var(--border-strong)]"
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[var(--muted)] mb-1 block">Amount (USD)</label>
            <input
              type="number"
              placeholder="0.00"
              value={escrowForm.amount}
              onChange={e => setEscrowForm(f => ({ ...f, amount: e.target.value }))}
              className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm tabular-nums text-[var(--ink)] outline-none focus:border-[var(--border-strong)]"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] mb-1 block">Invoice Reference</label>
            <input
              type="text"
              placeholder="INV-2026-001"
              value={escrowForm.ref}
              onChange={e => setEscrowForm(f => ({ ...f, ref: e.target.value }))}
              className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--border-strong)]"
            />
          </div>
        </div>
        <button
          onClick={handleRelease}
          disabled={releasePending || releaseConfirming}
          className="py-2.5 px-4 rounded-xl bg-[var(--accent)] text-[#0d1b2f] font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors"
        >
          {releasePending || releaseConfirming ? (
            <><Loader2 size={13} className="animate-spin" /> {releasePending ? 'Confirm…' : 'Releasing…'}</>
          ) : releaseSuccess ? (
            <><CheckCircle size={13} /> Released!</>
          ) : (
            'Release to Supplier'
          )}
        </button>
        {releaseHash && (
          <a href={buildTxExplorerUrl(chainId, releaseHash)} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--accent)] flex items-center gap-1 hover:underline">
            View tx <ArrowUpRight size={10} />
          </a>
        )}
      </div>
    </div>
  )
}
