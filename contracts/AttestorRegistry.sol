// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AttestorRegistry
/// @notice Manages recognised attestor applications that can vouch for
///         human involvement in content creation.
/// @dev Only the owner (multisig) can add or remove attestors.
///      The ContentRegistry checks this contract before accepting
///      attestation calls.

contract AttestorRegistry {

    // ──────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────

    enum AttestorTier {
        None,                // 0 — not an attestor
        WorkflowVerified,    // 1 — multi-step human workflow (strongest)
        InteractionVerified, // 2 — human presence confirmed
        IdentityVerified     // 3 — human identity confirmed (weakest)
    }

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    struct AttestorProfile {
        string       name;
        AttestorTier tier;
        uint256      registeredAt;
        bool         active;
    }

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    /// @notice Contract owner (multisig). Can register and remove attestors.
    address public owner;

    /// @notice Pending new owner (must call acceptOwnership to complete transfer).
    address public pendingOwner;

    /// @notice attestor address → profile
    mapping(address => AttestorProfile) private _attestors;

    /// @notice List of all attestor addresses (for enumeration)
    address[] private _attestorList;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event AttestorRegistered(
        address indexed attestor,
        string          name,
        AttestorTier    tier,
        uint256         timestamp
    );

    event AttestorRemoved(
        address indexed attestor,
        uint256         timestamp
    );

    event AttestorTierUpdated(
        address indexed attestor,
        AttestorTier    oldTier,
        AttestorTier    newTier,
        uint256         timestamp
    );

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ──────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────

    /// @notice Register a new attestor. Only callable by owner.
    /// @param attestorAddress  Wallet address of the attestor application.
    /// @param name             Human-readable name of the attestor.
    /// @param tier             Attestation tier (1 = strongest).
    function registerAttestor(
        address attestorAddress,
        string calldata name,
        AttestorTier tier
    ) external onlyOwner {
        require(attestorAddress != address(0), "Invalid address");
        require(bytes(name).length > 0, "Name cannot be empty");
        require(tier != AttestorTier.None, "Invalid tier");
        require(!_attestors[attestorAddress].active, "Already registered");

        _attestors[attestorAddress] = AttestorProfile({
            name:         name,
            tier:         tier,
            registeredAt: block.timestamp,
            active:       true
        });

        _attestorList.push(attestorAddress);

        emit AttestorRegistered(
            attestorAddress,
            name,
            tier,
            block.timestamp
        );
    }

    /// @notice Remove an attestor. Only callable by owner.
    ///         Existing attestations from this attestor remain on-chain
    ///         but future attestations are rejected.
    /// @param attestorAddress  Address of the attestor to remove.
    function removeAttestor(address attestorAddress) external onlyOwner {
        require(_attestors[attestorAddress].active, "Not an active attestor");

        _attestors[attestorAddress].active = false;

        emit AttestorRemoved(attestorAddress, block.timestamp);
    }

    /// @notice Update an attestor's tier. Only callable by owner.
    /// @param attestorAddress  Address of the attestor.
    /// @param newTier          New attestation tier.
    function updateAttestorTier(
        address attestorAddress,
        AttestorTier newTier
    ) external onlyOwner {
        require(_attestors[attestorAddress].active, "Not an active attestor");
        require(newTier != AttestorTier.None, "Invalid tier");

        AttestorTier oldTier = _attestors[attestorAddress].tier;
        _attestors[attestorAddress].tier = newTier;

        emit AttestorTierUpdated(
            attestorAddress,
            oldTier,
            newTier,
            block.timestamp
        );
    }

    /// @notice Start ownership transfer. New owner must call acceptOwnership().
    /// @param newOwner  Address of the proposed new owner.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        pendingOwner = newOwner;
    }

    /// @notice Complete ownership transfer. Must be called by the pending owner.
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // ──────────────────────────────────────────────
    //  Read Functions (free)
    // ──────────────────────────────────────────────

    /// @notice Check if an address is an active attestor.
    ///         Called by ContentRegistry before accepting attestations.
    function isAttestor(address addr) external view returns (bool) {
        return _attestors[addr].active;
    }

    /// @notice Get full profile of an attestor.
    function getAttestor(address addr)
        external view
        returns (
            string memory name,
            AttestorTier  tier,
            uint256       registeredAt,
            bool          active
        )
    {
        AttestorProfile storage a = _attestors[addr];
        return (a.name, a.tier, a.registeredAt, a.active);
    }

    /// @notice Get the tier of an attestor.
    function getAttestorTier(address addr)
        external view
        returns (AttestorTier)
    {
        return _attestors[addr].tier;
    }

    /// @notice Get total number of attestors ever registered.
    function getAttestorCount() external view returns (uint256) {
        return _attestorList.length;
    }

    /// @notice Get attestor address by index (for enumeration).
    function getAttestorByIndex(uint256 index)
        external view
        returns (address)
    {
        require(index < _attestorList.length, "Index out of bounds");
        return _attestorList[index];
    }
}
