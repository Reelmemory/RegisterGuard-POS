# RegisterGuard: Autonomous Retail POS, Programmable Cash-Flow & Offline EIP-3009 Relay on Arc

## 1. Executive Summary
**RegisterGuard** is a non-custodial physical-store Point-of-Sale (POS) and automated cash-flow protocol built on **Arc** using native **USDC**. 

Existing crypto QR checkouts fail in real brick-and-mortar stores for three operational reasons:
1. **The Cashier vs. Owner Security Gap:** Store owners cannot share their master private keys with cashiers. Consequently, cashiers cannot safely verify payments or issue customer refunds at the register.
2. **CEX Payer Refund Loss:** If a customer pays an invoice from a centralized exchange (CEX) or cross-chain relayer and an item is out of stock, refunding `msg.sender` sends funds back to the exchange's hot wallet—permanently losing the customer's money.
3. **Counter Dead-Zones & Manual Treasury Splits:** Customers frequently lose mobile internet inside concrete supermarkets, and merchants in high-inflation markets must manually divide revenue between USD savings, supplier restock reserves, and local working capital.

**RegisterGuard solves all three in a single atomic transaction on Arc (`<0.5s` finality, `~$0.01` USDC gas):**
- **Atomic 4-Way Treasury Waterfall:** Every checkout automatically splits incoming USDC between the **Owner Cold USD Vault**, **Working Capital Wallet**, **Supplier Restock Escrow**, and an on-contract **Cashier Refund Reserve Buffer**.
- **Scoped Cashier Roles & CEX-Safe Claim QR Refunds:** Cashiers receive a restricted role (`CASHIER_ROLE`) with a strict daily refund cap (`dailyRefundLimit`) that can only draw from the Refund Reserve Buffer. Cashiers can generate a **1-Scan Refund Claim QR** (`keccak256` secret escrow) allowing the customer to sweep refunded USDC to *any* fresh wallet address.
- **Offline Customer EIP-3009 QR Relay:** Using Circle's `FiatTokenV2_2` (`receiveWithAuthorization`) on Arc's ERC-20 USDC interface, an offline customer signs a zero-gas EIP-712 authorization QR code on their phone, and the cashier's online POS terminal broadcasts it to Arc.

---

## 2. Critical Arc Network & Token Architecture
All smart contracts, tests, and frontend hooks MUST adhere strictly to Arc's dual-decimal architecture:

| Parameter | Arc Mainnet (Production Demo) | Arc Testnet (Sandbox Default) |
| :--- | :--- | :--- |
| **Network Name** | Arc Mainnet | Arc Testnet |
| **Chain ID** | `5042` | Configured by Arc Studio Sandbox |
| **RPC Endpoint** | `https://rpc.mainnet.arc.io` | Sandbox Default RPC |
| **Block Explorer** | `https://explorer.arc.io` | Testnet Explorer |
| **Official ERC-20 USDC (6 Decimals)** | `0x3600000000000000000000000000000000000000` | `0x3600000000000000000000000000000000000000` |

### Mandatory Decimal & Interface Rules:
1. **ALWAYS use the 6-decimal ERC-20 interface (`0x3600000000000000000000000000000000000000`)** for all smart contract token math, `transfer`, `transferFrom`, and EIP-3009 `receiveWithAuthorization` calls (`1.00 USDC = 1_000_000` units).
2. **NEVER confuse native 18-decimal gas accounting with 6-decimal ERC-20 token amounts.** Use `parseUnits(amount, 6)` and `formatUnits(amount, 6)` across the entire frontend and test suite.

---

## 3. Smart Contract Specification (`contracts/RegisterGuardPOS.sol`)

### 3.1 Interfaces Required
Define `IFiatTokenV2_2` supporting standard ERC-20 functions plus EIP-3009:
```solidity
interface IFiatTokenV2_2 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
```

