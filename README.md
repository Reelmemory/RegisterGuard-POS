# 🛡️ RegisterGuard POS

**Non-custodial retail point-of-sale with an automated 4-way treasury router on Arc Mainnet.**

Accept USDC payments in-store or online, automatically distribute revenue on-chain, and reduce cashier refund abuse — without giving employees custody of the merchant treasury.

---

## 🚀 Live Demo

| Resource | Link |
|---|---|
| **Live App** | [Open RegisterGuard POS](https://register-guard-pos-arc.vercel.app/) |
| **Demo Video** | [Watch on YouTube](https://youtu.be/xUEu0Dceco8) |
| **Arc Mainnet Contract** | [View contract on Arc Explorer](https://explorer.arc.io/address/0xc385c48906A0f5CC3dD3C4D02378c145FC8764Be) |

---

## ⚡ Judge's 60-Second Path

1. Open the [live app](https://register-guard-pos-arc.vercel.app/) and connect a wallet configured for **Arc Mainnet (Chain ID 5042)**.
2. Switch to **Cashier Terminal** view.
3. Create a small invoice using one of the micro-presets: **$0.10, $0.25, or $0.50**.
4. Complete the payment or use the available simulation flow.
5. Inspect the **4-way treasury distribution** and its on-chain transactions.
6. Try the refund flow and observe the cashier's configured restrictions.
7. If available in the UI, explore the **EIP-3009 offline authorization** flow.

---

## 🎯 The Problem

Retail payment systems need to do more than accept money. Merchants also need control over how revenue is allocated, who can issue refunds, and how payments behave when connectivity is unreliable.

Common pain points include:
- **Manual treasury management:** Revenue lands in one wallet and must be manually divided for taxes, inventory, operating expenses, and profit.
- **Excessive cashier permissions:** Giving employees broad wallet access to process refunds creates avoidable security risks.
- **Refund complications:** Payments originating from centralized exchange wallets can make refunds difficult to route back to the end customer.
- **Unreliable connectivity:** Conventional wallet-signing flows can be interrupted by poor in-store mobile data.

RegisterGuard addresses these challenges with programmable smart-contract rules and role-separated permissions.

---

## ⚙️ How It Works

### 1. Automatic 4-Way Treasury Split

Each payment is routed into four configurable treasury allocations, defined in basis points:
- **Operating expenses**
- **Tax / savings**
- **Restocking / inventory**
- **Owner profit**

The contract applies the configured distribution on-chain, reducing the need for manual transfers.

### 2. Role-Separated Permissions

- **Cashier:** Creates invoices and processes refunds within configured limits.
- **Owner:** Manages treasury percentages, cashier permissions, and privileged withdrawals.
- **Treasury protection:** Cashier permissions do not grant unrestricted control over the merchant's full balance.

### 3. Offline / Dead-Zone Payments (EIP-3009)

RegisterGuard includes an EIP-3009 `ReceiveWithAuthorization` payment path. A customer signs a payment authorization, which the cashier terminal can relay for settlement on Arc. This is designed to support payment flows when customer connectivity is limited and requires a compatible wallet and valid authorization.

### 4. Policy-Constrained Refunds

Refunds are subject to contract-level restrictions so a cashier cannot independently withdraw or refund the entire merchant treasury.

---

## 🏗️ Architecture

```text
                 Customer Wallet
                        |
                        | USDC payment / EIP-3009 authorization
                        v
                 Cashier Terminal
                        |
                        | Invoice and payment request
                        v
              RegisterGuard Contract
                        |
          +-------------+-------------+
          |             |             |
          v             v             v
      Operating     Tax / Savings  Restocking
      Expenses                         |
          |                            |
          +-------------+--------------+
                        |
                        v
                   Owner Profit
```

- Cashier and customer interfaces are separated.
- Critical payment, allocation, and permission rules are enforced by the smart contract.
- Offline authorization uses EIP-3009 (`ReceiveWithAuthorization`).

---

## 🌐 Network Details

| Parameter | Value |
|---|---|
| **Network** | Arc Mainnet |
| **Chain ID** | `5042` |
| **Native USDC** | `0x3600000000000000000000000000000000000000` |
| **POS Contract** | `0xc385c48906A0f5CC3dD3C4D02378c145FC8764Be` |
| **RPC** | `https://rpc.mainnet.arc.io` |
| **Explorer** | [explorer.arc.io](https://explorer.arc.io) |

---

## 💻 Local Development

### Prerequisites

- Node.js
- npm
- MetaMask or Rabby (for wallet interactions)
- Foundry (if building or testing the Solidity contracts)
- Bun (for the repository's Bun-based deployment scripts)

### Installation

```bash
git clone https://github.com/Reelmemory/RegisterGuard-POS.git
cd RegisterGuard-POS
npm install --legacy-peer-deps
npm run dev
```

Vite will print the local development URL in your terminal. To interact with the Arc Mainnet deployment, configure your wallet for **Arc Mainnet (Chain ID 5042)**.

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite development server |
| `npm run build` | Build the frontend for production |
| `npm run typecheck` | Run the TypeScript type check |
| `npm run check` | Run the repository check script |
| `npm run contracts:build` | Compile the smart contracts with Foundry |
| `npm run contracts:test` | Run the Foundry contract tests |

---

## ⚠️ Limitations

- The current deployment is optimized for **Arc Mainnet and USDC**.
- The EIP-3009 authorization flow requires a compatible customer wallet.
- Thermal receipt printing is simulated in the browser demo.
- Multi-store and enterprise-scale cashier management capabilities are still early-stage.

---

## 🧰 Built With

- **Network:** Arc Mainnet
- **Settlement asset:** USDC
- **Smart contracts:** Solidity, Foundry, OpenZeppelin Contracts
- **Frontend:** React, Vite, TypeScript
- **Blockchain integration:** viem, wagmi, ConnectKit
- **Wallet infrastructure:** Circle wallet SDK packages
- **UI:** Tailwind CSS, Framer Motion, Lucide
- **Deployment:** Vercel

---

## 🔐 Security

RegisterGuard is designed around least-privilege access. Cashiers receive permissions for point-of-sale operations, while owner-level treasury controls remain separate. Payment distribution and refund restrictions are enforced by smart-contract logic rather than relying solely on frontend checks.

Smart-contract systems can still contain vulnerabilities. This README is not a security audit; review the contract implementation and verify the deployed contract before using the system with production funds.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).