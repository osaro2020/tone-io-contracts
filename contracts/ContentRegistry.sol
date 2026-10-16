// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AttestorRegistry.sol";

/// @title ContentRegistry
/// @notice Core provenance protocol. Registers content, tracks derivations,
///         and records human-origin attestations on-chain.
/// @dev Deployed on Base L2. All reads are free. Writes charge a flat ETH fee.

contract ContentRegistry {

    // ──────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────

    enum ContentType {
        Video,      // 0
        Audio,      // 1
        Document,   // 2
        Image,      // 3
        Subtitle,   // 4
        Music,      // 5
        Book,       // 6
        Other       // 7
    }

    enum DerivationType {
        None,        // 0  (original content)
        Translation, // 1
        Remix,       // 2
        Adaptation,  // 3
        Excerpt,     // 4
        Cover,       // 5
        Edit,        // 6
        Other        // 7
    }

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    struct ContentRecord {
        address     creator;
        uint256     timestamp;
        ContentType contentType;
        bytes32     parentHash;
        DerivationType derivationType;
        address     attestor;
        uint256     attestTimestamp;
        bool        archived;
    }

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    /// @notice Protocol fee charged per registration (in wei).
    uint256 public protocolFee;

    /// @notice Address authorised to withdraw fees and update parameters.
    address public owner;

    /// @notice Pending new owner (must call acceptOwnership to complete transfer).
    address public pendingOwner;

    /// @notice Reference to the AttestorRegistry contract.
    AttestorRegistry public attestorRegistry;

    /// @notice contentHash → ContentRecord
    mapping(bytes32 => ContentRecord) private _records;

    /// @notice creator address → list of content hashes they registered
    mapping(address => bytes32[]) private _creatorContent;

    /// @notice parentHash → list of child content hashes (direct derivatives)
    mapping(bytes32 => bytes32[]) private _children;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event ContentRegistered(
        bytes32 indexed contentHash,
        address indexed creator,
        ContentType     contentType,
        uint256         timestamp
    );

    event DerivativeRegistered(
        bytes32 indexed contentHash,
        bytes32 indexed parentHash,
        address indexed creator,
        ContentType     contentType,
        DerivationType  derivationType,
        uint256         timestamp
    );

    event HumanOriginAttested(
        bytes32 indexed contentHash,
        address indexed attestor,
        uint256         timestamp
    );

    event ContentArchived(
        bytes32 indexed contentHash,
        address indexed creator,
        uint256         timestamp
    );

    event ContentUnarchived(
        bytes32 indexed contentHash,
        address indexed creator,
        uint256         timestamp
    );

    event ProtocolFeeUpdated(
        uint256 oldFee,
        uint256 newFee
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

    /// @param _protocolFee  Initial fee per registration (wei).
    /// @param _attestorRegistry  Address of the deployed AttestorRegistry.
    constructor(uint256 _protocolFee, address _attestorRegistry) {
        owner = msg.sender;
        protocolFee = _protocolFee;
        attestorRegistry = AttestorRegistry(_attestorRegistry);
    }

    // ──────────────────────────────────────────────
    //  Write Functions
    // ──────────────────────────────────────────────

    /// @notice Register an original piece of content.
    /// @param contentHash  SHA-256 hash of the content file.
    /// @param contentType  Type of content (video, audio, etc.).
    function registerContent(
        bytes32 contentHash,
        ContentType contentType
    ) external payable {
        require(msg.value == protocolFee, "Incorrect fee");
        require(contentHash != bytes32(0), "Empty hash");
        require(_records[contentHash].creator == address(0), "Already registered");

        _records[contentHash] = ContentRecord({
            creator:         msg.sender,
            timestamp:       block.timestamp,
            contentType:     contentType,
            parentHash:      bytes32(0),
            derivationType:  DerivationType.None,
            attestor:        address(0),
            attestTimestamp:  0,
            archived:        false
        });

        _creatorContent[msg.sender].push(contentHash);

        emit ContentRegistered(
            contentHash,
            msg.sender,
            contentType,
            block.timestamp
        );
    }

    /// @notice Register content that derives from an existing piece.
    /// @param contentHash   SHA-256 hash of the derivative file.
    /// @param contentType   Type of the derivative content.
    /// @param parentHash    Hash of the source content this derives from.
    /// @param derivationType How this content relates to the parent.
    function registerDerivative(
        bytes32 contentHash,
        ContentType contentType,
        bytes32 parentHash,
        DerivationType derivationType
    ) external payable {
        require(msg.value == protocolFee, "Incorrect fee");
        require(contentHash != bytes32(0), "Empty hash");
        require(parentHash != bytes32(0), "Empty parent hash");
        require(_records[contentHash].creator == address(0), "Already registered");
        require(_records[parentHash].creator != address(0), "Parent not found");
        require(derivationType != DerivationType.None, "Must specify derivation type");

        _records[contentHash] = ContentRecord({
            creator:         msg.sender,
            timestamp:       block.timestamp,
            contentType:     contentType,
            parentHash:      parentHash,
            derivationType:  derivationType,
            attestor:        address(0),
            attestTimestamp:  0,
            archived:        false
        });

        _creatorContent[msg.sender].push(contentHash);
        _children[parentHash].push(contentHash);

        emit DerivativeRegistered(
            contentHash,
            parentHash,
            msg.sender,
            contentType,
            derivationType,
            block.timestamp
        );
    }

    /// @notice Attest that a human was involved in creating this content.
    /// @dev    Only callable by addresses registered in the AttestorRegistry.
    /// @param contentHash  Hash of the content to attest.
    function attestHumanOrigin(bytes32 contentHash) external {
        require(attestorRegistry.isAttestor(msg.sender), "Not a recognised attestor");
        require(_records[contentHash].creator != address(0), "Content not found");
        require(_records[contentHash].attestor == address(0), "Already attested");

        _records[contentHash].attestor = msg.sender;
        _records[contentHash].attestTimestamp = block.timestamp;

        emit HumanOriginAttested(
            contentHash,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Mark content as archived (soft delete). Only the original
    ///         registrant may archive. Data stays on-chain permanently.
    /// @param contentHash  Hash of the content to archive.
    function archiveContent(bytes32 contentHash) external {
        require(_records[contentHash].creator == msg.sender, "Not the creator");
        require(!_records[contentHash].archived, "Already archived");

        _records[contentHash].archived = true;

        emit ContentArchived(contentHash, msg.sender, block.timestamp);
    }

    /// @notice Unarchive previously archived content.
    /// @param contentHash  Hash of the content to restore.
    function unarchiveContent(bytes32 contentHash) external {
        require(_records[contentHash].creator == msg.sender, "Not the creator");
        require(_records[contentHash].archived, "Not archived");

        _records[contentHash].archived = false;

        emit ContentUnarchived(contentHash, msg.sender, block.timestamp);
    }

    // ──────────────────────────────────────────────
    //  Read Functions (free)
    // ──────────────────────────────────────────────

    /// @notice Look up a content registration by its hash.
    function getContent(bytes32 contentHash)
        external view
        returns (
            address     creator,
            uint256     timestamp,
            ContentType contentType,
            bytes32     parentHash,
            DerivationType derivationType,
            address     attestor,
            uint256     attestTimestamp,
            bool        archived
        )
    {
        ContentRecord storage r = _records[contentHash];
        return (
            r.creator,
            r.timestamp,
            r.contentType,
            r.parentHash,
            r.derivationType,
            r.attestor,
            r.attestTimestamp,
            r.archived
        );
    }

    /// @notice Check whether a content hash is registered.
    function isRegistered(bytes32 contentHash) external view returns (bool) {
        return _records[contentHash].creator != address(0);
    }

    /// @notice Get attestation details for a piece of content.
    function getAttestation(bytes32 contentHash)
        external view
        returns (
            bool    isAttested,
            address attestor,
            uint256 attestTimestamp
        )
    {
        ContentRecord storage r = _records[contentHash];
        return (
            r.attestor != address(0),
            r.attestor,
            r.attestTimestamp
        );
    }

    /// @notice Get all direct derivatives of a piece of content.
    function getChildren(bytes32 contentHash)
        external view
        returns (bytes32[] memory)
    {
        return _children[contentHash];
    }

    /// @notice Get all content hashes registered by a creator.
    function getCreatorContent(address creator)
        external view
        returns (bytes32[] memory)
    {
        return _creatorContent[creator];
    }

    /// @notice Total number of registrations by a creator.
    function getCreatorContentCount(address creator)
        external view
        returns (uint256)
    {
        return _creatorContent[creator].length;
    }

    /// @notice Total number of direct children of a content hash.
    function getChildrenCount(bytes32 contentHash)
        external view
        returns (uint256)
    {
        return _children[contentHash].length;
    }

    // ──────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────

    /// @notice Withdraw accumulated protocol fees.
    /// @param destination  Address to send the fees to.
    function withdrawFees(address payable destination) external onlyOwner {
        require(destination != address(0), "Invalid destination");
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");
        (bool success, ) = destination.call{value: balance}("");
        require(success, "Transfer failed");
    }

    /// @notice Update the protocol fee. Only callable by owner.
    /// @param newFee  New fee amount in wei.
    function setProtocolFee(uint256 newFee) external onlyOwner {
        emit ProtocolFeeUpdated(protocolFee, newFee);
        protocolFee = newFee;
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

    /// @notice Update the AttestorRegistry address. Only callable by owner.
    /// @param newRegistry  Address of the new AttestorRegistry deployment.
    function setAttestorRegistry(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "Invalid address");
        attestorRegistry = AttestorRegistry(newRegistry);
    }
}
