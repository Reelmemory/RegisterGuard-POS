// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockFiatTokenV2_2
/// @notice Minimal USDC mock with 6 decimals, EIP-712 domain, and real
///         EIP-3009 receiveWithAuthorization signature verification.
contract MockFiatTokenV2_2 {
    // ── ERC-20 state ────────────────────────────────────────────────────────
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint8 public constant decimals = 6;
    string public constant name = "USD Coin";
    string public constant symbol = "USDC";

    // ── EIP-712 ─────────────────────────────────────────────────────────────
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;

    // ── EIP-3009 nonce tracking ──────────────────────────────────────────────
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    // ── Events ───────────────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("USD Coin")),
                keccak256(bytes("2")),
                block.chainid,
                address(this)
            )
        );
    }

    // ── ERC-20 ───────────────────────────────────────────────────────────────
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner_, address spender) external view returns (uint256) {
        return _allowances[owner_][spender];
    }

    function approve(address spender, uint256 value) external returns (bool) {
        _allowances[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(_balances[msg.sender] >= value, "ERC20: insufficient balance");
        unchecked {
            _balances[msg.sender] -= value;
            _balances[to] += value;
        }
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(_balances[from] >= value, "ERC20: insufficient balance");
        uint256 allowed = _allowances[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "ERC20: insufficient allowance");
            unchecked {
                _allowances[from][msg.sender] = allowed - value;
            }
        }
        unchecked {
            _balances[from] -= value;
            _balances[to] += value;
        }
        emit Transfer(from, to, value);
        return true;
    }

    // ── EIP-3009 receiveWithAuthorization ────────────────────────────────────
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
    ) external {
        require(block.timestamp > validAfter, "FiatTokenV2: authorization is not yet valid");
        require(block.timestamp < validBefore, "FiatTokenV2: authorization is expired");
        require(!authorizationState[from][nonce], "FiatTokenV2: authorization is used or canceled");
        require(to == msg.sender, "FiatTokenV2: caller must be the payee");

        // Build the EIP-712 struct hash and digest
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        // Recover signer and verify
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == from, "FiatTokenV2: invalid signature");

        // Mark nonce used and move tokens
        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);

        require(_balances[from] >= value, "ERC20: insufficient balance");
        unchecked {
            _balances[from] -= value;
            _balances[to] += value;
        }
        emit Transfer(from, to, value);
    }

    // ── Test helper ──────────────────────────────────────────────────────────
    function mint(address to, uint256 value) external {
        _balances[to] += value;
        emit Transfer(address(0), to, value);
    }
}
