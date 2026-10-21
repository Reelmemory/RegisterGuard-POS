import { useState, useCallback, useEffect, useRef } from 'react'
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from 'wagmi'
import { keccak256, encodeAbiParameters, parseAbiParameters, toHex } from 'viem'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import {
  ShoppingCart,
  Zap,
  ArrowUpRight,
  CheckCircle,
  Loader2,
  Copy,
  ChevronRight,
  ReceiptText,
  ChevronDown,
  Shuffle,
  Coffee,
  Cookie,
  Apple,
  Sandwich,
  Lock,
  Trash2,
  Plus,
  Download,
} from 'lucide-react'
import type { RegisterGuardContract, Invoice, QRPayload, RefundClaimPayload } from '../types'
import { getUsdc } from '@/onchain-facts'
import { arcTxUrl } from '../utils/arcExplorer'
import { parseAmount } from '@/onchain-money'
import { exportSessionCsv } from '../utils/exportCsv'

// ─── Cart item type ───────────────────────────────────────────────────────────
interface CartItem {
  label: string
  amount: string  // USD string e.g. "0.25"
  qty: number
}

// ─── Cashier micro-presets ───────────────────────────────────────────────────
const PRESETS: { label: string; amount: string; icon: React.ReactNode }[] = [
  { label: 'Espresso', amount: '0.10', icon: <Coffee   size={11} /> },
  { label: 'Pastry',   amount: '0.25', icon: <Cookie   size={11} /> },
  { label: 'Juice',    amount: '0.50', icon: <Apple    size={11} /> },
  { label: 'Lunch',    amount: '5.00', icon: <Sandwich size={11} /> },
]

interface Props {
  contract: RegisterGuardContract
  chainId: number
  cashierAddress: `0x${string}`
  onInvoiceCreated: (payload: QRPayload) => void
  onRefundClaimCreated: (payload: RefundClaimPayload) => void
  paidInvoices: Invoice[]
  isCurrentInvoicePaid?: boolean
}

function generateInvoiceId(): `0x${string}` {
  const rand = new Uint8Array(32)
  crypto.getRandomValues(rand)
  return toHex(rand)
}