### 3.2 State Variables & Structs
- `IFiatTokenV2_2 public immutable usdc;` (Initialized to `0x3600000000000000000000000000000000000000`, or configurable mock address in unit tests).
- `address public owner;`
- **Split Configuration (`SplitConfig`):**
  - `address ownerSavingsVault;`
  - `address workingCapitalWallet;`
  - `uint16 savingsBps;` (e.g., `2500` = 25%)
  - `uint16 workingCapitalBps;` (e.g., `6000` = 60%)
  - `uint16 supplierEscrowBps;` (e.g., `1000` = 10%)
  - `uint16 refundBufferBps;` (e.g., `500` = 5%)
  - `uint256 maxRefundBuffer;` (Cap in 6-decimal USDC, e.g., `50_000_000` = $50.00 USDC. If `refundBufferBalance` reaches `maxRefundBuffer`, the refund buffer share automatically overflows into `workingCapitalWallet`).
  - *Constraint:* `savingsBps + workingCapitalBps + supplierEscrowBps + refundBufferBps == 10000`.
- **Internal Pool Accounting:**
  - `uint256 public refundBufferBalance;`
  - `uint256 public supplierEscrowBalance;`
- **Scoped Cashier Registry (`mapping(address => CashierPolicy) public cashiers`):**
  - `bool active;`
  - `uint256 dailyRefundLimit;` (in 6-decimal USDC, e.g., `30_000_000` = $30.00)
  - `uint256 refundedToday;`
  - `uint256 lastResetDay;` (`block.timestamp / 1 days`)
- **Invoice & Claimable Refund Tracking:**
  - `mapping(bytes32 => InvoiceRecord) public invoices;` (`payer`, `cashier`, `amount`, `refundedAmount`, `timestamp`, `paid`)
  - `mapping(bytes32 => RefundClaim) public refundClaims;` (`invoiceId`, `amount`, `claimHash`, `expiry`, `claimed`, `createdByCashier`)

### 3.3 Core Functions to Implement
1. **`setSplitConfig(...)` (onlyOwner):** Updates wallet destinations, basis points (validating sum == 10000), and `maxRefundBuffer`.
2. **`setCashier(address cashier, bool active, uint256 dailyRefundLimit)` (onlyOwner):** Grants or revokes cashier POS permissions without exposing owner keys.
3. **`payInvoice(bytes32 invoiceId, uint256 amount, address cashier)`:**
   - Pulls `amount` from `msg.sender` via `usdc.transferFrom(msg.sender, address(this), amount)`.
   - Calls internal `_distributeSplit(invoiceId, msg.sender, amount, cashier)`.
4. **`payInvoiceWithAuthorization(...)`:**
   - Accepts `(bytes32 invoiceId, address from, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s, address cashier)`.
   - Calls `usdc.receiveWithAuthorization(from, address(this), amount, validAfter, validBefore, nonce, v, r, s)` so `to == address(this)` is enforced against front-running.
   - Calls internal `_distributeSplit(invoiceId, from, amount, cashier)`.
5. **`_distributeSplit(bytes32 invoiceId, address payer, uint256 amount, address cashier)` (Internal):**
   - Calculates exact shares for `savingsAmount`, `workingCapAmount`, `supplierAmount`, and `bufferAmount`.
   - If `refundBufferBalance + bufferAmount > maxRefundBuffer`, caps the addition to `maxRefundBuffer` and adds the excess to `workingCapAmount`.
   - Updates `refundBufferBalance` and `supplierEscrowBalance`.
   - Transfers `savingsAmount` directly to `ownerSavingsVault` and `workingCapAmount` directly to `workingCapitalWallet` in the same transaction.
   - Records `invoices[invoiceId]` and emits `InvoicePaid(...)`.
6. **`issueDirectRefund(bytes32 invoiceId, address recipient, uint256 amount)` (onlyOwnerOrActiveCashier):**
   - Verifies invoice was paid and `invoice.refundedAmount + amount <= invoice.amount`.
   - Enforces cashier's rolling 24h `dailyRefundLimit` and deducts `amount` from `refundBufferBalance`.
   - Transfers `amount` USDC to `recipient` and emits `DirectRefundIssued(...)`.
