# RegisterGuard POS

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Non-custodial retail POS system on Arc. Accepts USDC payments (direct approve+pay or offline EIP-3009 authorization). Every payment atomically splits funds into 4 streams: owner savings vault (25%), working capital wallet (60%), supplier escrow (10%), refund buffer (5%). Cashier can issue direct refunds or create CEX-safe claimable refund QRs. Owner treasury panel shows live balances and controls split config, cashier policies, and supplier escrow releases.

## Deployed Contracts

### RegisterGuardPOS (Arc Testnet — current default fallback)
- **Address**: `0x24ba037490c956ff4a75d9efd37c5c171cc4d27f`
- **Explorer**: https://explorer.testnet.arc.io/address/0x24ba037490c956ff4a75d9efd37c5c171cc4d27f
- **Deploy tx**: `0x0d3034a92e8ce53f6f604dcd623d88fbee5552873231dc63904ea784d8ec884e`
- **Constructor**: USDC=0x3600…0000, initialOwner/savings/workingCap=deployer wallet, BPS=2500/6000/1000/500, maxBuffer=50000000 (50 USDC)

### RegisterGuardPOS (Arc Testnet — previous deploy)
- **Address**: `0x66bdda835c3f71b6dbf15e49fc67d7b3eccedded`
- **Explorer**: https://explorer.testnet.arc.io/address/0x66bdda835c3f71b6dbf15e49fc67d7b3eccedded

### RegisterGuardPOS (Arc Mainnet)
- **Address**: Not yet deployed — deploy from your own wallet on Chain ID 5042 then uncomment the fallback in `src/utils/contractStorage.ts`

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