const POS_READ_ABI = [
  { name: 'refundBufferBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

function safeRefundUnits(invoiceUnits: bigint, bufferBalance: bigint): bigint {
  return bufferBalance > 0n && bufferBalance < invoiceUnits ? bufferBalance : invoiceUnits
}
function formatUnitsUsd(units: bigint): string {
  return (Number(units) / 1_000_000).toFixed(2)
}

// Build a human-readable cart note string
function buildCartNote(items: CartItem[]): string {
  return items
    .map(it => it.qty > 1 ? `${it.qty}× ${it.label}` : it.label)
    .join(', ')
}

export function CashierPane({
  contract,
  chainId,
  cashierAddress,
  onInvoiceCreated,
  onRefundClaimCreated,
  paidInvoices,
  isCurrentInvoicePaid = false,
}: Props) {
  // ── Cart state ────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([])
  const [customAmount, setCustomAmount] = useState('')
  const [customLabel, setCustomLabel] = useState('')

  // ── QR / invoice display ─────────────────────────────────────────────────
  const [currentInvoiceId, setCurrentInvoiceId] = useState<`0x${string}` | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [lastGeneratedNote, setLastGeneratedNote] = useState('')
  const [lastGeneratedAmount, setLastGeneratedAmount] = useState('')

  // ── Refund rows ───────────────────────────────────────────────────────────
  const [directRefundingId, setDirectRefundingId] = useState<`0x${string}` | null>(null)
  const [claimRefundingId,  setClaimRefundingId]  = useState<`0x${string}` | null>(null)

  // ── Manual Refund & Claim QR card ─────────────────────────────────────────
  const [manualOpen,        setManualOpen]        = useState(false)
  const [manualInvoiceId,   setManualInvoiceId]   = useState('')
  const [manualAmountUsd,   setManualAmountUsd]   = useState('')
  const [manualRecipient,   setManualRecipient]   = useState('')
  const [manualClaimDest,   setManualClaimDest]   = useState('')
  const [manualClaimQr,     setManualClaimQr]     = useState<string | null>(null)
  const [manualClaimSecret, setManualClaimSecret] = useState<string | null>(null)
  const [manualClaimHashHex,setManualClaimHashHex]= useState<string | null>(null)

  const usdc = getUsdc(chainId)

  // Live refundBufferBalance
  const { data: bufferBalanceRaw } = useReadContract({
    address: contract.address,
    abi: POS_READ_ABI,
    functionName: 'refundBufferBalance',
    chainId,
    query: { refetchInterval: 10_000 },
  })
  const bufferBalance: bigint = typeof bufferBalanceRaw === 'bigint' ? bufferBalanceRaw : 0n
  const bufferUsd = Number(bufferBalance) / 1_000_000

  // wagmi hooks
  const { writeContract: directRefundTx, data: directHash, isPending: directPending } = useWriteContract()
  const { isLoading: directConfirming, isSuccess: directSuccess } = useWaitForTransactionReceipt({ hash: directHash })

  const { writeContract: createClaimTx, data: claimHash, isPending: claimPending } = useWriteContract()
  const { isLoading: claimConfirming, isSuccess: claimSuccess, data: claimReceipt } = useWaitForTransactionReceipt({ hash: claimHash })

  const { writeContract: manualDirectTx, data: manualDirectHash, isPending: manualDirectPending } = useWriteContract()
  const { isLoading: manualDirectConfirming, isSuccess: manualDirectSuccess } = useWaitForTransactionReceipt({ hash: manualDirectHash })

  const { writeContract: manualClaimTx, data: manualClaimTxHash, isPending: manualClaimTxPending } = useWriteContract()
  const { isLoading: manualClaimTxConfirming, isSuccess: manualClaimTxSuccess, data: manualClaimReceipt } = useWaitForTransactionReceipt({ hash: manualClaimTxHash })

  // Holds the pending RefundClaimPayload (without claimId) until the receipt arrives
  const pendingClaimPayloadRef    = useRef<Omit<RefundClaimPayload, 'claimId'> | null>(null)
  const pendingManualClaimPayloadRef = useRef<Omit<RefundClaimPayload, 'claimId'> | null>(null)
  // Track which receipts we already processed (prevent double-fire)
  const processedClaimTxRef       = useRef<string | undefined>(undefined)
  const processedManualClaimTxRef = useRef<string | undefined>(undefined)

  // Parse RefundClaimCreated log from receipt → extract real claimId (topic[1])
  // Event: RefundClaimCreated(bytes32 indexed claimId, bytes32 indexed invoiceId, …)
  const REFUND_CLAIM_CREATED_TOPIC =
    '0x' + keccak256(toHex('RefundClaimCreated(bytes32,bytes32,uint256,uint256,address)')).slice(2)

  // Row-level claim: fire onRefundClaimCreated with real claimId once receipt lands
  useEffect(() => {
    if (!claimReceipt || claimReceipt.transactionHash === processedClaimTxRef.current) return
    if (!pendingClaimPayloadRef.current) return
    processedClaimTxRef.current = claimReceipt.transactionHash
    const log = claimReceipt.logs.find(l =>
      l.topics[0]?.toLowerCase() === REFUND_CLAIM_CREATED_TOPIC.toLowerCase()
    )
    const claimId = log?.topics[1]
    onRefundClaimCreated({ ...pendingClaimPayloadRef.current, claimId })
    pendingClaimPayloadRef.current = null
  // REFUND_CLAIM_CREATED_TOPIC is derived from a constant — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimReceipt, onRefundClaimCreated])

  // Manual card: same pattern
  useEffect(() => {
    if (!manualClaimReceipt || manualClaimReceipt.transactionHash === processedManualClaimTxRef.current) return
    if (!pendingManualClaimPayloadRef.current) return
    processedManualClaimTxRef.current = manualClaimReceipt.transactionHash
    const log = manualClaimReceipt.logs.find(l =>
      l.topics[0]?.toLowerCase() === REFUND_CLAIM_CREATED_TOPIC.toLowerCase()
    )
    const claimId = log?.topics[1]
    onRefundClaimCreated({ ...pendingManualClaimPayloadRef.current, claimId })
    pendingManualClaimPayloadRef.current = null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualClaimReceipt, onRefundClaimCreated])

  // ── Cart operations ───────────────────────────────────────────────────────
  const addPreset = useCallback((label: string, amount: string) => {
    setCart(prev => {
      const idx = prev.findIndex(it => it.label === label && it.amount === amount)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return next
      }
      return [...prev, { label, amount, qty: 1 }]
    })
  }, [])

  const removeCartItem = useCallback((label: string, amount: string) => {
    setCart(prev => prev.filter(it => !(it.label === label && it.amount === amount)))
  }, [])

  const addCustom = useCallback(() => {
    const raw = parseFloat(customAmount)
    if (isNaN(raw) || raw <= 0) { toast.error('Enter a valid amount'); return }
    const label = customLabel.trim() || 'Custom Item'
    addPreset(label, raw.toFixed(2))
    setCustomAmount('')
    setCustomLabel('')
  }, [customAmount, customLabel, addPreset])

  // Cart subtotal
  const cartTotal = cart.reduce((sum, it) => sum + parseFloat(it.amount) * it.qty, 0)
  const cartNote  = buildCartNote(cart)

  // ── Generate QR from cart ────────────────────────────────────────────────
  const generateQR = useCallback(async () => {
    if (cart.length === 0 && (isNaN(parseFloat(customAmount)) || parseFloat(customAmount) <= 0)) {
      toast.error('Add at least one item to the cart'); return
    }
    const total = cart.length > 0 ? cartTotal : parseFloat(customAmount)
    if (!usdc) return

    const invoiceId   = generateInvoiceId()
    const amountUnits = parseAmount(chainId, total.toFixed(6)).raw
    const note        = cart.length > 0 ? cartNote : (customLabel.trim() || '')

    const payload: QRPayload = {
      type: 'invoice',
      invoiceId,
      contractAddress: contract.address,
      chainId,
      amountUnits: amountUnits.toString(),
      cashier: cashierAddress,
      note,
    }
    setCurrentInvoiceId(invoiceId)
    setLastGeneratedNote(note)
    setLastGeneratedAmount(`$${total.toFixed(2)}`)

    const qr = await QRCode.toDataURL(JSON.stringify(payload), {
      errorCorrectionLevel: 'M',
      width: 220,
      margin: 2,
      color: { dark: '#f9faf3', light: '#1f2f44' },
    })
    setQrDataUrl(qr)
    onInvoiceCreated(payload)
    toast.success('Invoice QR generated')
  }, [cart, cartTotal, cartNote, customAmount, customLabel, chainId, contract.address, cashierAddress, usdc, onInvoiceCreated])

  // ── 1-click Direct Refund (from Recent Receipts row) ─────────────────────
  const handleDirectRefund = useCallback((inv: Invoice) => {
    if (!inv.payer) { toast.error('No payer address recorded'); return }
    const units = safeRefundUnits(inv.amountUnits, bufferBalance)
    if (units === 0n) { toast.error('Refund buffer is empty'); return }
    setDirectRefundingId(inv.invoiceId)
    directRefundTx({
      address: contract.address,
      abi: contract.abi,
      functionName: 'issueDirectRefund',
      args: [inv.invoiceId, inv.payer, units],
      chainId,
    })
  }, [contract, chainId, bufferBalance, directRefundTx])

  // ── 1-click CEX Claim QR (from Recent Receipts row) ──────────────────────
  const handleCreateClaimRefund = useCallback((inv: Invoice) => {
    const dest = inv.payer
    if (!dest) { toast.error('No payer address for this invoice'); return }
    const units = safeRefundUnits(inv.amountUnits, bufferBalance)
    if (units === 0n) { toast.error('Refund buffer is empty'); return }

    const secretBytes = new Uint8Array(32)
    crypto.getRandomValues(secretBytes)
    const secretHex = toHex(secretBytes)
    const claimHashBytes = keccak256(
      encodeAbiParameters(parseAbiParameters('string, address'), [secretHex, dest])
    )
    setClaimRefundingId(inv.invoiceId)
    // Store pending payload — effect fires onRefundClaimCreated with real claimId from receipt
    pendingClaimPayloadRef.current = {
      type: 'refund_claim',
      invoiceId: inv.invoiceId,
      amountUnits: units.toString(),
      secret: secretHex,
      destination: dest,
      contractAddress: contract.address,
      chainId,
    }
    processedClaimTxRef.current = undefined // reset so effect fires for this new tx
    createClaimTx({
      address: contract.address,
      abi: contract.abi,
      functionName: 'createClaimableRefund',
      args: [inv.invoiceId, units, claimHashBytes],
      chainId,
    })
  }, [contract, chainId, bufferBalance, createClaimTx])

  // ── Manual card helpers ───────────────────────────────────────────────────
  const manualAmountUnits = useCallback((): bigint | null => {
    const raw = parseFloat(manualAmountUsd)
    if (isNaN(raw) || raw <= 0) return null
    return parseAmount(chainId, String(raw)).raw
  }, [manualAmountUsd, chainId])

  const handleManualDirectRefund = useCallback(() => {
    if (!manualInvoiceId.startsWith('0x')) { toast.error('Enter a valid 0x invoice ID'); return }
    if (!manualRecipient.startsWith('0x'))  { toast.error('Enter a valid recipient address'); return }
    const units = manualAmountUnits()
    if (!units) { toast.error('Enter a valid USD amount'); return }
    manualDirectTx({
      address: contract.address,
      abi: contract.abi,
      functionName: 'issueDirectRefund',
      args: [manualInvoiceId as `0x${string}`, manualRecipient as `0x${string}`, units],
      chainId,
    })
  }, [manualInvoiceId, manualRecipient, manualAmountUnits, contract, chainId, manualDirectTx])

  const handleManualCreateClaim = useCallback(async () => {
    if (!manualInvoiceId.startsWith('0x')) { toast.error('Enter a valid 0x invoice ID'); return }
    if (!manualClaimDest.startsWith('0x'))  { toast.error('Enter a valid destination address'); return }
    const units = manualAmountUnits()
    if (!units) { toast.error('Enter a valid USD amount'); return }

    const secretBytes = new Uint8Array(32)
    crypto.getRandomValues(secretBytes)
    const secretHex = toHex(secretBytes)
    const claimHashBytes = keccak256(
      encodeAbiParameters(parseAbiParameters('string, address'), [secretHex, manualClaimDest as `0x${string}`])
    )
    // Store pending payload — effect fires onRefundClaimCreated with real claimId from receipt
    pendingManualClaimPayloadRef.current = {
      type: 'refund_claim',
      invoiceId: manualInvoiceId,
      amountUnits: units.toString(),
      secret: secretHex,
      destination: manualClaimDest as `0x${string}`,
      contractAddress: contract.address,
      chainId,
    }
    processedManualClaimTxRef.current = undefined
    manualClaimTx({
      address: contract.address,
      abi: contract.abi,
      functionName: 'createClaimableRefund',
      args: [manualInvoiceId as `0x${string}`, units, claimHashBytes],
      chainId,
    })
    // Generate QR preview immediately (claimId not needed for the QR payload)
    const qrPayload = {
      type: 'refund_claim', invoiceId: manualInvoiceId, amountUnits: units.toString(),
      secret: secretHex, destination: manualClaimDest, contractAddress: contract.address, chainId,
    }
    try {
      const qr = await QRCode.toDataURL(JSON.stringify(qrPayload), {
        errorCorrectionLevel: 'M', width: 200, margin: 2,
        color: { dark: '#f9faf3', light: '#1f2f44' },
      })
      setManualClaimQr(qr)
    } catch { /* best-effort */ }
    setManualClaimSecret(secretHex)
    setManualClaimHashHex(claimHashBytes)
  }, [manualInvoiceId, manualClaimDest, manualAmountUnits, contract, chainId, manualClaimTx])

  const fillFromInvoice = useCallback((inv: Invoice) => {
    setManualOpen(true)
    setManualInvoiceId(inv.invoiceId)
    const safe = safeRefundUnits(inv.amountUnits, bufferBalance)
    setManualAmountUsd(formatUnitsUsd(safe))
    if (inv.payer) { setManualRecipient(inv.payer); setManualClaimDest(inv.payer) }
  }, [bufferBalance])

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text)
    toast.success('Copied!')
  }

  return (
    <div className="flex flex-col h-full gap-4 p-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--cashier-accent)]" />
          <span className="text-xs font-semibold tracking-widest uppercase text-[var(--muted)]">
            Cashier Terminal
          </span>
        </div>
        {paidInvoices.length > 0 && (
          <button
            onClick={() => exportSessionCsv(paidInvoices)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border)] text-xs text-[var(--subtle)] hover:border-[var(--cashier-accent)] hover:text-[var(--cashier-accent)] transition-colors"
          >
            <Download size={11} /> Export CSV
          </button>
        )}
      </div>

      {/* ── Multi-Item Cart Builder ─────────────────────────────────────────── */}
      <div className="glass p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 mb-1">
          <ShoppingCart size={14} className="text-[var(--cashier-accent)]" />
          <span className="text-sm font-semibold text-[var(--ink)]">New Invoice</span>
          {cart.length > 0 && (
            <button
              onClick={() => setCart([])}
              className="ml-auto flex items-center gap-1 text-xs text-[var(--subtle)] hover:text-[var(--danger)] transition-colors"
            >
              <Trash2 size={10} /> Clear Cart
            </button>
          )}
        </div>

        {/* Preset add-to-cart buttons */}
        <div className="grid grid-cols-4 gap-1.5">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => addPreset(p.label, p.amount)}
              className="flex flex-col items-center gap-0.5 py-2 rounded-xl border border-[var(--border)] text-xs font-medium transition-colors hover:border-[var(--cashier-accent)] hover:text-[var(--cashier-accent)] hover:bg-[rgba(255,215,0,0.06)] text-[var(--subtle)]"
            >
              <span className="opacity-70">{p.icon}</span>
              <span className="tabular-nums">${p.amount}</span>
            </button>
          ))}
        </div>

        {/* Custom item row */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Item name"
            value={customLabel}
            onChange={e => setCustomLabel(e.target.value)}
            className="flex-1 bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--cashier-accent)]"
          />
          <div className="relative w-28">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] font-semibold">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={customAmount}
              onChange={e => setCustomAmount(e.target.value)}
              className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl pl-6 pr-2 py-2 text-sm tabular-nums text-[var(--ink)] outline-none focus:border-[var(--cashier-accent)]"
            />
          </div>
          <button
            onClick={addCustom}
            className="px-3 py-2 rounded-xl bg-[var(--surface-muted)] border border-[var(--border)] text-[var(--subtle)] hover:border-[var(--cashier-accent)] hover:text-[var(--cashier-accent)] transition-colors"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Live itemized cart */}
        {cart.length > 0 && (
          <div className="bg-[var(--surface-muted)] rounded-xl divide-y divide-[var(--border)]">
            {cart.map(it => (
              <div key={`${it.label}-${it.amount}`} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--ink-2)]">
                    {it.qty > 1 && (
                      <span className="font-semibold text-[var(--cashier-accent)]">{it.qty}× </span>
                    )}
                    {it.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-xs font-semibold text-[var(--ink)]">
                    ${(parseFloat(it.amount) * it.qty).toFixed(2)}
                  </span>
                  <button onClick={() => removeCartItem(it.label, it.amount)} className="text-[var(--subtle)] hover:text-[var(--danger)] transition-colors">
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border)]">
              <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Subtotal</span>
              <span className="tabular-nums text-sm font-bold text-[var(--cashier-accent)]">
                ${cartTotal.toFixed(2)} USDC
              </span>
            </div>
          </div>
        )}

        <button
          onClick={() => { void generateQR() }}
          disabled={cart.length === 0 && (isNaN(parseFloat(customAmount)) || parseFloat(customAmount) <= 0)}
          className="w-full py-3 px-4 rounded-xl bg-[var(--cashier-accent)] text-[#0d1b2f] font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          <Zap size={14} />
          {cart.length > 0 ? `Generate QR · $${cartTotal.toFixed(2)}` : 'Generate Dynamic QR'}
        </button>
      </div>

      {/* QR Display */}
      {qrDataUrl && currentInvoiceId && (
        <div className={`glass p-4 flex flex-col items-center gap-3 transition-colors ${
          isCurrentInvoicePaid ? 'border border-[var(--success)]' : ''
        }`}>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted)] uppercase tracking-widest">Invoice QR</span>
            {isCurrentInvoicePaid && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(141,216,159,0.15)] border border-[var(--success)] text-[var(--success)] text-[10px] font-semibold">
                <CheckCircle size={9} /> PAID
              </span>
            )}
          </div>
          <img src={qrDataUrl} alt="Invoice QR" className="rounded-xl w-44 h-44" />
          <div className="flex items-center gap-1.5 text-xs mono text-[var(--subtle)]">
            <span>{currentInvoiceId.slice(0, 10)}…{currentInvoiceId.slice(-8)}</span>
            <button onClick={() => copyToClipboard(currentInvoiceId)}>
              <Copy size={11} className="hover:text-[var(--ink-2)] transition-colors" />
            </button>
          </div>
          <div className="text-[var(--cashier-accent)] font-semibold text-lg tabular-nums display">
            {lastGeneratedAmount}
          </div>
          {lastGeneratedNote && <p className="text-xs text-[var(--subtle)] text-center">{lastGeneratedNote}</p>}
        </div>
      )}

      {/* ── Manual Refund & Claim QR ──────────────────────────────────────────── */}
      <div className="glass overflow-hidden">
        <button
          onClick={() => setManualOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)] transition-colors"
        >
          <div className="flex items-center gap-2">
            <ReceiptText size={13} className="text-[var(--cashier-accent)]" />
            Manual Refund &amp; Claim QR
          </div>
          <ChevronDown
            size={13}
            className={`text-[var(--subtle)] transition-transform duration-200 ${manualOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {manualOpen && (
          <div className="px-4 pb-4 flex flex-col gap-3 border-t border-[var(--border)]">
            <div className="flex items-center justify-between pt-3 text-xs">
              <span className="text-[var(--subtle)]">Refund buffer available</span>
              <span className="tabular-nums font-semibold text-[var(--success)]">${bufferUsd.toFixed(2)} USDC</span>
            </div>

            {paidInvoices.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-[var(--muted)]">Recent paid invoices — click to auto-fill</span>
                <div className="flex flex-wrap gap-1.5">
                  {paidInvoices.slice(0, 8).map(inv => (
                    <button
                      key={inv.invoiceId}
                      onClick={() => fillFromInvoice(inv)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] text-xs text-[var(--ink-2)] hover:border-[var(--cashier-accent)] hover:text-[var(--cashier-accent)] transition-colors"
                    >
                      <CheckCircle size={9} className="text-[var(--success)]" />
                      <span className="mono">{inv.invoiceId.slice(0, 8)}…</span>
                      <span className="tabular-nums text-[var(--success)]">${inv.amountUsd}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-xs text-[var(--muted)]">Paid Invoice ID</label>
                <input
                  type="text"
                  placeholder="0x…"
                  value={manualInvoiceId}
                  onChange={e => setManualInvoiceId(e.target.value)}
                  className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs mono text-[var(--ink)] outline-none focus:border-[var(--cashier-accent)]"
                />
              </div>
              <div className="flex flex-col justify-end">
                <button
                  onClick={() => setManualInvoiceId(generateInvoiceId())}
                  title="Generate mock invoice ID"
                  className="px-2.5 py-2 rounded-xl border border-[var(--border)] text-[var(--subtle)] hover:border-[var(--cashier-accent)] hover:text-[var(--cashier-accent)] transition-colors"
                >
                  <Shuffle size={13} />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--muted)]">Refund Amount (USD, max ${bufferUsd.toFixed(2)})</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] font-semibold">$</span>
                <input
                  type="number"
                  min="0"
                  max={bufferUsd}
                  step="0.01"
                  placeholder="0.00"
                  value={manualAmountUsd}
                  onChange={e => setManualAmountUsd(e.target.value)}
                  className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl pl-7 pr-4 py-2 text-sm tabular-nums text-[var(--ink)] outline-none focus:border-[var(--cashier-accent)]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              {/* Direct Refund — locked to original payer */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-[var(--danger)] uppercase tracking-wide">Direct Refund</span>
                <div className="flex flex-col gap-0.5">
                  <label className="text-[10px] text-[var(--subtle)] flex items-center gap-1">
                    <Lock size={9} /> Original Payer Wallet (Locked for Anti-Theft)
                  </label>
                  <div className={`w-full bg-[var(--surface-muted)] border rounded-xl px-3 py-2 text-xs mono truncate ${
                    manualRecipient ? 'border-[var(--danger)] text-[var(--ink)]' : 'border-[var(--border)] text-[var(--subtle)] italic'
                  }`}>
                    {manualRecipient || 'Select a paid invoice pill above'}
                  </div>
                </div>
                <button
                  onClick={handleManualDirectRefund}
                  disabled={manualDirectPending || manualDirectConfirming || !manualRecipient}
                  className="w-full py-2 rounded-xl border border-[var(--danger)] text-[var(--danger)] text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-[var(--danger)] hover:text-white transition-colors disabled:opacity-40"
                >
                  {manualDirectPending || manualDirectConfirming ? <Loader2 size={11} className="animate-spin" /> : <ArrowUpRight size={11} />}
                  {manualDirectPending ? 'Confirm…' : manualDirectConfirming ? 'Sending…' : 'Issue Direct Refund'}
                </button>
                {manualDirectSuccess && manualDirectHash && (
                  <a href={arcTxUrl(chainId, manualDirectHash)} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-[var(--success)] flex items-center gap-1 hover:underline">
                    <CheckCircle size={10} /> Sent! View tx
                  </a>
                )}
              </div>

              {/* CEX-Safe / Different Wallet Claim */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-[var(--accent)] uppercase tracking-wide">CEX-Safe / Different Wallet Claim QR</span>
                <input
                  type="text"
                  placeholder="Destination 0x…"
                  value={manualClaimDest}
                  onChange={e => { setManualClaimDest(e.target.value); setManualClaimQr(null) }}
                  className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs mono text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={() => { void handleManualCreateClaim() }}
                  disabled={manualClaimTxPending || manualClaimTxConfirming}
                  className="w-full py-2 rounded-xl border border-[var(--accent)] text-[var(--accent)] text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-[var(--accent)] hover:text-[#0d1b2f] transition-colors disabled:opacity-40"
                >
                  {manualClaimTxPending || manualClaimTxConfirming ? <Loader2 size={11} className="animate-spin" /> : <ChevronRight size={11} />}
                  {manualClaimTxPending ? 'Confirm…' : manualClaimTxConfirming ? 'Creating…' : 'Create Claimable Refund'}
                </button>
                {manualClaimTxSuccess && manualClaimTxHash && (
                  <a href={arcTxUrl(chainId, manualClaimTxHash)} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-[var(--success)] flex items-center gap-1 hover:underline">
                    <CheckCircle size={10} /> Created! View tx
                  </a>
                )}
              </div>
            </div>

            {manualClaimQr && manualClaimSecret && manualClaimHashHex && (
              <div className="mt-1 bg-[var(--surface-muted)] rounded-xl p-3 flex flex-col items-center gap-2">
                <span className="text-xs text-[var(--muted)] uppercase tracking-widest">Claim QR — show to customer</span>
                <img src={manualClaimQr} alt="Claim QR" className="rounded-xl w-36 h-36" />
                <div className="w-full flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--subtle)]">Secret</span>
                    <button onClick={() => copyToClipboard(manualClaimSecret)} className="text-[var(--subtle)] hover:text-[var(--ink-2)]">
                      <Copy size={10} />
                    </button>
                  </div>
                  <p className="mono text-xs text-[var(--ink-2)] break-all leading-tight">{manualClaimSecret.slice(0, 18)}…</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-[var(--subtle)]">Claim hash</span>
                    <button onClick={() => copyToClipboard(manualClaimHashHex)} className="text-[var(--subtle)] hover:text-[var(--ink-2)]">
                      <Copy size={10} />
                    </button>
                  </div>
                  <p className="mono text-xs text-[var(--ink-2)] break-all leading-tight">{manualClaimHashHex.slice(0, 18)}…</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Recent Receipts ───────────────────────────────────────────────────── */}
      {paidInvoices.length > 0 && (
        <div className="glass p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={13} className="text-[var(--success)]" />
            <span className="text-sm font-semibold text-[var(--ink)]">Recent Receipts</span>
            <span className="ml-auto text-xs text-[var(--subtle)]">click row to fill refund form</span>
          </div>

          {paidInvoices.map(inv => {
            const safeUnits = safeRefundUnits(inv.amountUnits, bufferBalance)
            const safeUsd   = formatUnitsUsd(safeUnits)
            const hasPayer  = !!inv.payer
            const isThisDirectPending = directRefundingId === inv.invoiceId && (directPending || directConfirming)
            const isThisDirectDone    = directRefundingId === inv.invoiceId && directSuccess
            const isThisClaimPending  = claimRefundingId  === inv.invoiceId && (claimPending  || claimConfirming)
            const isThisClaimDone     = claimRefundingId  === inv.invoiceId && claimSuccess

            return (
              <div key={inv.invoiceId} className="bg-[var(--surface-muted)] rounded-xl overflow-hidden">
                <button
                  onClick={() => fillFromInvoice(inv)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[var(--surface)] transition-colors text-left"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="mono text-xs text-[var(--subtle)] truncate">{inv.invoiceId.slice(0, 12)}…</span>
                    {inv.note && <span className="text-xs text-[var(--muted)] truncate">{inv.note}</span>}
                    {hasPayer && (
                      <span className="flex items-center gap-1 text-[10px] text-[var(--subtle)] mono">
                        <Lock size={8} /> {inv.payer!.slice(0, 8)}…{inv.payer!.slice(-4)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0 ml-2">
                    <span className="tabular-nums text-sm font-semibold text-[var(--success)]">${inv.amountUsd}</span>
                    {bufferBalance > 0n && safeUnits < inv.amountUnits && (
                      <span className="text-[10px] text-[var(--warning)] tabular-nums">cap ${safeUsd}</span>
                    )}
                  </div>
                </button>

                <div className="flex gap-1.5 px-3 pb-3">
                  <button
                    onClick={() => { handleDirectRefund(inv) }}
                    disabled={!hasPayer || isThisDirectPending || isThisClaimPending}
                    title={hasPayer ? `Refund $${safeUsd} → ${inv.payer!.slice(0, 8)}…` : 'No payer address recorded'}
                    className="flex-1 py-1.5 rounded-lg border border-[var(--danger)] text-[var(--danger)] text-xs font-medium hover:bg-[var(--danger)] hover:text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                  >
                    {isThisDirectPending ? <Loader2 size={10} className="animate-spin" /> : <ArrowUpRight size={10} />}
                    {isThisDirectPending ? (directPending ? 'Confirm…' : 'Sending…') : `Refund $${safeUsd}`}
                  </button>
                  <button
                    onClick={() => { handleCreateClaimRefund(inv) }}
                    disabled={!hasPayer || isThisDirectPending || isThisClaimPending}
                    title={hasPayer ? `Claim QR $${safeUsd} → ${inv.payer!.slice(0, 8)}…` : 'No payer address recorded'}
                    className="flex-1 py-1.5 rounded-lg border border-[var(--accent)] text-[var(--accent)] text-xs font-medium hover:bg-[var(--accent)] hover:text-[#0d1b2f] transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                  >
                    {isThisClaimPending ? <Loader2 size={10} className="animate-spin" /> : <ChevronRight size={10} />}
                    {isThisClaimPending ? (claimPending ? 'Confirm…' : 'Creating…') : 'CEX Claim QR'}
                  </button>
                </div>

                {isThisDirectDone && directHash && (
                  <a href={arcTxUrl(chainId, directHash)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 px-3 pb-2 text-xs text-[var(--success)] hover:underline">
                    <CheckCircle size={9} /> Refund sent · View tx <ArrowUpRight size={9} />
                  </a>
                )}
                {isThisClaimDone && claimHash && (
                  <a href={arcTxUrl(chainId, claimHash)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 px-3 pb-2 text-xs text-[var(--success)] hover:underline">
                    <CheckCircle size={9} /> Claim created · View tx <ArrowUpRight size={9} />
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