7. **`createClaimableRefund(bytes32 invoiceId, uint256 amount, bytes32 claimHash)` (onlyOwnerOrActiveCashier) -> returns `bytes32 claimId`:**
   - Enforces cashier's `dailyRefundLimit` and invoice refund cap.
   - Deducts `amount` from `refundBufferBalance` and locks it into `refundClaims[claimId]` with `claimHash = keccak256(abi.encodePacked(secret))` and `expiry = block.timestamp + 24 hours`.
   - Emits `RefundClaimCreated(claimId, invoiceId, amount, expiry, msg.sender)`.
8. **`claimRefund(bytes32 claimId, string calldata secret, address destination)` (Public / Anyone with secret):**
   - Verifies `!claim.claimed`, `block.timestamp <= claim.expiry`, and `keccak256(abi.encodePacked(secret)) == claim.claimHash`.
   - Marks `claimed = true` and transfers `claim.amount` USDC to `destination`. Emits `RefundClaimed(claimId, destination, claim.amount)`.
9. **`reclaimExpiredRefund(bytes32 claimId)` (onlyOwnerOrActiveCashier):**
   - If `block.timestamp > claim.expiry` and `!claim.claimed`, returns `claim.amount` back to `refundBufferBalance`.
10. **`releaseSupplierEscrow(address supplier, uint256 amount, string calldata invoiceRef)` (onlyOwner):**
    - Deducts `amount` from `supplierEscrowBalance` and transfers USDC to `supplier`. Emits `SupplierPaid(supplier, amount, invoiceRef)`.

---

## 4. Automated Smart Contract Unit Tests
Write a complete test suite (`test/RegisterGuardPOS.t.sol` or `test/RegisterGuardPOS.test.ts`) using a MockFiatTokenV2_2 (6 decimals + EIP-3009 `receiveWithAuthorization`) that verifies:
1. **Exact 4-Way Atomic Split:** A `10_000_000` ($10.00 USDC) payment splits into $2.50 Owner Vault, $6.00 Working Capital, $1.00 Supplier Escrow, and $0.50 Refund Buffer.
2. **Refund Buffer Cap Overflow:** When `refundBufferBalance` is already at `maxRefundBuffer`, 100% of the buffer allocation overflows into `workingCapitalWallet`.
3. **Offline EIP-3009 Authorization Relay:** Customer signs an EIP-712 `ReceiveWithAuthorization` digest offline; Cashier relays it via `payInvoiceWithAuthorization` and settles the invoice.
4. **Cashier Daily Limit Guardrail:** Cashier can refund up to `dailyRefundLimit`, and a refund exceeding the daily limit reverts with `ExceedsDailyRefundLimit()`.
5. **CEX-Safe Claimable Refund Lifecycle:** Cashier creates a claimable refund with a secret hash; a brand-new unlinked wallet calls `claimRefund` with the plaintext secret and receives the USDC.

---

## 5. Frontend Specification: Split-Screen "Live Store Simulator" & In-Browser Mainnet Deployer
Build a responsive Next.js + Tailwind CSS + `viem` application designed to be **100% demoable on a single laptop screen in under 2 minutes**.

### 5.1 Top Navigation Bar
- **Network Switcher Pill:** Allows switching between **Arc Mainnet (`Chain ID 5042`, `https://rpc.mainnet.arc.io`)** and **Arc Testnet**, displaying the active contract address (persisted in `localStorage` and URL `?contract=0x...`) and live 6-decimal USDC balance of the connected wallet.
- **View Mode Toggle:**
  - **"Split-Screen Demo Mode" (Default on Desktop):** Shows the **Cashier POS Terminal** on the left half of the screen and the **Customer Mobile Wallet Simulator** on the right half so judges can watch QR generation, offline signing, and instant settlement side-by-side without needing two physical devices.
  - **"Owner Treasury & Mainnet Setup" Tab:** Full-screen view for deploying a new `RegisterGuardPOS` instance on Arc Mainnet directly from the browser (`walletClient.deployContract`), configuring basis-point splits, managing Cashier permissions, and releasing Supplier Escrow.

