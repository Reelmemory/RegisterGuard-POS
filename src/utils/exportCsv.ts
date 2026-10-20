import type { Invoice } from '../types'
import { arcTxUrl } from './arcExplorer'

/** Download all session paid invoices as a CSV file. */
export function exportSessionCsv(invoices: Invoice[]): void {
  if (invoices.length === 0) return

  const header = ['Timestamp', 'Invoice ID', 'Amount USD', 'Amount Units', 'Note', 'Cashier', 'Payer', 'Tx Hash', 'Explorer Link', 'Chain']
  const rows = invoices.map(inv => [
    inv.createdAt ?? '',
    inv.invoiceId,
    inv.amountUsd,
    inv.amountUnits.toString(),
    inv.note ?? '',
    inv.cashier,
    inv.payer ?? '',
    inv.txHash ?? '',
    inv.txHash ? arcTxUrl(inv.chainId ?? 5042, inv.txHash) : '',
    inv.chainId === 5042 ? 'Arc Mainnet' : 'Arc Testnet',
  ])

  const csvContent = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href     = url
  link.download = `registerguard-session-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
