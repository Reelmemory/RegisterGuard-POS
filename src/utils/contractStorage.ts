/** Per-chain contract address persistence in localStorage. */

const KEY = (chainId: number) => `rg_contract_${chainId}`

// ─── Permanent fallback addresses ────────────────────────────────────────────
// These are loaded when localStorage has no user-saved address for that chain.
// Arc Testnet: latest deploy from Arc Studio.
// Arc Mainnet: set this once you deploy from your own wallet on Chain ID 5042.
const FALLBACK_ADDRESSES: Record<number, string> = {
  5042002: '0x24ba037490c956ff4a75d9efd37c5c171cc4d27f', // Arc Testnet — deployed by Arc Studio
  // 5042: '0x<YOUR_MAINNET_ADDRESS>',                 // Arc Mainnet — deploy from your wallet then uncomment
}

export function loadContractAddress(chainId: number): string {
  return localStorage.getItem(KEY(chainId)) ?? FALLBACK_ADDRESSES[chainId] ?? ''
}

export function saveContractAddress(chainId: number, address: string): void {
  localStorage.setItem(KEY(chainId), address)
}

export function clearContractAddress(chainId: number): void {
  localStorage.removeItem(KEY(chainId))
}
