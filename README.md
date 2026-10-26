# 🛡️ RegisterGuard POS

**Non-Custodial Retail Point-of-Sale & Automated 4-Way Treasury Router on Arc Mainnet**

[![Live Demo](https://img.shields.io/badge/Demo-Live%20on%20Vercel-success?style=for-the-badge&logo=vercel)](https://register-guard-pos-arc.vercel.app/)
[![Arc Mainnet](https://img.shields.io/badge/Chain-Arc%20Mainnet%20(5042)-blue?style=for-the-badge)](https://explorer.arc.io/address/0xc385c48906A0f5CC3dD3C4D02378c145FC8764Be?tab=index)
[![Demo Video](https://img.shields.io/badge/Video-Watch%20Demo-red?style=for-the-badge&logo=youtube)](https://youtu.be/xUEu0Dceco8)

RegisterGuard POS is a commercial-grade, smart-contract-powered Point-of-Sale terminal built for **Arc Mainnet (`Chain ID: 5042`)** using native **USDC (`0x3600000000000000000000000000000000000000`)**. It enables physical and digital merchants to accept sub-second USDC payments with automatic on-chain treasury splitting, offline dead-zone signing (`EIP-3009`), and fraud-proof cashier refund workflows—all without giving store employees custody over merchant vaults.

---

## 🔗 Live Deployments & Verified Contracts

* **Live Web App:** [ard-pos-arc.vercel.app](https://register-guard-pos-arc.vercel.app/)
* **RegisterGuard POS Contract (Arc Mainnet):** [`0xc385c48906A0f5CC3dD3C4D02378c145FC8764Be`](https://explorer.arc.io/address/0xc385c48906A0f5CC3dD3C4D02378c145FC8764Be)
* **Native USDC Token Address:** [`0x3600000000000000000000000000000000000000`](https://explorer.arc.io/token/0x3600000000000000000000000000000000000000)
* **Demo Video:** [Watch on YouTube](https://youtu.be/xUEu0Dceco8)

---

## 🚨 The Retail Crypto Problem

Traditional crypto POS solutions fail in real brick-and-mortar environments because of four critical vulnerabilities:
1. **Manual Treasury Accounting:** Merchants receive 100% of revenue into a single hot wallet and must manually calculate and transfer percentages for taxes/savings, restocking, and operating expenses.
2. **Cashier Refund Fraud:** Giving a store clerk the private key to issue refunds allows them to drain the store's entire revenue balance or route fake refunds to personal wallets.
3. **CEX Payer Refund Loss:** If a customer pays an invoice directly from a centralized exchange withdrawal (e.g., Binance or Coinbase), a standard "return-to-sender" refund sends the USDC into the exchange's hot wallet pool, permanently losing the customer's funds.
4. **Dead-Zone Connectivity:** Unreliable customer mobile data inside brick-and-mortar shops stalls checkout queues.

---

## ✨ Key Features & Architecture

### 1. Atomic 4-Way Treasury Split (`payInvoice` & `payInvoiceWithAuthorization`)
Every customer checkout is atomically split on-chain in the exact same transaction according to configurable Basis Points (`BPS`):
- **🏦 Owner Savings Vault (Default 25% - 2500 BPS):** Immediately routed off-contract to the owner's cold/multisig vault.
- **⚡ Working Capital Wallet (Default 60% - 6000 BPS):** Immediately routed to the merchant's operating wallet.
- **🚚 Supplier Escrow (Default 10% - 1000 BPS):** Held safely on-contract in `supplierEscrowBalance` for verifiable supplier invoice settlements.
- **🛡️ Cashier Refund Buffer (Default 5% - 500 BPS):** Held on-contract in `refundBufferBalance` (up to `maxRefundBuffer`) to fund day-to-day customer refunds without exposing the owner's vaults.

### 2. Dual Scoped Cashier Refunds (Anti-Theft + CEX-Safe)
Store owners authorize cashier wallets with strict daily USDC allowances (`setCashier`) and zero access to Savings or Working Capital:
- **Direct Refund (`issueDirectRefund`):** Pulls solely from the on-contract `Refund Buffer` and enforces on-chain that USDC can **only** return to the original `invoice.payer` address—making it mathematically impossible for a cashier to divert store refunds to their own wallet.
- **CEX-Safe Claimable Refund QR (`createClaimableRefund` & `claimRefund`):** For customers who paid via an exchange or need funds sent to a new wallet, the cashier locks the refund into an on-chain `keccak256` secret-hash escrow and prints a Claim QR code. The customer scans the QR to sweep the USDC to any destination wallet they choose.

### 3. Offline / Dead-Zone Checkout (`EIP-3009 ReceiveWithAuthorization`)
When a customer has zero cell reception inside a store:
- The customer wallet signs an offline **EIP-712 `ReceiveWithAuthorization`** payload (`0 Gas` required from the customer).
- The customer displays the signed QR to the cashier terminal, which relays the signature to Circle's native Mainnet `FiatTokenV2_2` contract via `payInvoiceWithAuthorization`, settling the payment and executing the 4-way split in `<0.5s`.

### 4. Role-Separated Split-Screen UI & On-Chain Thermal Receipts
- **Cashier Terminal (Left Pane):** Features Mainnet micro-presets (`$0.10`, `$0.25`, `$0.50`, `$1.00`), dynamic QR generation, real-time 4-way split visualizations, POS audio confirmation chimes, 1-click auto-filled refund pills, and printable thermal receipts.
- **Customer Wallet (Right Pane):** Clean consumer checkout view (hiding internal merchant treasury percentages) with Online & Offline signing modes and customer thermal receipts with direct verification links to `https://explorer.arc.io`.
- **Owner Treasury Console:** Full administrative dashboard for live bucket balances, BPS reconfiguration, cashier permissioning, and supplier escrow releases.

---

## 🌐 Network & Contract Configuration

| Parameter | Arc Mainnet (Primary) | Arc Testnet |
| :--- | :--- | :--- |
| **Network Name** | Arc Mainnet | Arc Testnet |
| **Chain ID** | `5042` | `5042002` |
| **RPC URL** | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| **POS Contract Address** | `0xc385c48906A0f5CC3dD3C4D02378c145FC8764Be` | Configurable |
| **Native USDC Address** | `0x3600000000000000000000000000000000000000` | `0x3600000000000000000000000000000000000000` |
| **Block Explorer** | [explorer.arc.io](https://explorer.arc.io) | [testnet.arcscan.app](https://testnet.arcscan.app) |

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- **Node.js** `v18+` and `npm`
- **Rabby Wallet** or MetaMask configured for **Arc Mainnet (`Chain ID: 5042`)**

### Installation & Run
```bash
# 1. Clone the repository
git clone [https://github.com/Reelmemory/RegisterGuard-POS.git](https://github.com/Reelmemory/RegisterGuard-POS.git)
cd RegisterGuard-POS

# 2. Install dependencies (using legacy peer deps for SDK parity)
npm install --legacy-peer-deps

# 3. Start the local Vite development server
npm run dev