### 5.2 Left Pane: Cashier POS Terminal (`CASHIER_ROLE`)
- **Register Keypad / Invoice Creator:**
  - Input USD amount (e.g., `$1.00`), optional item note (e.g., `"2x Cold Brew Coffee"`), and click **"Generate Dynamic QR"**.
  - Renders a scannable QR code containing `{ invoiceId, contractAddress, chainId, amountUnits, cashier }` PLUS a one-click **"Send QR to Customer Pane →"** button for single-screen demos.
- **Offline Customer QR Scanner / Relayer:**
  - Accepts an offline customer's signed EIP-3009 QR payload (via camera scan OR populated automatically when the customer clicks "Show Signed QR to Cashier").
  - Button: **"Broadcast Offline Signature to Arc (<0.5s)"** -> calls `payInvoiceWithAuthorization(...)` and plays a visual/audio confirmation banner with a direct link to `https://explorer.arc.io/tx/<hash>`.
- **Recent Receipts & 1-Click Scoped Refunds:**
  - Lists paid invoices with two action buttons per receipt:
    1. **"Direct Refund"** (sends USDC back to payer address).
    2. **"CEX-Safe Claim QR Refund"** (generates a random secret, submits `createClaimableRefund` onchain, and displays a **Refund Claim QR** + **"Pass Claim QR to Customer Pane →"** button).

### 5.3 Right Pane: Customer Mobile Wallet View
- **Active Invoice Display:** Shows the scanned merchant invoice amount and breakdown.
- **Connectivity Mode Toggle:**
  - **Online Mode (Standard):** Clicking **"Pay Now with USDC"** approves/calls `payInvoice(...)` directly on Arc.
  - **Offline / Dead-Zone Mode (EIP-3009):** Clicking **"Sign Offline QR (0 Gas)"** uses `walletClient.signTypedData` to sign an EIP-3009 `ReceiveWithAuthorization` message locally *without* broadcasting an RPC transaction. Displays the signed QR code and a **"Show Signed QR to Cashier →"** button.
- **Refund Claim Scanner:**
  - When a Cashier generates a CEX-Safe Refund Claim QR, the customer can enter *any* destination address, click **"Sweep Refund with QR Secret"**, and execute `claimRefund(...)` on Arc.

### 5.4 Owner Treasury & Mainnet Setup Tab (`OWNER_ROLE`)
- **1-Click In-Browser Mainnet Deployer Card:** Embeds compiled `RegisterGuardPOS` ABI and bytecode so the user can deploy a live contract to Arc Mainnet (`Chain ID 5042`) directly from their browser wallet (`walletClient.deployContract`).
- **Live Metric Cards (in 6-decimal USDC):**
  - **Owner Savings Vault Balance**
  - **Working Capital Wallet Balance**
  - **On-Contract Refund Buffer (`refundBufferBalance / maxRefundBuffer`)**
  - **On-Contract Supplier Escrow (`supplierEscrowBalance`)**
- Interactive sliders/inputs to update the 4-way basis point split (`setSplitConfig`), add/update a Cashier's `dailyRefundLimit` (`setCashier`), and release Supplier Escrow (`releaseSupplierEscrow`).

---

## 6. Mainnet Deployment & DoraHacks Verification Checklist
To satisfy the **30% "Real USDC moving on Arc Mainnet"** judging requirement:
1. Include a deployment script (`scripts/deploy-mainnet.ts` or Foundry `DeployMainnet.s.sol`) configured for:
   - RPC: `https://rpc.mainnet.arc.io`
   - Chain ID: `5042`
   - USDC Address: `0x3600000000000000000000000000000000000000`
2. After deploying to Arc Mainnet, record the following in `MAINNET_PROOF.md`:
   - `RegisterGuardPOS` Mainnet Contract Address: `0x...`
   - Transaction 1 (Standard Checkout & 4-Way Split): `https://explorer.arc.io/tx/0x...`
   - Transaction 2 (Offline EIP-3009 Signed & Relayed Checkout): `https://explorer.arc.io/tx/0x...`
   - Transaction 3 (Cashier CEX-Safe Refund Claim Created & Swept): `https://explorer.arc.io/tx/0x...`