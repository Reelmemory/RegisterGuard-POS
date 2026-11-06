# 🛡️ RegisterGuard POS

**Non-custodial retail Point-of-Sale + automated 4-way treasury router on Arc Mainnet.**

Accept USDC payments in-store or online, automatically split revenue on-chain, and protect against cashier refund fraud — without ever giving employees custody of the merchant vault.

---

## Live Demo

<<<<<<< HEAD
* **Live Web App:** [ard-pos-arc.vercel.app](https://register-guard-pos-arc.vercel.app/)
* **RegisterGuard POS Contract (Arc Mainnet):** [`0xc385c48906A0f5CC3dD3C4D02378c145FC8764Be`](https://explorer.arc.io/address/0xc385c48906A0f5CC3dD3C4D02378c145FC8764Be)
* **Native USDC Token Address:** [`0x3600000000000000000000000000000000000000`](https://explorer.arc.io/token/0x3600000000000000000000000000000000000000)
* **Demo Video:** [Watch on YouTube](https://youtu.be/xUEu0Dceco8)
=======
| Link | Description |
|------|-------------|
| **Live App** | [register-guard-pos-arc.vercel.app](https://register-guard-pos-arc.vercel.app/) |
| **Demo Video** | [Watch on YouTube](https://youtu.be/xUEu0Dceco8) |
| **Contract (Arc Mainnet)** | [`0xc385c48906A0f5CC3dD3C4D02378c145FC8764Be`](https://explorer.arc.io/address/0xc385c48906A0f5CC3dD3C4D02378c145FC8764Be) |
>>>>>>> 054e145 (Improve README for clarity and judge experience)

---

## Judge’s 60-Second Path

1. Open the live app and connect a wallet on **Arc Mainnet (Chain ID 5042)**.
2. Switch to **Cashier Terminal** view.
3. Create a small invoice (use the micro-presets: $0.10 / $0.25 / $0.50).
4. Pay it (or simulate payment).
5. Watch the **4-way treasury split** happen on-chain in real time.
6. Try the **refund flow** — notice the cashier cannot drain the full vault.
7. (Optional) Test the **offline / EIP-3009** signing path if available in the UI.

---

## The Problem

Most crypto POS systems break in real retail environments:

- Merchants receive 100% of revenue into one hot wallet and must manually split it for tax, restocking, and operating expenses.
- Giving a cashier the private key for refunds creates massive fraud risk.
- Customers who pay from a centralized exchange often lose refunds forever (funds go to the exchange’s hot wallet).
- Unreliable mobile data inside stores makes normal wallet signing fail.

RegisterGuard solves these problems with on-chain rules instead of trusting people.

---

## How It Works

### 1. Automatic 4-Way Treasury Split
Every payment is automatically routed on-chain into four buckets (configurable in basis points):
- Operating expenses
- Tax / savings
- Restocking / inventory
- Owner profit

No manual transfers required.

### 2. Role-Separated Permissions
- **Cashier** can only create invoices and process limited refunds.
- **Owner** controls treasury percentages, cashier permissions, and large withdrawals.
- Cashiers never have custody of the full merchant balance.

### 3. Offline / Dead-Zone Payments (EIP-3009)
Customers with no cell signal can still pay by signing an offline `ReceiveWithAuthorization`. The cashier terminal relays the signature and settles on Arc in under a second.

### 4. Safe Refunds
Refunds are constrained by policy so a cashier cannot empty the store’s revenue.

---

## Network Details

| Parameter | Value |
|-----------|-------|
| **Chain** | Arc Mainnet |
| **Chain ID** | `5042` |
| **Native USDC** | `0x3600000000000000000000000000000000000000` |
| **POS Contract** | `0xc385c48906A0f5CC3dD3C4D02378c145FC8764Be` |
| **Explorer** | [explorer.arc.io](https://explorer.arc.io) |
| **RPC** | `https://rpc.mainnet.arc.io` |

---

## Architecture (High Level)
Customer Wallet ──► Invoice (USDC) ──► RegisterGuard Contract
│
┌───────────────┼───────────────┐
▼               ▼               ▼
Operating         Tax/Savings     Restocking
│
└───────────────► Owner Profit


- Cashier UI and Customer UI are split separated
- All critical rules live in the smart contract
- Offline signing uses EIP-3009 (`ReceiveWithAuthorization`)

---

## Local Development

```bash
git clone https://github.com/Reelmemory/RegisterGuard-POS.git
cd RegisterGuard-POS
npm install --legacy-peer-deps
npm run dev

=======
Make sure your wallet (Rabby or MetaMask) is set to Arc Mainnet (Chain ID 5042).

Limitations (Honest)
Currently optimized for Arc Mainnet USDC only
Offline (EIP-3009) flow requires the customer wallet to support the necessary signing
Thermal receipt printing is simulated in the browser demo
Multi-store / multi-cashier enterprise features are still early

Built With
Arc Mainnet + native USDC
Solidity smart contracts
React + Vite frontend
EIP-3009 for offline authorizations
Vercel deployment
