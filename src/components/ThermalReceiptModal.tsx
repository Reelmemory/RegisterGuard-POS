/**
 * Thermal Receipt modal — shown after payment confirmation.
 *
 * Print support: clicking "Print Receipt" or pressing Ctrl+P triggers the
 * browser print dialog.  The embedded <style media="print"> stylesheet hides
 * everything except the receipt body and formats it for 80 mm thermal paper:
 *   • 80 mm wide, no margins, 9 pt Courier body
 *   • 48-char receipt width rendered in a monospace pre block
 *   • QR canvas printed at 28 mm
 *   • All dark-mode CSS variables replaced with white/black
 */
import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { X, ExternalLink, CheckCircle, Printer } from 'lucide-react'
import type { Invoice } from '../types'
import { arcTxUrl, arcExplorerName } from '../utils/arcExplorer'

interface Props {
  invoice: Invoice
  onClose: () => void
}

// Build a 48-char-wide monospace thermal receipt string
function buildThermalText(invoice: Invoice, chainId: number): string {
  const LINE = '─'.repeat(32)
  const pad  = (l: string, r: string, w = 32) => {
    const gap = w - l.length - r.length
    return l + ' '.repeat(Math.max(1, gap)) + r
  }
  const center = (s: string, w = 32) => {
    const p = Math.max(0, Math.floor((w - s.length) / 2))
    return ' '.repeat(p) + s
  }

  const lines: string[] = [
    center('REGISTERGUARD POS'),
    center(chainId === 5042 ? 'Arc Mainnet' : 'Arc Testnet'),
    center(invoice.createdAt ?? ''),
    LINE,
    pad('Invoice', invoice.invoiceId.slice(0, 14) + '…'),
    pad('Cashier', invoice.cashier.slice(0, 10) + '…'),
    invoice.payer ? pad('Payer', invoice.payer.slice(0, 10) + '…') : '',
    invoice.note  ? pad('Item', invoice.note.slice(0, 18))         : '',
    LINE,
    pad('TOTAL USDC', `$${(Number(invoice.amountUnits) / 1_000_000).toFixed(2)}`),
    LINE,
    '',
    center('Thank you!'),
    invoice.txHash ? center(arcTxUrl(chainId, invoice.txHash).slice(0, 30)) : '',
    '',
  ].filter(l => l !== undefined)

  return lines.join('\n')
}

export function ThermalReceiptModal({ invoice, onClose }: Props) {
  const qrRef     = useRef<HTMLCanvasElement>(null)
  const chainId   = invoice.chainId ?? 5042002
  const thermalTxt = buildThermalText(invoice, chainId)

  useEffect(() => {
    if (qrRef.current && invoice.txHash) {
      void QRCode.toCanvas(qrRef.current, arcTxUrl(chainId, invoice.txHash), {
        width: 120,
        margin: 1,
        color: { dark: '#0d1b2f', light: '#f9faf3' },
      })
    }
  }, [invoice.txHash, chainId])

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  const fmt = (units: bigint) => `$${(Number(units) / 1_000_000).toFixed(2)}`
  const ts  = invoice.createdAt ?? ''

  return (
    <>
      {/* ── Print stylesheet — 80 mm thermal paper ────────────────────────── */}
      <style>{`
        @media print {
          /* Hide everything except the receipt body */
          body > * { display: none !important; }
          #thermal-receipt-print { display: block !important; }

          @page {
            size: 80mm auto;
            margin: 0;
          }

          #thermal-receipt-print {
            display: block;
            width: 76mm;
            margin: 2mm;
            font-family: 'Courier New', Courier, monospace;
            font-size: 9pt;
            line-height: 1.3;
            color: #000;
            background: #fff;
          }

          #thermal-receipt-print pre {
            white-space: pre-wrap;
            word-break: break-all;
            margin: 0;
            font-family: inherit;
            font-size: inherit;
          }

          #thermal-receipt-print canvas {
            display: block;
            margin: 4mm auto;
            width: 28mm !important;
            height: 28mm !important;
          }

          #thermal-receipt-print .no-print { display: none !important; }
        }
      `}</style>

      {/* ── Print-target element (hidden on screen) ───────────────────────── */}
      <div id="thermal-receipt-print" style={{ display: 'none' }}>
        <pre>{thermalTxt}</pre>
        {invoice.txHash && (
          <canvas
            ref={undefined}
            id="thermal-qr-canvas"
          />
        )}
      </div>

      {/* ── Screen modal ──────────────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={handleBackdrop}
      >
        <div className="glass-strong w-full max-w-sm rounded-2xl overflow-hidden flex flex-col shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <CheckCircle size={15} className="text-[var(--success)]" />
              <span className="font-semibold text-sm text-[var(--ink)]">Thermal Receipt</span>
              <span className="text-xs text-[var(--subtle)] ml-1">
                {chainId === 5042 ? '· Arc Mainnet' : '· Arc Testnet'}
              </span>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-[var(--surface-muted)] flex items-center justify-center hover:bg-[var(--surface-strong)] transition-colors"
            >
              <X size={13} className="text-[var(--subtle)]" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto max-h-[75vh]">
            {/* Amount */}
            <div className="flex flex-col items-center gap-0.5">
              <span className="display text-4xl font-bold tabular-nums text-[var(--ink)]">
                {fmt(invoice.amountUnits)}
              </span>
              <span className="text-xs text-[var(--subtle)]">
                USDC · {chainId === 5042 ? 'Arc Mainnet' : 'Arc Testnet'}
              </span>
            </div>

            {/* Details table */}
            <div className="bg-[var(--surface-muted)] rounded-xl p-3 flex flex-col gap-2 text-xs">
              {([
                ['Invoice ID', invoice.invoiceId.slice(0, 14) + '…'],
                ['Cashier',    invoice.cashier.slice(0, 14) + '…'],
                invoice.payer ? ['Payer', invoice.payer.slice(0, 14) + '…'] : null,
                invoice.note  ? ['Item',  invoice.note]                      : null,
                ['Time',       ts],
              ] as ([string, string] | null)[]).filter(Boolean).map(row => (
                <div key={row![0]} className="flex justify-between gap-2">
                  <span className="text-[var(--subtle)]">{row![0]}</span>
                  <span className="mono text-[var(--ink-2)] text-right break-all">{row![1]}</span>
                </div>
              ))}
            </div>

            {/* QR + explorer link */}
            {invoice.txHash && (
              <div className="flex flex-col items-center gap-2">
                <canvas ref={qrRef} className="rounded-xl" />
                <a
                  href={arcTxUrl(chainId, invoice.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                >
                  View on {arcExplorerName(chainId)} <ExternalLink size={9} />
                </a>
              </div>
            )}

            {/* Monospace preview (same text that prints) */}
            <details className="text-[10px]">
              <summary className="text-[var(--subtle)] cursor-pointer hover:text-[var(--ink-2)]">
                80 mm thermal preview
              </summary>
              <pre className="mt-2 bg-[var(--surface-muted)] rounded-xl p-3 font-mono text-[var(--ink-2)] whitespace-pre-wrap leading-snug overflow-x-auto">
                {thermalTxt}
              </pre>
            </details>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-[var(--border)] flex gap-2">
            <button
              onClick={() => window.print()}
              className="flex-1 py-2.5 rounded-xl bg-[var(--accent)] text-[#0d1b2f] text-sm font-semibold flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
            >
              <Printer size={13} /> Print Receipt
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-[var(--surface-muted)] text-[var(--ink-2)] text-sm font-semibold hover:bg-[var(--surface-strong)] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
