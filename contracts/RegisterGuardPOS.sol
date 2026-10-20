// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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

contract RegisterGuardPOS is ReentrancyGuard {
    struct SplitConfig {
        address ownerSavingsVault;
        address workingCapitalWallet;
        uint16 savingsBps;
        uint16 workingCapitalBps;
        uint16 supplierEscrowBps;
        uint16 refundBufferBps;
        uint256 maxRefundBuffer;
    }

    struct CashierPolicy {
        bool active;
        uint256 dailyRefundLimit;
        uint256 refundedToday;
        uint256 lastResetDay;
    }

    struct InvoiceRecord {
        address payer;
        address cashier;
        uint256 amount;
        uint256 refundedAmount;
        uint256 timestamp;
        bool paid;
    }

    struct RefundClaim {
        bytes32 invoiceId;
        uint256 amount;
        bytes32 claimHash;
        uint256 expiry;
        bool claimed;
        address createdByCashier;
    }

    IFiatTokenV2_2 public immutable usdc;
    address public owner;
    SplitConfig public splitConfig;
    uint256 public refundBufferBalance;
    uint256 public supplierEscrowBalance;
    mapping(address => CashierPolicy) public cashiers;
    mapping(bytes32 => InvoiceRecord) public invoices;
    mapping(bytes32 => RefundClaim) public refundClaims;
    mapping(bytes32 => bytes32) public authorizedInvoiceNonces;

    error NotOwner();
    error NotOwnerOrActiveCashier();
    error InvalidSplitBps();
    error ZeroAddress();
    error InvoiceAlreadyPaid(bytes32 invoiceId);
    error InvoiceNotPaid(bytes32 invoiceId);
    error RefundExceedsInvoice();
    error ExceedsDailyRefundLimit();
    error InsufficientRefundBuffer();
    error ClaimNotFound(bytes32 claimId);
    error ClaimAlreadyClaimed(bytes32 claimId);
    error ClaimExpired(bytes32 claimId);
    error ClaimNotExpiredYet(bytes32 claimId);
    error InvalidSecret();
    error InvoiceNonceMismatch();
    error InsufficientSupplierEscrow();
    error TransferFailed();

    event InvoicePaid(
        bytes32 indexed invoiceId,
        address indexed payer,
        address indexed cashier,
        uint256 amount,
        uint256 savingsAmount,
        uint256 workingCapAmount,
        uint256 supplierAmount,
        uint256 bufferAmount
    );
    event DirectRefundIssued(bytes32 indexed invoiceId, address indexed recipient, uint256 amount, address issuedBy);
    event RefundClaimCreated(bytes32 indexed claimId, bytes32 indexed invoiceId, uint256 amount, uint256 expiry, address createdBy);
    event RefundClaimed(bytes32 indexed claimId, address indexed destination, uint256 amount);
    event SupplierPaid(address indexed supplier, uint256 amount, string invoiceRef);
    event CashierUpdated(address indexed cashier, bool active, uint256 dailyRefundLimit);
    event SplitConfigUpdated(
        address ownerSavingsVault,
        address workingCapitalWallet,
        uint16 savingsBps,
        uint16 workingCapitalBps,
        uint16 supplierEscrowBps,
        uint16 refundBufferBps,
        uint256 maxRefundBuffer
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOwnerOrActiveCashier() {
        if (msg.sender != owner && !cashiers[msg.sender].active) revert NotOwnerOrActiveCashier();
        _;
    }

    constructor(
        address _usdc,
        address _initialOwner,
        address _ownerSavingsVault,
        address _workingCapitalWallet,
        uint16 _savingsBps,
        uint16 _workingCapitalBps,
        uint16 _supplierEscrowBps,
        uint16 _refundBufferBps,
        uint256 _maxRefundBuffer
    ) {
        if (
            _usdc == address(0) ||
            _initialOwner == address(0) ||
            _ownerSavingsVault == address(0) ||
            _workingCapitalWallet == address(0)
        ) {
            revert ZeroAddress();
        }

        uint256 totalBps =
            uint256(_savingsBps) + uint256(_workingCapitalBps) + uint256(_supplierEscrowBps) + uint256(_refundBufferBps);
        if (totalBps != 10_000) revert InvalidSplitBps();

        owner = _initialOwner;
        emit OwnershipTransferred(address(0), _initialOwner);
        usdc = IFiatTokenV2_2(_usdc);
        splitConfig = SplitConfig({
            ownerSavingsVault: _ownerSavingsVault,
            workingCapitalWallet: _workingCapitalWallet,
            savingsBps: _savingsBps,
            workingCapitalBps: _workingCapitalBps,
            supplierEscrowBps: _supplierEscrowBps,
            refundBufferBps: _refundBufferBps,
            maxRefundBuffer: _maxRefundBuffer
        });
    }

    function setSplitConfig(
        address ownerSavingsVault,
        address workingCapitalWallet,
        uint16 savingsBps,
        uint16 workingCapitalBps,
        uint16 supplierEscrowBps,
        uint16 refundBufferBps,
        uint256 maxRefundBuffer
    ) external onlyOwner nonReentrant {
        if (ownerSavingsVault == address(0) || workingCapitalWallet == address(0)) revert ZeroAddress();

        uint256 totalBps = uint256(savingsBps) + uint256(workingCapitalBps) + uint256(supplierEscrowBps) + uint256(refundBufferBps);
        if (totalBps != 10_000) revert InvalidSplitBps();

        splitConfig = SplitConfig({
            ownerSavingsVault: ownerSavingsVault,
            workingCapitalWallet: workingCapitalWallet,
            savingsBps: savingsBps,
            workingCapitalBps: workingCapitalBps,
            supplierEscrowBps: supplierEscrowBps,
            refundBufferBps: refundBufferBps,
            maxRefundBuffer: maxRefundBuffer
        });

        emit SplitConfigUpdated(
            ownerSavingsVault,
            workingCapitalWallet,
            savingsBps,
            workingCapitalBps,
            supplierEscrowBps,
            refundBufferBps,
            maxRefundBuffer
        );
    }

    function setCashier(address cashier, bool active, uint256 dailyRefundLimit) external onlyOwner nonReentrant {
        if (cashier == address(0)) revert ZeroAddress();

        cashiers[cashier] = CashierPolicy({
            active: active,
            dailyRefundLimit: dailyRefundLimit,
            refundedToday: 0,
            lastResetDay: block.timestamp / 1 days
        });

        emit CashierUpdated(cashier, active, dailyRefundLimit);
    }

    function payInvoice(bytes32 invoiceId, uint256 amount, address cashier) external nonReentrant {
        if (invoices[invoiceId].paid) revert InvoiceAlreadyPaid(invoiceId);

        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        _distributeSplit(invoiceId, msg.sender, amount, cashier);
    }

    function registerInvoiceForAuthorization(bytes32 invoiceId, address from, uint256 /*amount*/, bytes32 nonce)
        external
        onlyOwnerOrActiveCashier
        nonReentrant
    {
        authorizedInvoiceNonces[keccak256(abi.encode(from, nonce))] = invoiceId;
    }

    function payInvoiceWithAuthorization(
        bytes32 invoiceId,
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s,
        address cashier
    ) external nonReentrant {
        if (invoices[invoiceId].paid) revert InvoiceAlreadyPaid(invoiceId);

        bytes32 invoiceNonceKey = keccak256(abi.encode(from, nonce));
        if (authorizedInvoiceNonces[invoiceNonceKey] != invoiceId) revert InvoiceNonceMismatch();

        usdc.receiveWithAuthorization(from, address(this), amount, validAfter, validBefore, nonce, v, r, s);
        _distributeSplit(invoiceId, from, amount, cashier);

        delete authorizedInvoiceNonces[invoiceNonceKey];
    }

    function issueDirectRefund(bytes32 invoiceId, address recipient, uint256 amount)
        external
        onlyOwnerOrActiveCashier
        nonReentrant
    {
        InvoiceRecord storage invoice = invoices[invoiceId];
        if (!invoice.paid) revert InvoiceNotPaid(invoiceId);
        if (invoice.refundedAmount + amount > invoice.amount) revert RefundExceedsInvoice();
        if (refundBufferBalance < amount) revert InsufficientRefundBuffer();

        if (msg.sender != owner) {
            CashierPolicy storage policy = cashiers[msg.sender];
            uint256 currentDay = block.timestamp / 1 days;
            if (currentDay != policy.lastResetDay) {
                policy.refundedToday = 0;
                policy.lastResetDay = currentDay;
            }
            if (policy.refundedToday + amount > policy.dailyRefundLimit) revert ExceedsDailyRefundLimit();
            policy.refundedToday += amount;
        }

        refundBufferBalance -= amount;
        invoice.refundedAmount += amount;

        if (!usdc.transfer(recipient, amount)) revert TransferFailed();
        emit DirectRefundIssued(invoiceId, recipient, amount, msg.sender);
    }

    function createClaimableRefund(bytes32 invoiceId, uint256 amount, bytes32 claimHash)
        external
        onlyOwnerOrActiveCashier
        nonReentrant
        returns (bytes32 claimId)
    {
        InvoiceRecord storage invoice = invoices[invoiceId];
        if (!invoice.paid) revert InvoiceNotPaid(invoiceId);
        if (invoice.refundedAmount + amount > invoice.amount) revert RefundExceedsInvoice();
        if (refundBufferBalance < amount) revert InsufficientRefundBuffer();

        if (msg.sender != owner) {
            CashierPolicy storage policy = cashiers[msg.sender];
            uint256 currentDay = block.timestamp / 1 days;
            if (currentDay != policy.lastResetDay) {
                policy.refundedToday = 0;
                policy.lastResetDay = currentDay;
            }
            if (policy.refundedToday + amount > policy.dailyRefundLimit) revert ExceedsDailyRefundLimit();
            policy.refundedToday += amount;
        }

        refundBufferBalance -= amount;
        invoice.refundedAmount += amount;

        claimId = keccak256(abi.encodePacked(invoiceId, amount, claimHash, block.timestamp, msg.sender));
        uint256 expiry = block.timestamp + 24 hours;

        refundClaims[claimId] = RefundClaim({
            invoiceId: invoiceId,
            amount: amount,
            claimHash: claimHash,
            expiry: expiry,
            claimed: false,
            createdByCashier: msg.sender
        });

        emit RefundClaimCreated(claimId, invoiceId, amount, expiry, msg.sender);
    }

    function claimRefund(bytes32 claimId, string calldata secret, address destination) external nonReentrant {
        RefundClaim storage claim = refundClaims[claimId];
        if (claim.amount == 0) revert ClaimNotFound(claimId);
        if (claim.claimed) revert ClaimAlreadyClaimed(claimId);
        if (block.timestamp > claim.expiry) revert ClaimExpired(claimId);
        if (keccak256(abi.encode(secret, destination)) != claim.claimHash) revert InvalidSecret();

        claim.claimed = true;

        if (!usdc.transfer(destination, claim.amount)) revert TransferFailed();
        emit RefundClaimed(claimId, destination, claim.amount);
    }

    function reclaimExpiredRefund(bytes32 claimId) external onlyOwnerOrActiveCashier nonReentrant {
        RefundClaim storage claim = refundClaims[claimId];
        if (claim.amount == 0) revert ClaimNotFound(claimId);
        if (claim.claimed) revert ClaimAlreadyClaimed(claimId);
        if (block.timestamp <= claim.expiry) revert ClaimNotExpiredYet(claimId);

        claim.claimed = true;
        refundBufferBalance += claim.amount;
        invoices[claim.invoiceId].refundedAmount -= claim.amount;
    }

    function releaseSupplierEscrow(address supplier, uint256 amount, string calldata invoiceRef)
        external
        onlyOwner
        nonReentrant
    {
        if (supplierEscrowBalance < amount) revert InsufficientSupplierEscrow();

        supplierEscrowBalance -= amount;

        if (!usdc.transfer(supplier, amount)) revert TransferFailed();
        emit SupplierPaid(supplier, amount, invoiceRef);
    }

    function transferOwnership(address newOwner) external onlyOwner nonReentrant {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _distributeSplit(bytes32 invoiceId, address payer, uint256 amount, address cashier) internal {
        SplitConfig memory config = splitConfig;

        uint256 savingsAmount = (amount * config.savingsBps) / 10_000;
        uint256 supplierAmount = (amount * config.supplierEscrowBps) / 10_000;
        uint256 bufferAmount = (amount * config.refundBufferBps) / 10_000;

        uint256 workingCapAmount = amount - savingsAmount - supplierAmount - bufferAmount;

        uint256 newBuffer = refundBufferBalance + bufferAmount;
        if (newBuffer > config.maxRefundBuffer) {
            uint256 capSpace = 0;
            if (config.maxRefundBuffer > refundBufferBalance) {
                capSpace = config.maxRefundBuffer - refundBufferBalance;
            }
            uint256 overflow = bufferAmount - capSpace;
            bufferAmount = capSpace;
            workingCapAmount += overflow;
        }

        refundBufferBalance += bufferAmount;
        supplierEscrowBalance += supplierAmount;

        if (!usdc.transfer(config.ownerSavingsVault, savingsAmount)) revert TransferFailed();
        if (!usdc.transfer(config.workingCapitalWallet, workingCapAmount)) revert TransferFailed();

        invoices[invoiceId] = InvoiceRecord({
            payer: payer,
            cashier: cashier,
            amount: amount,
            refundedAmount: 0,
            timestamp: block.timestamp,
            paid: true
        });

        emit InvoicePaid(
            invoiceId,
            payer,
            cashier,
            amount,
            savingsAmount,
            workingCapAmount,
            supplierAmount,
            bufferAmount
        );
    }
}
