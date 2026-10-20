export interface RegisterGuardContract {
  address: `0x${string}`
  abi: readonly unknown[]
}

export interface Invoice {
  invoiceId: `0x${string}`
  amountUnits: bigint
  amountUsd: string
  note?: string
  cashier: `0x${string}`
  payer?: `0x${string}`
  txHash?: `0x${string}`
  chainId?: number
  createdAt?: string
}

export interface QRPayload {
  type: 'invoice'
  invoiceId: string
  contractAddress: string
  chainId: number
  amountUnits: string
  cashier: string
  note?: string
}

export interface EIP3009SignedPayload {
  type: 'eip3009_signed'
  invoiceId: string
  from: string
  amount: string
  validAfter: string
  validBefore: string
  nonce: `0x${string}`
  v: number
  r: `0x${string}`
  s: `0x${string}`
  cashier: string
  contractAddress: string
  chainId: number
}

export interface RefundClaimPayload {
  type: 'refund_claim'
  invoiceId: string
  amountUnits: string
  secret: string
  destination: `0x${string}`
  contractAddress: string
  chainId: number
  claimId: `0x${string}` | undefined
}
