import { useState, useCallback, useEffect, useRef } from 'react'
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSignTypedData,
} from 'wagmi'
import { erc20Abi, keccak256, encodeAbiParameters } from 'viem'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import { Wifi, WifiOff, ShieldCheck, ShoppingCart, Loader2, ArrowUpRight, CheckCircle, Receipt, Store } from 'lucide-react'
import type { RegisterGuardContract, QRPayload, RefundClaimPayload, EIP3009SignedPayload, Invoice } from '../types'
import { getUsdc } from '@/onchain-facts'
import { arcTxUrl } from '../utils/arcExplorer'
import { playPosChime } from '../utils/posChime'
import { ThermalReceiptModal } from './ThermalReceiptModal'

interface Props {
  contract: RegisterGuardContract
  chainId: number
  activeInvoice: QRPayload | null
  activeRefundClaim: RefundClaimPayload | null
  onSignedQR: (payload: EIP3009SignedPayload) => void
  onInvoicePaid: (invoice: Invoice) => void
}

export function CustomerPane({
  contract,
  chainId,
  activeInvoice,
  activeRefundClaim,
  onSignedQR,
  onInvoicePaid,
}: Props) {
  const { address } = useAccount()
  const [offlineMode, setOfflineMode] = useState(false)
  const [signedQrDataUrl, setSignedQrDataUrl] = useState<string | null>(null)
  const [claimDestination, setClaimDestination] = useState('')
  const [isSigning, setIsSigning] = useState(false)

  // The invoiceId that is currently locked into the payment flow.
  // Set when payInvoice is submitted; cleared when a new invoice arrives.
  // ALL paid-state UI is gated on: paidInvoiceId === activeInvoice.invoiceId
  const [paidInvoiceId, setPaidInvoiceId] = useState<string | null>(null)

  // Immutable snapshot of the Invoice at confirmation time — stored in state
  // (not a ref) so it can safely be read in JSX. Set once; only cleared when
  // a new invoice resets the flow.
  const [paidInvoiceSnapshot, setPaidInvoiceSnapshot] = useState<Invoice | null>(null)

  // Modal open/close
  const [receiptOpen, setReceiptOpen] = useState(false)

  const usdc = getUsdc(chainId)

  // ── wagmi hooks ───────────────────────────────────────────────────────────
  const {
    writeContract: approveTx,
    data: approveHash,
    isPending: approvePending,
    reset: resetApprove,
  } = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveSuccess } =
    useWaitForTransactionReceipt({ hash: approveHash })

  const {
    writeContract: payTx,
    data: payHash,
    isPending: payPending,
    reset: resetPay,
  } = useWriteContract()
  const { isLoading: payConfirming, isSuccess: paySuccess } =
    useWaitForTransactionReceipt({ hash: payHash })

  const { writeContract: claimTx, data: claimTxHash, isPending: claimPending } = useWriteContract()
  const { isLoading: claimConfirming, isSuccess: claimSuccess } =
    useWaitForTransactionReceipt({ hash: claimTxHash })

  const { signTypedDataAsync } = useSignTypedData()

  // ── Snapshot the invoiceId the moment payInvoice is submitted ────────────
  // This ref records which invoiceId was active when the user clicked
  // "Confirm Payment". paySuccess alone is not enough — it stays true
  // until reset() is called, so it would re-fire for the next invoice.
  const payingForInvoiceIdRef = useRef<string | null>(null)

  // ── Reset ALL payment state when a new invoice arrives ───────────────────
  // prevInvoiceIdRef lets the effect detect a genuine change without running
  // on every render.
  const prevInvoiceIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const newId = activeInvoice?.invoiceId
    if (newId !== prevInvoiceIdRef.current) {
      prevInvoiceIdRef.current = newId
      // Reset wagmi hooks so approveSuccess/paySuccess go back to false
      resetApprove()
      resetPay()
      // Clear the payment snapshot for this invoice slot
      payingForInvoiceIdRef.current = null
      setPaidInvoiceId(null)
      setPaidInvoiceSnapshot(null)
      setReceiptOpen(false)
      setSignedQrDataUrl(null)
    }
  // resetApprove / resetPay are stable wagmi refs — safe in deps
  }, [activeInvoice?.invoiceId, resetApprove, resetPay])

  // ── Fire chime + build the paid Invoice record when paySuccess is true
  //    AND the confirmed hash matches the invoice we submitted for ───────────
  const chimeFiredRef = useRef(false)
  useEffect(() => {
    if (
      paySuccess &&
      !chimeFiredRef.current &&
      payingForInvoiceIdRef.current !== null &&
      activeInvoice !== null &&
      payingForInvoiceIdRef.current === activeInvoice.invoiceId
    ) {
      chimeFiredRef.current = true
      playPosChime()

      // Snapshot receipt data NOW — immutable from this point on
      const snapshot: Invoice = {
        invoiceId:   activeInvoice.invoiceId as `0x${string}`,
        amountUnits: BigInt(activeInvoice.amountUnits),
        amountUsd:   (Number(BigInt(activeInvoice.amountUnits)) / 1_000_000).toFixed(2),
        note:        activeInvoice.note,
        cashier:     activeInvoice.cashier as `0x${string}`,
        payer:       address,
        txHash:      payHash,
        chainId,
        createdAt:   new Date().toLocaleString(),
      }
      // Store snapshot in state (safe to read in JSX, never mutated after this)
      setPaidInvoiceSnapshot(snapshot)

      // Mark this exact invoiceId as paid and open the receipt automatically
      setPaidInvoiceId(activeInvoice.invoiceId)
      setReceiptOpen(true)

      // Bubble up to App → CashierPane paidInvoices list
      onInvoicePaid(snapshot)
    }
  }, [paySuccess, activeInvoice, address, payHash, chainId, onInvoicePaid])

  // ── Payment handlers ──────────────────────────────────────────────────────
  const handleOnlinePay = useCallback(() => {
    if (!activeInvoice || !address || !usdc) return
    const amount = BigInt(activeInvoice.amountUnits)
    approveTx({
      address: usdc.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'approve',
      args: [contract.address, amount],
      chainId,
    })
  }, [activeInvoice, address, usdc, contract.address, chainId, approveTx])

  const handlePayAfterApprove = useCallback(() => {
    if (!activeInvoice || !address) return
    // Snapshot the invoiceId being paid BEFORE submitting the tx
    payingForInvoiceIdRef.current = activeInvoice.invoiceId
    chimeFiredRef.current = false
    payTx({
      address: contract.address,
      abi: contract.abi,
      functionName: 'payInvoice',
      args: [
        activeInvoice.invoiceId as `0x${string}`,
        BigInt(activeInvoice.amountUnits),
        activeInvoice.cashier as `0x${string}`,
      ],
      chainId,
    })
  }, [activeInvoice, address, contract, chainId, payTx])

  const handleOfflineSign = useCallback(async () => {
    if (!activeInvoice || !address || !usdc) return
    setIsSigning(true)
    try {
      const amount = BigInt(activeInvoice.amountUnits)
      const validAfter = 0n
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const nonceBytes = new Uint8Array(32)
      crypto.getRandomValues(nonceBytes)
      const nonce = keccak256(encodeAbiParameters(
        [{ type: 'bytes' }],
        [`0x${Buffer.from(nonceBytes).toString('hex')}`]
      ))

      const sig = await signTypedDataAsync({
        domain: {
          name: 'USD Coin',
          version: '2',
          chainId,
          verifyingContract: usdc.address as `0x${string}`,
        },
        types: {
          ReceiveWithAuthorization: [
            { name: 'from',        type: 'address' },
            { name: 'to',          type: 'address' },
            { name: 'value',       type: 'uint256' },
            { name: 'validAfter',  type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce',       type: 'bytes32' },
          ],
        },
        primaryType: 'ReceiveWithAuthorization',
        message: { from: address, to: contract.address, value: amount, validAfter, validBefore, nonce },
      })

      const sigBytes = sig.slice(2)
      const r = `0x${sigBytes.slice(0, 64)}`
      const s = `0x${sigBytes.slice(64, 128)}`
      const v = parseInt(sigBytes.slice(128, 130), 16)

      const payload: EIP3009SignedPayload = {
        type: 'eip3009_signed',
        invoiceId: activeInvoice.invoiceId,
        from: address,
        amount: activeInvoice.amountUnits,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
        v,
        r: r as `0x${string}`,
        s: s as `0x${string}`,
        cashier: activeInvoice.cashier,
        contractAddress: contract.address,
        chainId,
      }

      const qr = await QRCode.toDataURL(JSON.stringify(payload), {
        errorCorrectionLevel: 'M',
        width: 220,
        margin: 2,
        color: { dark: '#f9faf3', light: '#1f2f44' },
      })
      setSignedQrDataUrl(qr)
      onSignedQR(payload)
      toast.success('Offline signature ready')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (!msg.toLowerCase().includes('user rejected')) toast.error('Signing failed')
    } finally {
      setIsSigning(false)
    }
  }, [activeInvoice, address, usdc, contract, chainId, signTypedDataAsync, onSignedQR])

  const handleClaimRefund = useCallback(() => {
    if (!activeRefundClaim) return
    // Use typed destination, or fall back to the payload's default destination
    const dest = claimDestination.startsWith('0x')
      ? claimDestination
      : activeRefundClaim.destination ?? ''
    if (!dest.startsWith('0x')) {
      toast.error('Enter a valid destination address'); return
    }
    const claimId = activeRefundClaim.claimId
    if (!claimId) { toast.error('Claim ID missing from QR'); return }
    claimTx({
      address: contract.address,
      abi: contract.abi,
      functionName: 'claimRefund',
      args: [claimId, activeRefundClaim.secret, dest as `0x${string}`],
      chainId,
    })
  }, [activeRefundClaim, claimDestination, contract, chainId, claimTx])

  // Receipt button opens the modal — snapshot is already in state
  const handleOpenReceipt = useCallback(() => {
    if (paidInvoiceSnapshot) setReceiptOpen(true)
  }, [paidInvoiceSnapshot])

  const formatUsd = (units: string) => `$${(Number(BigInt(units)) / 1_000_000).toFixed(2)}`

  // This invoice is "paid" only when the confirmed invoiceId matches exactly
  const thisInvoicePaid = !!activeInvoice && paidInvoiceId === activeInvoice.invoiceId

  return (
    <div className="flex flex-col h-full gap-4 p-4 overflow-y-auto">
      {/* Thermal Receipt Modal — driven by immutable snapshot in state */}
      {receiptOpen && paidInvoiceSnapshot && (
        <ThermalReceiptModal
          invoice={paidInvoiceSnapshot}
          onClose={() => setReceiptOpen(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--customer-accent)]" />
          <span className="text-xs font-semibold tracking-widest uppercase text-[var(--muted)]">
            Customer Wallet
          </span>
        </div>
        <button
          onClick={() => setOfflineMode(m => !m)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
            offlineMode
              ? 'border-[var(--danger)] text-[var(--danger)] bg-[rgba(232,109,122,0.08)]'
              : 'border-[var(--success)] text-[var(--success)] bg-[rgba(141,216,159,0.08)]'
          }`}
        >
          {offlineMode ? <WifiOff size={11} /> : <Wifi size={11} />}
          {offlineMode ? 'Offline / Dead-Zone' : 'Online Mode'}
        </button>
      </div>

      {/* Active Invoice */}
      {activeInvoice ? (
        <div className="glass p-5 flex flex-col gap-4">
          <div className="text-xs text-[var(--muted)] uppercase tracking-widest">
            {thisInvoicePaid ? 'Payment Complete' : 'Pending Payment'}
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="display text-4xl font-bold tabular-nums text-[var(--ink)]">
              {formatUsd(activeInvoice.amountUnits)}
            </span>
            <span className="text-xs text-[var(--subtle)] mono">
              {activeInvoice.contractAddress.slice(0, 12)}…
            </span>
            {activeInvoice.note && (
              <span className="text-sm text-[var(--muted)] mt-1">{activeInvoice.note}</span>
            )}
          </div>

          {/* Merchant summary — visible before payment only */}
          {!thisInvoicePaid && (
            <div className="bg-[var(--surface-muted)] rounded-xl p-3 flex flex-col gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-[var(--subtle)]">
                <Store size={11} />
                <span className="font-medium text-[var(--ink-2)]">
                  {activeInvoice.cashier.slice(0, 8)}…{activeInvoice.cashier.slice(-4)}
                </span>
              </div>
              {activeInvoice.note && (
                <div className="flex justify-between">
                  <span className="text-[var(--subtle)]">Item</span>
                  <span className="text-[var(--ink-2)] font-medium">{activeInvoice.note}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-[var(--border)] pt-2 mt-1">
                <span className="font-semibold text-[var(--ink)]">Total USDC</span>
                <span className="tabular-nums font-bold text-[var(--ink)]">
                  {formatUsd(activeInvoice.amountUnits)}
                </span>
              </div>
            </div>
          )}

          {!offlineMode ? (
            <div className="flex flex-col gap-2">
              {!approveSuccess && !thisInvoicePaid ? (
                <button
                  onClick={handleOnlinePay}
                  disabled={approvePending || approveConfirming}
                  className="w-full py-3 rounded-xl bg-[var(--customer-accent)] text-[#0d1b2f] font-semibold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {approvePending || approveConfirming ? (
                    <><Loader2 size={15} className="animate-spin" />
                      {approvePending ? 'Confirm in wallet…' : 'Approving…'}
                    </>
                  ) : 'Pay Now with USDC'}
                </button>
              ) : approveSuccess && !thisInvoicePaid ? (
                <button
                  onClick={handlePayAfterApprove}
                  disabled={payPending || payConfirming}
                  className="w-full py-3 rounded-xl bg-[var(--customer-accent)] text-[#0d1b2f] font-semibold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {payPending || payConfirming ? (
                    <><Loader2 size={15} className="animate-spin" />
                      {payPending ? 'Confirm in wallet…' : 'Confirming…'}
                    </>
                  ) : 'Confirm Payment'}
                </button>
              ) : thisInvoicePaid ? (
                /* Payment confirmed — clean retail confirmation card */
                <div className="flex flex-col gap-3">
                  <div className="bg-[rgba(141,216,159,0.08)] border border-[var(--success)] rounded-xl p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-[var(--success)] font-semibold">
                      <CheckCircle size={16} /> Payment Confirmed
                    </div>
                    <div className="flex flex-col gap-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Store size={11} className="text-[var(--subtle)]" />
                        <span className="text-[var(--subtle)]">Merchant</span>
                        <span className="ml-auto mono text-[var(--ink-2)]">
                          {activeInvoice.cashier.slice(0, 8)}…{activeInvoice.cashier.slice(-4)}
                        </span>
                      </div>
                      {activeInvoice.note && (
                        <div className="flex justify-between">
                          <span className="text-[var(--subtle)]">Item</span>
                          <span className="text-[var(--ink-2)] font-medium">{activeInvoice.note}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-[var(--border)] pt-2 mt-1">
                        <span className="font-semibold text-[var(--ink)]">Total Paid</span>
                        <span className="tabular-nums font-bold text-[var(--success)]">
                          {formatUsd(activeInvoice.amountUnits)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {payHash && (
                      <a
                        href={arcTxUrl(chainId, payHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-2 rounded-xl border border-[var(--border)] text-xs text-[var(--accent)] flex items-center justify-center gap-1 hover:underline"
                      >
                        View on Explorer <ArrowUpRight size={10} />
                      </a>
                    )}
                    <button
                      onClick={handleOpenReceipt}
                      className="flex-1 py-2 rounded-xl border border-[var(--border)] text-xs text-[var(--ink-2)] flex items-center justify-center gap-1 hover:bg-[var(--surface-muted)] transition-colors"
                    >
                      <Receipt size={11} /> Thermal Receipt
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            /* Offline / EIP-3009 path */
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { void handleOfflineSign() }}
                disabled={isSigning}
                className="w-full py-3 rounded-xl border border-[var(--accent)] text-[var(--accent)] font-semibold flex items-center justify-center gap-2 hover:bg-[var(--accent)] hover:text-[#0d1b2f] disabled:opacity-40 transition-colors"
              >
                {isSigning ? (
                  <><Loader2 size={15} className="animate-spin" /> Signing…</>
                ) : (
                  <><ShieldCheck size={15} /> Sign Offline QR (0 Gas)</>
                )}
              </button>
              {signedQrDataUrl && (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs text-[var(--muted)]">Signed Authorization QR</span>
                  <img src={signedQrDataUrl} alt="Signed QR" className="rounded-xl w-40 h-40" />
                  <span className="text-xs text-[var(--subtle)]">Show this to the cashier</span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="glass p-8 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-[var(--surface-muted)] flex items-center justify-center">
            <ShoppingCart size={20} className="text-[var(--subtle)]" />
          </div>
          <p className="text-sm text-[var(--subtle)]">No active invoice.</p>
          <p className="text-xs text-[var(--subtle)]">
            The cashier generates an invoice QR on the left. In Split-Screen Demo mode it appears here automatically.
          </p>
        </div>
      )}

      {/* ── Claim Refund Escrow Drawer ─────────────────────────────────────── */}
      {activeRefundClaim && (
        <div className="glass border border-[var(--accent)] p-4 flex flex-col gap-3">
          {/* Header */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[rgba(99,190,255,0.12)] flex items-center justify-center">
              <ShieldCheck size={14} className="text-[var(--accent)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--ink)]">Claim Refund Escrow</p>
              <p className="text-xs text-[var(--subtle)]">CEX-safe · route to any wallet</p>
            </div>
          </div>

          {/* Refund summary */}
          <div className="bg-[var(--surface-muted)] rounded-xl p-3 flex flex-col gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--subtle)]">Refund Amount</span>
              <span className="tabular-nums text-[var(--success)] font-bold text-sm">
                {formatUsd(activeRefundClaim.amountUnits)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--subtle)]">Invoice</span>
              <span className="mono text-[var(--ink-2)]">
                {activeRefundClaim.invoiceId.slice(0, 12)}…
              </span>
            </div>
            {activeRefundClaim.destination && (
              <div className="flex justify-between">
                <span className="text-[var(--subtle)]">Default destination</span>
                <span className="mono text-[var(--ink-2)]">
                  {activeRefundClaim.destination.slice(0, 10)}…
                </span>
              </div>
            )}
          </div>

          {/* Destination address — pre-filled from claim payload, editable */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--subtle)]">
              Receive-to Address
              <span className="ml-1 text-[var(--muted)]">(override to send to a different wallet)</span>
            </label>
            <input
              type="text"
              placeholder={activeRefundClaim.destination ?? '0x…'}
              value={claimDestination}
              onChange={e => setClaimDestination(e.target.value)}
              className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-xs mono text-[var(--ink)] outline-none focus:border-[var(--accent)] transition-colors"
            />
            {/* Quick-fill from payload destination */}
            {activeRefundClaim.destination && !claimDestination && (
              <button
                onClick={() => setClaimDestination(activeRefundClaim.destination)}
                className="self-start text-[10px] text-[var(--accent)] hover:underline"
              >
                Use default: {activeRefundClaim.destination.slice(0, 12)}…
              </button>
            )}
          </div>

          <button
            onClick={handleClaimRefund}
            disabled={claimPending || claimConfirming || (!claimDestination && !activeRefundClaim.destination)}
            className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#0d1b2f] font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {claimPending || claimConfirming ? (
              <><Loader2 size={13} className="animate-spin" />
                {claimPending ? 'Confirm in wallet…' : 'Sweeping…'}
              </>
            ) : (
              <><ShieldCheck size={14} /> Sweep Claimable Refund</>
            )}
          </button>
          {claimSuccess && claimTxHash && (
            <a
              href={arcTxUrl(chainId, claimTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--success)] flex items-center gap-1 justify-center hover:underline"
            >
              <CheckCircle size={11} /> Refund swept successfully! View tx <ArrowUpRight size={10} />
            </a>
          )}
        </div>
      )}
    </div>
  )
}
