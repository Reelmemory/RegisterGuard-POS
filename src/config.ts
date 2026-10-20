/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet, arc } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arc.id, arc.rpcUrls.default.http[0])

export const ARC_MAINNET_ID  = arc.id       // 5042
export const ARC_TESTNET_ID  = arcTestnet.id // 5042002

export const config = createConfig({
  chains: [arc, arcTestnet, mainnet], // Arc Mainnet first = default chain for new wallets
  connectors: [injected()],
  transports: {
    [arc.id]:        http(),
    [arcTestnet.id]: http(),
    [mainnet.id]:    http(), // ENS resolution uses mainnet
  },
})
