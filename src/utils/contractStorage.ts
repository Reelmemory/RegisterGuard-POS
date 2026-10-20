/** Per-chain contract address persistence in localStorage. */
const KEY = (chainId: number) => `rg_contract_${chainId}`

export function loadContractAddress(chainId: number): string {
  return localStorage.getItem(KEY(chainId)) ?? ''
}

export function saveContractAddress(chainId: number, address: string): void {
  localStorage.setItem(KEY(chainId), address)
}

export function clearContractAddress(chainId: number): void {
  localStorage.removeItem(KEY(chainId))
}
