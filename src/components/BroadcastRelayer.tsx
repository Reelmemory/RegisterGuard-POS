import { useCallback } from 'react'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { Radio, Loader2, CheckCircle, ArrowUpRight } from 'lucide-react'
import type { RegisterGuardContract, EIP3009SignedPayload } from '../types'
import { buildTxExplorerUrl } from '@/onchain-facts'

interface Props {
  contract: RegisterGuardContract
  chainId: number
  pendingSignedPayload: EIP3009SignedPayload | null
}

export function BroadcastRelayer({ contract, chainId, pendingSignedPayload }: Props) {
  const { writeContract: broadcastTx, data: broadcastHash, isPending: broadcastPending } = useWriteContract()
  const { isLoading: broadcastConfirming, isSuccess: broadcastSuccess } = useWaitForTransactionReceipt({ hash: broadcastHash })

  const handleBroadcast = useCallback(() => {
    if (!pendingSignedPayload) return
    const p = pendingSignedPayload
    broadcastTx({
      address: contract.address,
      abi: contract.abi,
      functionName: 'payInvoiceWithAuthorization',
      args: [
        p.invoiceId as `0x${string}`,
        p.from as `0x${string}`,
        BigInt(p.amount),
        BigInt(p.validAfter),
        BigInt(p.validBefore),
        p.nonce,
        p.v,
        p.r,
        p.s,
        p.cashier as `0x${string}`,
      ],
      chainId,
    })
  }, [pendingSignedPayload, contract, chainId, broadcastTx])

  if (!pendingSignedPayload) return null

  return (
    <div className="glass-strong p-4 mx-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Radio size={13} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold text-[var(--ink)]">Offline Signature Ready to Relay</span>
      </div>
      <div className="bg-[var(--surface-muted)] rounded-xl p-3 text-xs flex flex-col gap-1.5">
        <div className="flex justify-between">
          <span className="text-[var(--subtle)]">From</span>
          <span className="mono text-[var(--ink-2)]">{pendingSignedPayload.from.slice(0, 10)}…</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--subtle)]">Amount</span>
          <span className="tabular-nums text-[var(--success)] font-semibold">
            ${(Number(BigInt(pendingSignedPayload.amount)) / 1_000_000).toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--subtle)]">Method</span>
          <span className="text-[var(--muted)]">EIP-3009 ReceiveWithAuthorization</span>
        </div>
      </div>

      {!broadcastSuccess ? (
        <button
          onClick={handleBroadcast}
          disabled={broadcastPending || broadcastConfirming}
          className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#0d1b2f] font-bold flex items-center justify-center gap-2 hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors"
        >
          {broadcastPending || broadcastConfirming ? (
            <><Loader2 size={14} className="animate-spin" /> {broadcastPending ? 'Confirm in wallet…' : 'Broadcasting to Arc…'}</>
          ) : (
            <><Radio size={14} /> Broadcast Offline Signature to Arc (&lt;0.5s)</>
          )}
        </button>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-[var(--success)] font-semibold">
            <CheckCircle size={16} /> Settled on Arc!
          </div>
          {broadcastHash && (
            <a
              href={buildTxExplorerUrl(chainId, broadcastHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--accent)] flex items-center gap-1 hover:underline"
            >
              View on explorer <ArrowUpRight size={10} />
            </a>
          )}
        </div>
      )}
    </div>
  )
}
