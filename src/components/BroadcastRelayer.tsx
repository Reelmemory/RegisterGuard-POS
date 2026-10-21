/**
 * BroadcastRelayer — takes an EIP-3009 signed payload from the Customer Wallet
 * and settles it on-chain via a two-step sequence:
 *
 * Step 1: registerInvoiceForAuthorization(invoiceId, from, amount, nonce)
 *         This pre-registers the (from, nonce) → invoiceId mapping the
 *         USDC contract's receiveWithAuthorization will need to match.
 *         Caller must be owner or an active cashier.
 *
 * Step 2: payInvoiceWithAuthorization(invoiceId, from, amount, validAfter,
 *         validBefore, nonce, v, r, s, cashier)
 *         Verifies the pre-registration, calls USDC.receiveWithAuthorization,
 *         and distributes the 4-way split.
 *
 * If either step reverts, the component decodes the ABI-encoded custom error
 * or revert string from the error data and surfaces it in a toast and inline.
 */
import { useState, useCallback, useEffect } from 'react'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { decodeErrorResult, parseAbi } from 'viem'
import { Radio, Loader2, CheckCircle, ArrowUpRight, AlertTriangle } from 'lucide-react'
import type { RegisterGuardContract, EIP3009SignedPayload } from '../types'
import { arcTxUrl } from '../utils/arcExplorer'
import { toast } from 'sonner'

interface Props {
  contract: RegisterGuardContract
  chainId: number
  pendingSignedPayload: EIP3009SignedPayload | null
}

// RegisterGuardPOS custom error ABI — used to decode revert reasons
const CUSTOM_ERRORS_ABI = parseAbi([
  'error NotOwner()',
  'error NotOwnerOrActiveCashier()',
  'error InvalidSplitBps()',
  'error ZeroAddress()',
  'error InvoiceAlreadyPaid(bytes32 invoiceId)',
  'error InvoiceNotPaid(bytes32 invoiceId)',
  'error RefundExceedsInvoice()',
  'error ExceedsDailyRefundLimit()',
  'error InsufficientRefundBuffer()',
  'error ClaimNotFound(bytes32 claimId)',
  'error ClaimAlreadyClaimed(bytes32 claimId)',
  'error ClaimExpired(bytes32 claimId)',
  'error ClaimNotExpiredYet(bytes32 claimId)',
  'error InvalidSecret()',
  'error InvoiceNonceMismatch()',
  'error InsufficientSupplierEscrow()',
  'error TransferFailed()',
])

/** Decode an ABI-encoded revert reason or custom error to a human string. */
function decodeRevert(err: unknown): string {
  try {
    // wagmi/viem wraps the raw error data in err.cause?.data
    const raw = (err as { cause?: { data?: `0x${string}` } })?.cause?.data
    if (raw && raw.startsWith('0x')) {
      try {
        const decoded = decodeErrorResult({ abi: CUSTOM_ERRORS_ABI, data: raw })
        const args = decoded.args?.length
          ? ' (' + decoded.args.map(a => String(a).slice(0, 20)).join(', ') + ')'
          : ''
        return decoded.errorName + args
      } catch { /* fall through to message */ }
    }
    // Try the message string — viem puts the reason after "reverted with reason:"
    const msg: string = (err instanceof Error ? err.message : String(err)) ?? ''
    const reasonMatch = msg.match(/reason:\s*"?([^"]+)"?/i)
    if (reasonMatch) return reasonMatch[1]
    // Last resort: first 120 chars of the message
    return msg.slice(0, 120) || 'Unknown revert'
  } catch {
    return 'Unknown revert'
  }
}

type RelayStep = 'idle' | 'registering' | 'registered' | 'paying' | 'done' | 'error'

