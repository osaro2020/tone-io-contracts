// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CreatorRegistry
/// @notice Maps wallet addresses to human-readable creator identities.
///         Optional — creators can register content without ever linking
///         a name to their address.
/// @dev Pseudonymous by default. Names are public only if the creator
///      explicitly calls registerCreator().

contract CreatorRegistry {

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    struct CreatorProfile {
        string  name;
        uint256 registeredAt;
    }

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    /// @notice address → creator profile
    mapping(address => CreatorProfile) private _profiles;

    /// @notice name → address (reverse lookup)
    mapping(string => address) private _nameToAddress;

    /// @notice address → list of linked wallet addresses
    mapping(address => address[]) private _linkedWallets;

    /// @notice bidirectional link tracking (addressA → addressB exists)
    mapping(address => mapping(address => bool)) private _isLinked;

    /// @notice pending link approvals (approver → requester → approved)
    mapping(address => mapping(address => bool)) private _linkApprovals;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event CreatorRegistered(
        address indexed creator,
        string          name,
        uint256         timestamp
    );

    event CreatorUpdated(
        address indexed creator,
        string          oldName,
        string          newName,
        uint256         timestamp
    );

    event WalletsLinked(
        address indexed wallet1,
        address indexed wallet2,
        uint256         timestamp
    );

    // ──────────────────────────────────────────────
    //  Write Functions
    // ──────────────────────────────────────────────

    /// @notice Register or update a display name for the caller's address.
    /// @param name  Human-readable display name.
    function registerCreator(string calldata name) external {
        require(bytes(name).length > 0, "Name cannot be empty");
        require(bytes(name).length <= 64, "Name too long");

        // If updating an existing name, clear old reverse lookup
        string memory oldName = _profiles[msg.sender].name;
        if (bytes(oldName).length > 0) {
            require(
                _nameToAddress[name] == address(0) || _nameToAddress[name] == msg.sender,
                "Name already taken"
            );
            delete _nameToAddress[oldName];
            _nameToAddress[name] = msg.sender;
            _profiles[msg.sender].name = name;

            emit CreatorUpdated(msg.sender, oldName, name, block.timestamp);
        } else {
            // New registration — ensure name is not taken
            require(_nameToAddress[name] == address(0), "Name already taken");

            _profiles[msg.sender] = CreatorProfile({
                name:         name,
                registeredAt: block.timestamp
            });
            _nameToAddress[name] = msg.sender;

            emit CreatorRegistered(msg.sender, name, block.timestamp);
        }
    }

    /// @notice Link two wallet addresses under the same creator identity.
    ///         Must be called by one of the two addresses.
    ///         The other address must have already called approveLink().
    /// @dev    Simple two-step: wallet B calls approveLink(walletA),
    ///         then wallet A calls linkWallet(walletB), or vice versa.
    /// @param otherWallet  The other wallet to link.
    function linkWallet(address otherWallet) external {
        require(otherWallet != address(0), "Invalid address");
        require(otherWallet != msg.sender, "Cannot link to self");
        require(!_isLinked[msg.sender][otherWallet], "Already linked");
        require(_linkApprovals[otherWallet][msg.sender], "Other wallet has not approved");

        // Record bidirectional link
        _linkedWallets[msg.sender].push(otherWallet);
        _linkedWallets[otherWallet].push(msg.sender);
        _isLinked[msg.sender][otherWallet] = true;
        _isLinked[otherWallet][msg.sender] = true;

        // Clear the approval
        delete _linkApprovals[otherWallet][msg.sender];

        emit WalletsLinked(msg.sender, otherWallet, block.timestamp);
    }

    /// @notice Approve a future link request from another wallet.
    /// @param requester  The address that will call linkWallet().
    function approveLink(address requester) external {
        require(requester != address(0), "Invalid address");
        require(requester != msg.sender, "Cannot approve self");
        _linkApprovals[msg.sender][requester] = true;
    }

    // ──────────────────────────────────────────────
    //  Read Functions (free)
    // ──────────────────────────────────────────────

    /// @notice Get the creator profile for an address.
    function getCreator(address creator)
        external view
        returns (string memory name, uint256 registeredAt)
    {
        CreatorProfile storage p = _profiles[creator];
        return (p.name, p.registeredAt);
    }

    /// @notice Reverse lookup — get the address for a display name.
    function getAddress(string calldata name)
        external view
        returns (address)
    {
        return _nameToAddress[name];
    }

    /// @notice Check if a creator has registered a name.
    function isRegistered(address creator) external view returns (bool) {
        return bytes(_profiles[creator].name).length > 0;
    }

    /// @notice Get all wallets linked to an address.
    function getLinkedWallets(address wallet)
        external view
        returns (address[] memory)
    {
        return _linkedWallets[wallet];
    }

    /// @notice Check if two wallets are linked.
    function areLinked(address wallet1, address wallet2)
        external view
        returns (bool)
    {
        return _isLinked[wallet1][wallet2];
    }
}
