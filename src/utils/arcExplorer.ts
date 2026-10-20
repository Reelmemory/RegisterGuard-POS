/** Arc-specific explorer helpers.
 *  Mainnet  (5042)    → https://explorer.arc.io
 *  Testnet  (5042002) → https://explorer.testnet.arc.io
 *  Other chains fall back to onchain-facts explorerBase.
 */
import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'

const ARC_MAINNET_ID  = 5042
const ARC_TESTNET_ID  = 5042002

function arcBase(chainId: number): string | null {
  if (chainId === ARC_MAINNET_ID)  return 'https://explorer.arc.io'
  if (chainId === ARC_TESTNET_ID)  return 'https://explorer.testnet.arc.io'
  return null
}

export function arcTxUrl(chainId: number, txHash: string): string {
  const base = arcBase(chainId)
  if (base) return `${base}/tx/${txHash}`
  return buildTxExplorerUrl(chainId, txHash)
}

export function arcAddressUrl(chainId: number, address: string): string {
  const base = arcBase(chainId)
  if (base) return `${base}/address/${address}`
  return buildAddressExplorerUrl(chainId, address)
}

export function arcExplorerName(chainId: number): string {
  if (chainId === ARC_MAINNET_ID)  return 'explorer.arc.io'
  if (chainId === ARC_TESTNET_ID)  return 'explorer.testnet.arc.io'
  return 'Explorer'
}
