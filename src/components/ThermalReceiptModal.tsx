/** "Thermal Receipt" modal shown after payment confirmation. */
import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { X, ExternalLink, CheckCircle } from 'lucide-react'
import type { Invoice } from '../types'
import { arcTxUrl, arcExplorerName } from '../utils/arcExplorer'

interface Props {
  invoice: Invoice
  onClose: () => void
}

export function ThermalReceiptModal({ invoice, onClose }: Props) {
  const qrRef = useRef<HTMLCanvasElement>(null)
  const chainId = invoice.chainId ?? 5042002

  useEffect(() => {
    if (qrRef.current && invoice.txHash) {
      void QRCode.toCanvas(qrRef.current, arcTxUrl(chainId, invoice.txHash), {
        width: 120,
        margin: 1,
        color: { dark: '#0d1b2f', light: '#f9faf3' },
      })
    }
  }, [invoice.txHash, chainId])

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  const fmt = (units: bigint) => `$${(Number(units) / 1_000_000).toFixed(2)}`
  const ts = invoice.createdAt ?? ''

  return (
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
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-[var(--surface-muted)] flex items-center justify-center hover:bg-[var(--surface-strong)] transition-colors"
          >
            <X size={13} className="text-[var(--subtle)]" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto max-h-[80vh]">
          {/* Amount */}
          <div className="flex flex-col items-center gap-0.5">
            <span className="display text-4xl font-bold tabular-nums text-[var(--ink)]">
              {fmt(invoice.amountUnits)}
            </span>
            <span className="text-xs text-[var(--subtle)]">USDC · Arc {chainId === 5042 ? 'Mainnet' : 'Testnet'}</span>
          </div>

          {/* Details table */}
          <div className="bg-[var(--surface-muted)] rounded-xl p-3 flex flex-col gap-2 text-xs">
            {[
              ['Invoice ID', invoice.invoiceId.slice(0, 14) + '…'],
              ['Cashier',    invoice.cashier.slice(0, 14) + '…'],
              invoice.payer ? ['Payer', invoice.payer.slice(0, 14) + '…'] : null,
              invoice.note  ? ['Note',  invoice.note]                      : null,
              ['Time',       ts],
            ].filter(Boolean).map(row => (
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
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-[var(--surface-muted)] text-[var(--ink-2)] text-sm font-semibold hover:bg-[var(--surface-strong)] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
