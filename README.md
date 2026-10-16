# tone.io — on-chain contracts

Solidity contracts for the tone.io content provenance protocol:
register content on-chain, link derivatives, and verify provenance.

- `ContentRegistry.sol` — core registration, derivation, attestation, archiving
- `CreatorRegistry.sol` — creator identity + wallet linking
- `AttestorRegistry.sol` — trusted attestor tiers

This repo contains only the on-chain layer. The off-chain backend and
MCP integration are maintained separately.