export function BroadcastRelayer({ contract, chainId, pendingSignedPayload }: Props) {
  const [step, setStep] = useState<RelayStep>('idle')
  const [revertReason, setRevertReason] = useState<string | null>(null)

  // ── Step 1: registerInvoiceForAuthorization ───────────────────────────────
  const {
    writeContract: registerTx,
    data: registerHash,
    isPending: registerPending,
    isError: registerIsError,
    error: registerError,
  } = useWriteContract()
  const { isLoading: registerConfirming, isSuccess: registerSuccess } =
    useWaitForTransactionReceipt({ hash: registerHash })

  // ── Step 2: payInvoiceWithAuthorization ───────────────────────────────────
  const {
    writeContract: broadcastTx,
    data: broadcastHash,
    isPending: broadcastPending,
    isError: broadcastIsError,
    error: broadcastError,
  } = useWriteContract()
  const { isLoading: broadcastConfirming, isSuccess: broadcastSuccess } =
    useWaitForTransactionReceipt({ hash: broadcastHash })

  // ── Auto-advance to step 2 once step 1 confirms ───────────────────────────
  useEffect(() => {
    if (!registerSuccess || step !== 'registering' || !pendingSignedPayload) return
    setStep('paying')
    const p = pendingSignedPayload
    broadcastTx({
      address: contract.address,
      abi: contract.abi,
      functionName: 'payInvoiceWithAuthorization',
      args: [
        p.invoiceId as `0x${string}`,
        p.from    as `0x${string}`,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerSuccess])

  // ── Watch for step-2 done ─────────────────────────────────────────────────
  useEffect(() => {
    if (broadcastSuccess && step === 'paying') setStep('done')
  }, [broadcastSuccess, step])

  // ── Surface revert errors ─────────────────────────────────────────────────
  useEffect(() => {
    if (registerIsError && registerError) {
      const reason = decodeRevert(registerError)
      setRevertReason(`Register step: ${reason}`)
      setStep('error')
      toast.error(`Registration failed: ${reason}`)
    }
  }, [registerIsError, registerError])

  useEffect(() => {
    if (broadcastIsError && broadcastError) {
      const reason = decodeRevert(broadcastError)
      setRevertReason(`Pay step: ${reason}`)
      setStep('error')
      toast.error(`Payment relay failed: ${reason}`)
    }
  }, [broadcastIsError, broadcastError])

  // ── Start the relay sequence ──────────────────────────────────────────────
  const handleBroadcast = useCallback(() => {
    if (!pendingSignedPayload) return
    setStep('registering')
    setRevertReason(null)
    const p = pendingSignedPayload
    // Step 1: bind (from, nonce) → invoiceId in the contract's mapping
    registerTx({
      address: contract.address,
      abi: contract.abi,
      functionName: 'registerInvoiceForAuthorization',
      args: [
        p.invoiceId as `0x${string}`,
        p.from      as `0x${string}`,
        BigInt(p.amount),
        p.nonce,
      ],
      chainId,
    })
  }, [pendingSignedPayload, contract, chainId, registerTx])

  if (!pendingSignedPayload) return null

  const isBusy = registerPending || registerConfirming || broadcastPending || broadcastConfirming

  return (
    <div className="glass-strong p-4 mx-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Radio size={13} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold text-[var(--ink)]">Offline Signature Ready to Relay</span>
      </div>

      {/* Payload summary */}
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
        <div className="flex justify-between">
          <span className="text-[var(--subtle)]">Nonce</span>
          <span className="mono text-[var(--subtle)]">{pendingSignedPayload.nonce.slice(0, 12)}…</span>
        </div>
      </div>

      {/* Step progress */}
      {step !== 'idle' && step !== 'done' && step !== 'error' && (
        <div className="flex items-center gap-2 text-xs">
          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
            step === 'registered' || step === 'paying'
              ? 'bg-[var(--success)] text-[#0d1b2f]'
              : 'bg-[var(--surface-muted)] border border-[var(--border)] text-[var(--subtle)]'
          }`}>
            {step === 'registered' || step === 'paying' ? '✓' : '1'}
          </div>
          <span className={step === 'registering' ? 'text-[var(--ink)]' : 'text-[var(--subtle)]'}>
            Register nonce
            {(registerPending || registerConfirming) && (
              <Loader2 size={10} className="inline ml-1 animate-spin" />
            )}
          </span>
          <div className="flex-1 h-px bg-[var(--border)]" />
          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
            step === 'paying'
              ? 'bg-[var(--surface-muted)] border border-[var(--accent)] text-[var(--accent)]'
              : 'bg-[var(--surface-muted)] border border-[var(--border)] text-[var(--subtle)]'
          }`}>
            2
          </div>
          <span className={step === 'paying' ? 'text-[var(--ink)]' : 'text-[var(--subtle)]'}>
            Settle payment
            {(broadcastPending || broadcastConfirming) && (
              <Loader2 size={10} className="inline ml-1 animate-spin" />
            )}
          </span>
        </div>
      )}

      {/* Error display */}
      {revertReason && (
        <div className="bg-[rgba(240,112,128,0.1)] border border-[var(--danger)] rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle size={13} className="text-[var(--danger)] shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold text-[var(--danger)]">Relay failed</span>
            <span className="text-xs text-[var(--muted)] font-mono break-all">{revertReason}</span>
          </div>
        </div>
      )}

      {step !== 'done' ? (
        <button
          onClick={step === 'idle' || step === 'error' ? handleBroadcast : undefined}
          disabled={isBusy || (step !== 'idle' && step !== 'error')}
          className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#0d1b2f] font-bold flex items-center justify-center gap-2 hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors"
        >
          {isBusy ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {registerPending  ? 'Confirm in wallet…'     :
               registerConfirming ? 'Registering nonce…'   :
               broadcastPending  ? 'Confirm in wallet…'    :
               'Broadcasting to Arc…'}
            </>
          ) : step === 'error' ? (
            <><Radio size={14} /> Retry Broadcast</>
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
              href={arcTxUrl(chainId, broadcastHash)}
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
