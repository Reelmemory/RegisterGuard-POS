// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {RegisterGuardPOS} from "../RegisterGuardPOS.sol";
import {MockFiatTokenV2_2} from "../test-helpers/MockFiatTokenV2_2.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  RegisterGuardPOSTest
// ─────────────────────────────────────────────────────────────────────────────
contract RegisterGuardPOSTest is Test {
    // ── actors ────────────────────────────────────────────────────────────────
    address internal deployer   = makeAddr("deployer");
    address internal savings    = makeAddr("savings");
    address internal workingCap = makeAddr("workingCap");
    address internal cashierAddr = makeAddr("cashier");
    address internal stranger   = makeAddr("stranger");

    // ── BPS configuration (standard 2500/6000/1000/500) ──────────────────────
    uint16 internal constant SAVINGS_BPS   = 2500;
    uint16 internal constant WCAP_BPS      = 6000;
    uint16 internal constant SUPPLIER_BPS  = 1000;
    uint16 internal constant BUFFER_BPS    = 500;
    uint256 internal constant MAX_BUFFER   = 2_000_000; // $2.00 USDC

    // ── contracts ─────────────────────────────────────────────────────────────
    MockFiatTokenV2_2 internal usdc;
    RegisterGuardPOS  internal pos;

    // ── setUp: runs before every test ─────────────────────────────────────────
    function setUp() public {
        // Deploy mock USDC
        usdc = new MockFiatTokenV2_2();

        // Deploy POS — deployer is also the initial owner
        vm.prank(deployer);
        pos = new RegisterGuardPOS(
            address(usdc),
            deployer,          // _initialOwner
            savings,
            workingCap,
            SAVINGS_BPS,
            WCAP_BPS,
            SUPPLIER_BPS,
            BUFFER_BPS,
            MAX_BUFFER
        );

        // Register cashier (dailyRefundLimit = $5.00)
        vm.prank(deployer);
        pos.setCashier(cashierAddr, true, 5_000_000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  HELPER: fund a customer, approve POS, and pay an invoice
    // ─────────────────────────────────────────────────────────────────────────
    function _payInvoice(bytes32 invoiceId, address customer, uint256 amount) internal {
        usdc.mint(customer, amount);
        vm.prank(customer);
        MockFiatTokenV2_2(address(usdc)).approve(address(pos), amount);
        vm.prank(customer);
        pos.payInvoice(invoiceId, amount, cashierAddr);
    }

    // =========================================================================
    //  1. EXACT 4-WAY ATOMIC SPLIT
    // =========================================================================
    function test_ExactFourWayAtomicSplit() public {
        address customer = makeAddr("customer1");
        bytes32 invoiceId = keccak256("invoice-1");
        uint256 payment = 10_000_000; // $10.00

        // Expected splits
        // savings:    10_000_000 * 2500 / 10000 = 2_500_000
        // supplier:   10_000_000 * 1000 / 10000 = 1_000_000
        // buffer:     10_000_000 *  500 / 10000 =   500_000
        // workingCap: residual                  = 6_000_000
        uint256 expSavings    = 2_500_000;
        uint256 expWorkingCap = 6_000_000;
        uint256 expSupplier   = 1_000_000;
        uint256 expBuffer     = 500_000;

        _payInvoice(invoiceId, customer, payment);

        // Token balances on external wallets
        assertEq(usdc.balanceOf(savings),    expSavings,    "savings vault balance");
        assertEq(usdc.balanceOf(workingCap), expWorkingCap, "workingCap wallet balance");

        // Internal ledgers
        assertEq(pos.refundBufferBalance(),   expBuffer,   "refund buffer balance");
        assertEq(pos.supplierEscrowBalance(), expSupplier, "supplier escrow balance");
    }

    // =========================================================================
    //  2. REFUND BUFFER CAP OVERFLOW
    // =========================================================================
    function test_RefundBufferCapOverflow() public {
        // Deploy a fresh POS with maxRefundBuffer = 500_000 (exactly one buffer fill)
        vm.prank(deployer);
        RegisterGuardPOS smallPos = new RegisterGuardPOS(
            address(usdc),
            deployer,          // _initialOwner
            savings,
            workingCap,
            SAVINGS_BPS,
            WCAP_BPS,
            SUPPLIER_BPS,
            BUFFER_BPS,
            500_000            // maxRefundBuffer = exactly one $10 payment's buffer portion
        );

        address customer = makeAddr("cust-overflow");

        // ── Payment 1: fills buffer to exactly 500_000 ──────────────────────
        bytes32 inv1 = keccak256("inv-overflow-1");
        uint256 payment = 10_000_000;
        usdc.mint(customer, payment);
        vm.prank(customer);
        MockFiatTokenV2_2(address(usdc)).approve(address(smallPos), payment);
        vm.prank(customer);
        smallPos.payInvoice(inv1, payment, cashierAddr);

        assertEq(smallPos.refundBufferBalance(), 500_000, "buffer full after payment 1");

        uint256 wcapAfterP1 = usdc.balanceOf(workingCap);

        // ── Payment 2: buffer already full; entire bufferBps overflows to workingCap ──
        bytes32 inv2 = keccak256("inv-overflow-2");
        usdc.mint(customer, payment);
        vm.prank(customer);
        MockFiatTokenV2_2(address(usdc)).approve(address(smallPos), payment);
        vm.prank(customer);
        smallPos.payInvoice(inv2, payment, cashierAddr);

        // buffer stays capped
        assertEq(smallPos.refundBufferBalance(), 500_000, "buffer stays at cap after payment 2");

        // workingCap received its normal slice PLUS the full 500_000 overflow
        // normal workingCap for payment 2 = 6_000_000
        // overflow                         =   500_000
        uint256 wcapAfterP2 = usdc.balanceOf(workingCap);
        uint256 extraReceived = wcapAfterP2 - wcapAfterP1;
        assertEq(extraReceived, 6_000_000 + 500_000, "workingCap got extra overflow USDC");
    }

    // =========================================================================
    //  3. OFFLINE EIP-3009 AUTHORIZATION RELAY
    // =========================================================================
    function test_OfflineEIP3009AuthorizationRelay() public {
        // Generate a fresh key pair for the customer (so we can sign)
        uint256 customerPrivKey = 0xA11CE_BEEF_CAFE_1234;
        address customer = vm.addr(customerPrivKey);

        bytes32 invoiceId = keccak256("invoice-eip3009");
        uint256 amount    = 10_000_000; // $10.00

        // Fund customer
        usdc.mint(customer, amount);

        // Build EIP-3009 authorization params
        uint256 validAfter  = 0;               // valid immediately
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce       = keccak256("unique-nonce-1");

        // ── Pre-register the invoice/nonce binding (cashier registers before relay) ──
        vm.prank(cashierAddr);
        pos.registerInvoiceForAuthorization(invoiceId, customer, amount, nonce);

        // Build the struct hash using the exact typehash from the mock
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
                ),
                customer,
                address(pos),   // to = RegisterGuardPOS
                amount,
                validAfter,
                validBefore,
                nonce
            )
        );

        // Build domain separator matching the mock (deployed at address(usdc))
        bytes32 domainSep = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("USD Coin")),
                keccak256(bytes("2")),
                block.chainid,
                address(usdc)
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));

        // Customer signs offline
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(customerPrivKey, digest);

        // Cashier (or anyone) relays the authorization
        vm.prank(stranger); // third party relay – not customer, not cashier
        pos.payInvoiceWithAuthorization(
            invoiceId,
            customer,
            amount,
            validAfter,
            validBefore,
            nonce,
            v, r, s,
            cashierAddr
        );

        // Invoice settled
        (address payer,,,,, bool paid) = pos.invoices(invoiceId);
        assertEq(payer, customer, "payer recorded correctly");
        assertTrue(paid,          "invoice marked paid");

        // Savings vault received its slice
        assertEq(usdc.balanceOf(savings), (amount * SAVINGS_BPS) / 10_000, "savings received correct slice");
    }

    // =========================================================================
    //  4. CASHIER DAILY LIMIT GUARDRAIL
    // =========================================================================
    function test_CashierDailyLimitGuardrail() public {
        // Deploy a fresh POS with dailyRefundLimit = 3_000_000 for the cashier.
        // We use 100% refundBufferBps so the buffer fills to the full payment
        // amount, ensuring the buffer never blocks us before the daily-limit check.
        vm.prank(deployer);
        RegisterGuardPOS limitPos = new RegisterGuardPOS(
            address(usdc),
            deployer,          // _initialOwner
            savings,
            workingCap,
            0,     // savingsBps
            0,     // workingCapBps
            0,     // supplierEscrowBps
            10_000, // refundBufferBps = 100%
            10_000_000 // maxRefundBuffer = $10
        );

        vm.prank(deployer);
        limitPos.setCashier(cashierAddr, true, 3_000_000);

        // Pay a $10 invoice — 100% goes to buffer
        address customer = makeAddr("cust-limit");
        bytes32 invoiceId = keccak256("inv-limit");
        uint256 payment = 10_000_000; // $10
        usdc.mint(customer, payment);
        vm.prank(customer);
        MockFiatTokenV2_2(address(usdc)).approve(address(limitPos), payment);
        vm.prank(customer);
        limitPos.payInvoice(invoiceId, payment, cashierAddr);

        // Buffer should be fully funded
        assertEq(limitPos.refundBufferBalance(), 10_000_000, "buffer fully funded");

        // ── First refund: 2_000_000 → succeeds ──────────────────────────────
        vm.prank(cashierAddr);
        limitPos.issueDirectRefund(invoiceId, customer, 2_000_000);

        // ── Second refund attempt: 1_500_000 → reverts ExceedsDailyRefundLimit
        //    because 2_000_000 + 1_500_000 = 3_500_000 > 3_000_000 daily limit ──
        vm.prank(cashierAddr);
        vm.expectRevert(RegisterGuardPOS.ExceedsDailyRefundLimit.selector);
        limitPos.issueDirectRefund(invoiceId, customer, 1_500_000);

        // ── Warp to next day → daily counter resets → 2_000_000 succeeds ────
        vm.warp(block.timestamp + 1 days);
        vm.prank(cashierAddr);
        limitPos.issueDirectRefund(invoiceId, customer, 2_000_000);

        // customer received: 2_000_000 + 2_000_000 = 4_000_000 in refunds
        assertEq(usdc.balanceOf(customer), 4_000_000, "customer received correct refunds");
    }

    // =========================================================================
    //  5. CEX-SAFE CLAIMABLE REFUND LIFECYCLE
    // =========================================================================
    function test_ClaimableRefundLifecycle() public {
        address customer   = makeAddr("cust-claim");
        address claimer    = makeAddr("claimer-random"); // brand-new address

        bytes32 invoiceId  = keccak256("inv-claim");
        uint256 payment    = 10_000_000;

        // Pay invoice to create buffer
        _payInvoice(invoiceId, customer, payment);

        // Cashier creates a claimable refund for 500_000
        // claimHash = keccak256(abi.encode(secret, destination)) — destination is claimer
        string  memory secret    = "hunter2";
        bytes32 claimHash        = keccak256(abi.encode(secret, claimer));
        uint256 refundAmount     = 500_000;

        vm.prank(cashierAddr);
        bytes32 claimId = pos.createClaimableRefund(invoiceId, refundAmount, claimHash);

        // Brand-new address (claimer) calls claimRefund with the secret, directing to itself
        vm.prank(claimer);
        pos.claimRefund(claimId, secret, claimer);

        // Claimer received the USDC
        assertEq(usdc.balanceOf(claimer), refundAmount, "claimer received USDC");

        // Cannot claim a second time — reverts with ClaimAlreadyClaimed
        vm.prank(claimer);
        vm.expectRevert(abi.encodeWithSelector(RegisterGuardPOS.ClaimAlreadyClaimed.selector, claimId));
        pos.claimRefund(claimId, secret, claimer);
    }

    // =========================================================================
    //  BONUS: InvalidSplitBps on bad constructor
    // =========================================================================
    function test_ConstructorRevertsOnInvalidSplitBps() public {
        vm.expectRevert(RegisterGuardPOS.InvalidSplitBps.selector);
        new RegisterGuardPOS(
            address(usdc),
            deployer,   // _initialOwner
            savings,
            workingCap,
            2500,
            6000,
            1000,
            501,        // 2500+6000+1000+501 = 10001 ≠ 10000
            1_000_000
        );
    }

    // =========================================================================
    //  BONUS: reclaimExpiredRefund restores buffer balance
    // =========================================================================
    function test_ReclaimExpiredRefundRestoresBuffer() public {
        address customer = makeAddr("cust-reclaim");
        bytes32 invoiceId = keccak256("inv-reclaim");
        uint256 payment   = 10_000_000;

        _payInvoice(invoiceId, customer, payment);

        uint256 bufferBefore = pos.refundBufferBalance();

        // Create a claimable refund (no one claims it)
        // Bind to a throwaway destination
        address throwaway = makeAddr("throwaway");
        string  memory secret    = "unused-secret";
        bytes32 claimHash        = keccak256(abi.encode(secret, throwaway));
        uint256 refundAmount     = 300_000;

        vm.prank(cashierAddr);
        bytes32 claimId = pos.createClaimableRefund(invoiceId, refundAmount, claimHash);

        // Buffer was debited
        assertEq(pos.refundBufferBalance(), bufferBefore - refundAmount, "buffer debited after claim creation");

        // Warp past the 24-hour expiry
        vm.warp(block.timestamp + 24 hours + 1);

        // Owner reclaims the expired refund
        vm.prank(deployer);
        pos.reclaimExpiredRefund(claimId);

        // Buffer restored
        assertEq(pos.refundBufferBalance(), bufferBefore, "buffer restored after reclaim");
    }

    // =========================================================================
    //  FUZZ: _distributeSplit arithmetic — savings+workingCap+supplier+buffer == amount
    // =========================================================================
    /// @dev We exercise _distributeSplit via payInvoice.
    ///      The post-state invariant is:
    ///        savings_received + workingCap_received + supplierEscrow + bufferBalance == amount
    ///      (subject to the buffer cap, so we use a very large maxRefundBuffer in a fresh deployment)
    function testFuzz_DistributeSplitArithmetic(uint256 amount) public {
        // Bound: minimum 10_000 to avoid zero dust; maximum $1B to keep arithmetic reasonable.
        amount = bound(amount, 10_000, 1_000_000e6);

        // Deploy a fresh POS with a huge buffer cap so overflow never triggers
        vm.prank(deployer);
        RegisterGuardPOS fuzzPos = new RegisterGuardPOS(
            address(usdc),
            deployer,          // _initialOwner
            savings,
            workingCap,
            SAVINGS_BPS,
            WCAP_BPS,
            SUPPLIER_BPS,
            BUFFER_BPS,
            type(uint256).max  // effectively infinite buffer cap
        );

        address customer = makeAddr("fuzz-customer");
        bytes32 invoiceId = keccak256(abi.encodePacked("fuzz-inv", amount));

        // Snapshot balances before
        uint256 savingsBefore    = usdc.balanceOf(savings);
        uint256 workingCapBefore = usdc.balanceOf(workingCap);

        usdc.mint(customer, amount);
        vm.prank(customer);
        MockFiatTokenV2_2(address(usdc)).approve(address(fuzzPos), amount);
        vm.prank(customer);
        fuzzPos.payInvoice(invoiceId, amount, cashierAddr);

        uint256 savingsReceived    = usdc.balanceOf(savings)    - savingsBefore;
        uint256 workingCapReceived = usdc.balanceOf(workingCap) - workingCapBefore;
        uint256 supplierEscrow     = fuzzPos.supplierEscrowBalance();
        uint256 bufferBalance      = fuzzPos.refundBufferBalance();

        assertEq(
            savingsReceived + workingCapReceived + supplierEscrow + bufferBalance,
            amount,
            "split must be lossless and exhaustive"
        );
    }
}
