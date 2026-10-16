import { expect } from "chai";
import { ethers } from "hardhat";
import { AttestorRegistry, ContentRegistry } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

// Enum mirrors — must match contract order
const Tier = { None: 0, WorkflowVerified: 1, InteractionVerified: 2, IdentityVerified: 3 };
const ContentType = { Video: 0, Audio: 1, Document: 2, Image: 3, Subtitle: 4, Music: 5, Book: 6, Other: 7 };
const DerivationType = { None: 0, Translation: 1, Remix: 2, Adaptation: 3, Excerpt: 4, Cover: 5, Edit: 6, Other: 7 };

// Shared test constants
const PROTOCOL_FEE = ethers.parseEther("0.00001"); // ~$0.02 at $2,000/ETH
const HASH_A = ethers.keccak256(ethers.toUtf8Bytes("content-a"));
const HASH_B = ethers.keccak256(ethers.toUtf8Bytes("content-b"));
const HASH_C = ethers.keccak256(ethers.toUtf8Bytes("content-c"));

describe("ContentRegistry", function () {
  let attestorRegistry: AttestorRegistry;
  let registry: ContentRegistry;
  let owner: HardhatEthersSigner;
  let creator: HardhatEthersSigner;
  let attestor: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, creator, attestor, other] = await ethers.getSigners();

    // Deploy AttestorRegistry first
    const ARFactory = await ethers.getContractFactory("AttestorRegistry");
    attestorRegistry = (await ARFactory.deploy()) as AttestorRegistry;
    await attestorRegistry.waitForDeployment();

    // Deploy ContentRegistry with fee and attestor registry address
    const CRFactory = await ethers.getContractFactory("ContentRegistry");
    registry = (await CRFactory.deploy(
      PROTOCOL_FEE,
      await attestorRegistry.getAddress()
    )) as ContentRegistry;
    await registry.waitForDeployment();

    // Register a Tier 1 attestor for use in attestation tests
    await attestorRegistry.registerAttestor(
      attestor.address,
      "tone.io",
      Tier.WorkflowVerified
    );
  });

  // ─────────────────────────────────────────────
  //  Deployment
  // ─────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets the deployer as owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("stores the initial protocol fee", async function () {
      expect(await registry.protocolFee()).to.equal(PROTOCOL_FEE);
    });

    it("stores the AttestorRegistry address", async function () {
      expect(await registry.attestorRegistry()).to.equal(
        await attestorRegistry.getAddress()
      );
    });
  });

  // ─────────────────────────────────────────────
  //  registerContent
  // ─────────────────────────────────────────────

  describe("registerContent", function () {
    it("registers content and stores the record correctly", async function () {
      await registry
        .connect(creator)
        .registerContent(HASH_A, ContentType.Audio, { value: PROTOCOL_FEE });

      const [c, ts, ct, parentHash, derivType, att, attTs, archived] =
        await registry.getContent(HASH_A);

      expect(c).to.equal(creator.address);
      expect(ts).to.be.gt(0);
      expect(ct).to.equal(ContentType.Audio);
      expect(parentHash).to.equal(ethers.ZeroHash);
      expect(derivType).to.equal(DerivationType.None);
      expect(att).to.equal(ethers.ZeroAddress);
      expect(attTs).to.equal(0);
      expect(archived).to.be.false;
    });

    it("adds hash to creator content list", async function () {
      await registry
        .connect(creator)
        .registerContent(HASH_A, ContentType.Video, { value: PROTOCOL_FEE });

      const content = await registry.getCreatorContent(creator.address);
      expect(content).to.include(HASH_A);
    });

    it("increments creator content count", async function () {
      await registry
        .connect(creator)
        .registerContent(HASH_A, ContentType.Video, { value: PROTOCOL_FEE });
      expect(await registry.getCreatorContentCount(creator.address)).to.equal(1);
    });

    it("isRegistered returns true after registration", async function () {
      await registry
        .connect(creator)
        .registerContent(HASH_A, ContentType.Video, { value: PROTOCOL_FEE });
      expect(await registry.isRegistered(HASH_A)).to.be.true;
    });

    it("isRegistered returns false for unregistered hash", async function () {
      expect(await registry.isRegistered(HASH_A)).to.be.false;
    });

    it("emits ContentRegistered event", async function () {
      await expect(
        registry
          .connect(creator)
          .registerContent(HASH_A, ContentType.Audio, { value: PROTOCOL_FEE })
      )
        .to.emit(registry, "ContentRegistered")
        .withArgs(HASH_A, creator.address, ContentType.Audio, anyValue);
    });

    it("accumulates fee in the contract balance", async function () {
      await registry
        .connect(creator)
        .registerContent(HASH_A, ContentType.Video, { value: PROTOCOL_FEE });

      const balance = await ethers.provider.getBalance(await registry.getAddress());
      expect(balance).to.equal(PROTOCOL_FEE);
    });

    it("reverts if fee is too low", async function () {
      await expect(
        registry
          .connect(creator)
          .registerContent(HASH_A, ContentType.Video, { value: PROTOCOL_FEE - 1n })
      ).to.be.revertedWith("Incorrect fee");
    });

    it("reverts if fee is too high (overpayment rejected)", async function () {
      await expect(
        registry
          .connect(creator)
          .registerContent(HASH_A, ContentType.Video, { value: PROTOCOL_FEE + 1n })
      ).to.be.revertedWith("Incorrect fee");
    });

    it("reverts on zero hash", async function () {
      await expect(
        registry
          .connect(creator)
          .registerContent(ethers.ZeroHash, ContentType.Video, { value: PROTOCOL_FEE })
      ).to.be.revertedWith("Empty hash");
    });

    it("reverts if content hash is already registered", async function () {
      await registry
        .connect(creator)
        .registerContent(HASH_A, ContentType.Video, { value: PROTOCOL_FEE });
      await expect(
        registry
          .connect(creator)
          .registerContent(HASH_A, ContentType.Video, { value: PROTOCOL_FEE })
      ).to.be.revertedWith("Already registered");
    });

    it("allows different creators to register different hashes", async function () {
      await registry
        .connect(creator)
        .registerContent(HASH_A, ContentType.Video, { value: PROTOCOL_FEE });
      await expect(
        registry
          .connect(other)
          .registerContent(HASH_B, ContentType.Audio, { value: PROTOCOL_FEE })
      ).to.not.be.reverted;
    });
  });

  // ─────────────────────────────────────────────
  //  registerDerivative
  // ─────────────────────────────────────────────

  describe("registerDerivative", function () {
    beforeEach(async function () {
      // Register a parent first
      await registry
        .connect(creator)
        .registerContent(HASH_A, ContentType.Audio, { value: PROTOCOL_FEE });
    });

    it("registers a derivative and stores the record correctly", async function () {
      await registry
        .connect(other)
        .registerDerivative(HASH_B, ContentType.Audio, HASH_A, DerivationType.Translation, {
          value: PROTOCOL_FEE,
        });

      const [c, , ct, parentHash, derivType, , , archived] =
        await registry.getContent(HASH_B);

      expect(c).to.equal(other.address);
      expect(ct).to.equal(ContentType.Audio);
      expect(parentHash).to.equal(HASH_A);
      expect(derivType).to.equal(DerivationType.Translation);
      expect(archived).to.be.false;
    });

    it("adds derivative to parent's children list", async function () {
      await registry
        .connect(other)
        .registerDerivative(HASH_B, ContentType.Audio, HASH_A, DerivationType.Remix, {
          value: PROTOCOL_FEE,
        });

      const children = await registry.getChildren(HASH_A);
      expect(children).to.include(HASH_B);
    });

    it("increments parent's children count", async function () {
      await registry
        .connect(other)
        .registerDerivative(HASH_B, ContentType.Audio, HASH_A, DerivationType.Remix, {
          value: PROTOCOL_FEE,
        });
      expect(await registry.getChildrenCount(HASH_A)).to.equal(1);
    });

    it("supports multiple children for a single parent", async function () {
      await registry
        .connect(other)
        .registerDerivative(HASH_B, ContentType.Audio, HASH_A, DerivationType.Translation, {
          value: PROTOCOL_FEE,
        });
      await registry
        .connect(other)
        .registerDerivative(HASH_C, ContentType.Audio, HASH_A, DerivationType.Remix, {
          value: PROTOCOL_FEE,
        });

      const children = await registry.getChildren(HASH_A);
      expect(children).to.have.length(2);
      expect(children).to.include(HASH_B);
      expect(children).to.include(HASH_C);
    });

    it("emits DerivativeRegistered event", async function () {
      await expect(
        registry
          .connect(other)
          .registerDerivative(HASH_B, ContentType.Audio, HASH_A, DerivationType.Translation, {
            value: PROTOCOL_FEE,
          })
      )
        .to.emit(registry, "DerivativeRegistered")
        .withArgs(
          HASH_B,
          HASH_A,
          other.address,
          ContentType.Audio,
          DerivationType.Translation,
          anyValue
        );
    });

    it("reverts if fee is incorrect", async function () {
      await expect(
        registry
          .connect(other)
          .registerDerivative(HASH_B, ContentType.Audio, HASH_A, DerivationType.Remix, {
            value: 0,
          })
      ).to.be.revertedWith("Incorrect fee");
    });

    it("reverts on zero content hash", async function () {
      await expect(
        registry
          .connect(other)
          .registerDerivative(
            ethers.ZeroHash,
            ContentType.Audio,
            HASH_A,
            DerivationType.Remix,
            { value: PROTOCOL_FEE }
          )
      ).to.be.revertedWith("Empty hash");
    });

    it("reverts on zero parent hash", async function () {
      await expect(
        registry
          .connect(other)
          .registerDerivative(
            HASH_B,
            ContentType.Audio,
            ethers.ZeroHash,
            DerivationType.Remix,
            { value: PROTOCOL_FEE }
          )
      ).to.be.revertedWith("Empty parent hash");
    });

    it("reverts if content hash is already registered", async function () {
      await registry
        .connect(other)
        .registerDerivative(HASH_B, ContentType.Audio, HASH_A, DerivationType.Remix, {
          value: PROTOCOL_FEE,
        });
      await expect(
        registry
          .connect(other)
          .registerDerivative(HASH_B, ContentType.Audio, HASH_A, DerivationType.Remix, {
            value: PROTOCOL_FEE,
          })
      ).to.be.revertedWith("Already registered");
    });

    it("reverts if parent hash is not registered", async function () {
      const unknownParent = ethers.keccak256(ethers.toUtf8Bytes("unknown"));
      await expect(
        registry
          .connect(other)
          .registerDerivative(HASH_B, ContentType.Audio, unknownParent, DerivationType.Remix, {
            value: PROTOCOL_FEE,
          })
      ).to.be.revertedWith("Parent not found");
    });

    it("reverts if DerivationType is None", async function () {
      await expect(
        registry
          .connect(other)
          .registerDerivative(HASH_B, ContentType.Audio, HASH_A, DerivationType.None, {
            value: PROTOCOL_FEE,
          })
      ).to.be.revertedWith("Must specify derivation type");
    });
  });

  // ─────────────────────────────────────────────
  //  attestHumanOrigin
  // ─────────────────────────────────────────────

  describe("attestHumanOrigin", function () {
    beforeEach(async function () {
      await registry
        .connect(creator)
        .registerContent(HASH_A, ContentType.Audio, { value: PROTOCOL_FEE });
    });

    it("records the attestor and timestamp", async function () {
      await registry.connect(attestor).attestHumanOrigin(HASH_A);

      const [isAttested, att, attTs] = await registry.getAttestation(HASH_A);
      expect(isAttested).to.be.true;
      expect(att).to.equal(attestor.address);
      expect(attTs).to.be.gt(0);
    });

    it("emits HumanOriginAttested event", async function () {
      await expect(registry.connect(attestor).attestHumanOrigin(HASH_A))
        .to.emit(registry, "HumanOriginAttested")
        .withArgs(HASH_A, attestor.address, anyValue);
    });

    it("reverts if caller is not a recognised attestor", async function () {
      await expect(
        registry.connect(other).attestHumanOrigin(HASH_A)
      ).to.be.revertedWith("Not a recognised attestor");
    });

    it("reverts if content is not registered", async function () {
      await expect(
        registry.connect(attestor).attestHumanOrigin(HASH_B)
      ).to.be.revertedWith("Content not found");
    });

    it("reverts if content is already attested", async function () {
      await registry.connect(attestor).attestHumanOrigin(HASH_A);
      await expect(
        registry.connect(attestor).attestHumanOrigin(HASH_A)
      ).to.be.revertedWith("Already attested");
    });

    it("reverts for removed attestor", async function () {
      await attestorRegistry.removeAttestor(attestor.address);
      await expect(
        registry.connect(attestor).attestHumanOrigin(HASH_A)
      ).to.be.revertedWith("Not a recognised attestor");
    });

    it("getAttestation returns false for unattested content", async function () {
      const [isAttested, att, attTs] = await registry.getAttestation(HASH_A);
      expect(isAttested).to.be.false;
      expect(att).to.equal(ethers.ZeroAddress);
      expect(attTs).to.equal(0);
    });
  });

  // ─────────────────────────────────────────────
  //  archiveContent / unarchiveContent
  // ─────────────────────────────────────────────

  describe("archiveContent / unarchiveContent", function () {
    beforeEach(async function () {
      await registry
        .connect(creator)
        .registerContent(HASH_A, ContentType.Audio, { value: PROTOCOL_FEE });
    });

    it("archives content — sets archived flag to true", async function () {
      await registry.connect(creator).archiveContent(HASH_A);
      const [, , , , , , , archived] = await registry.getContent(HASH_A);
      expect(archived).to.be.true;
    });

    it("emits ContentArchived event", async function () {
      await expect(registry.connect(creator).archiveContent(HASH_A))
        .to.emit(registry, "ContentArchived")
        .withArgs(HASH_A, creator.address, anyValue);
    });

    it("unarchives content — sets archived flag to false", async function () {
      await registry.connect(creator).archiveContent(HASH_A);
      await registry.connect(creator).unarchiveContent(HASH_A);
      const [, , , , , , , archived] = await registry.getContent(HASH_A);
      expect(archived).to.be.false;
    });

    it("emits ContentUnarchived event", async function () {
      await registry.connect(creator).archiveContent(HASH_A);
      await expect(registry.connect(creator).unarchiveContent(HASH_A))
        .to.emit(registry, "ContentUnarchived")
        .withArgs(HASH_A, creator.address, anyValue);
    });

    it("reverts archive if caller is not the creator", async function () {
      await expect(
        registry.connect(other).archiveContent(HASH_A)
      ).to.be.revertedWith("Not the creator");
    });

    it("reverts archive if already archived", async function () {
      await registry.connect(creator).archiveContent(HASH_A);
      await expect(
        registry.connect(creator).archiveContent(HASH_A)
      ).to.be.revertedWith("Already archived");
    });

    it("reverts unarchive if caller is not the creator", async function () {
      await registry.connect(creator).archiveContent(HASH_A);
      await expect(
        registry.connect(other).unarchiveContent(HASH_A)
      ).to.be.revertedWith("Not the creator");
    });

    it("reverts unarchive if not currently archived", async function () {
      await expect(
        registry.connect(creator).unarchiveContent(HASH_A)
      ).to.be.revertedWith("Not archived");
    });
  });

  // ─────────────────────────────────────────────
  //  Admin — withdrawFees
  // ─────────────────────────────────────────────

  describe("withdrawFees", function () {
    beforeEach(async function () {
      // Accumulate two fees in the contract
      await registry
        .connect(creator)
        .registerContent(HASH_A, ContentType.Audio, { value: PROTOCOL_FEE });
      await registry
        .connect(other)
        .registerContent(HASH_B, ContentType.Video, { value: PROTOCOL_FEE });
    });

    it("sends the full balance to the destination", async function () {
      const destination = ethers.Wallet.createRandom().address;
      await registry.withdrawFees(destination);
      const balance = await ethers.provider.getBalance(destination);
      expect(balance).to.equal(PROTOCOL_FEE * 2n);
    });

    it("zeroes the contract balance after withdrawal", async function () {
      const destination = ethers.Wallet.createRandom().address;
      await registry.withdrawFees(destination);
      const contractBalance = await ethers.provider.getBalance(
        await registry.getAddress()
      );
      expect(contractBalance).to.equal(0);
    });

    it("reverts when called by non-owner", async function () {
      const destination = ethers.Wallet.createRandom().address;
      await expect(
        registry.connect(other).withdrawFees(destination)
      ).to.be.revertedWith("Not owner");
    });

    it("reverts on zero destination address", async function () {
      await expect(
        registry.withdrawFees(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid destination");
    });

    it("reverts when balance is zero", async function () {
      const destination = ethers.Wallet.createRandom().address;
      await registry.withdrawFees(destination);
      await expect(registry.withdrawFees(destination)).to.be.revertedWith(
        "No fees to withdraw"
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Admin — setProtocolFee
  // ─────────────────────────────────────────────

  describe("setProtocolFee", function () {
    it("updates the protocol fee", async function () {
      const newFee = ethers.parseEther("0.0002");
      await registry.setProtocolFee(newFee);
      expect(await registry.protocolFee()).to.equal(newFee);
    });

    it("emits ProtocolFeeUpdated with old and new fee", async function () {
      const newFee = ethers.parseEther("0.0002");
      await expect(registry.setProtocolFee(newFee))
        .to.emit(registry, "ProtocolFeeUpdated")
        .withArgs(PROTOCOL_FEE, newFee);
    });

    it("new fee is enforced on subsequent registrations", async function () {
      const newFee = ethers.parseEther("0.0002");
      await registry.setProtocolFee(newFee);

      await expect(
        registry
          .connect(creator)
          .registerContent(HASH_A, ContentType.Video, { value: PROTOCOL_FEE })
      ).to.be.revertedWith("Incorrect fee");

      await expect(
        registry
          .connect(creator)
          .registerContent(HASH_A, ContentType.Video, { value: newFee })
      ).to.not.be.reverted;
    });

    it("reverts when called by non-owner", async function () {
      await expect(
        registry.connect(other).setProtocolFee(0)
      ).to.be.revertedWith("Not owner");
    });

    it("allows setting fee to zero", async function () {
      await registry.setProtocolFee(0);
      expect(await registry.protocolFee()).to.equal(0);
      // Registration with zero fee should work
      await expect(
        registry
          .connect(creator)
          .registerContent(HASH_A, ContentType.Video, { value: 0 })
      ).to.not.be.reverted;
    });
  });

  // ─────────────────────────────────────────────
  //  Admin — transferOwnership
  // ─────────────────────────────────────────────

  describe("transferOwnership", function () {
    it("sets pendingOwner but does not transfer immediately", async function () {
      await registry.transferOwnership(other.address);
      expect(await registry.owner()).to.equal(owner.address);
      expect(await registry.pendingOwner()).to.equal(other.address);
    });

    it("completes transfer when pending owner calls acceptOwnership", async function () {
      await registry.transferOwnership(other.address);
      await registry.connect(other).acceptOwnership();
      expect(await registry.owner()).to.equal(other.address);
      expect(await registry.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("reverts transferOwnership when called by non-owner", async function () {
      await expect(
        registry.connect(other).transferOwnership(other.address)
      ).to.be.revertedWith("Not owner");
    });

    it("reverts on zero address", async function () {
      await expect(
        registry.transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid owner");
    });

    it("reverts acceptOwnership when called by non-pending owner", async function () {
      await registry.transferOwnership(other.address);
      await expect(
        registry.connect(attestor).acceptOwnership()
      ).to.be.revertedWith("Not pending owner");
    });

    it("old owner loses access after transfer is accepted", async function () {
      await registry.transferOwnership(other.address);
      await registry.connect(other).acceptOwnership();
      await expect(registry.setProtocolFee(0)).to.be.revertedWith("Not owner");
    });
  });

  // ─────────────────────────────────────────────
  //  Admin — setAttestorRegistry
  // ─────────────────────────────────────────────

  describe("setAttestorRegistry", function () {
    it("updates the attestor registry address", async function () {
      // Deploy a fresh AttestorRegistry to simulate an upgrade
      const ARFactory = await ethers.getContractFactory("AttestorRegistry");
      const newAR = await ARFactory.deploy();
      await newAR.waitForDeployment();

      await registry.setAttestorRegistry(await newAR.getAddress());
      expect(await registry.attestorRegistry()).to.equal(await newAR.getAddress());
    });

    it("new registry is used for attestation checks", async function () {
      // Deploy fresh registry with no attestors — existing attestor should now be rejected
      const ARFactory = await ethers.getContractFactory("AttestorRegistry");
      const newAR = await ARFactory.deploy();
      await newAR.waitForDeployment();

      await registry.setAttestorRegistry(await newAR.getAddress());
      await registry
        .connect(creator)
        .registerContent(HASH_A, ContentType.Audio, { value: PROTOCOL_FEE });

      await expect(
        registry.connect(attestor).attestHumanOrigin(HASH_A)
      ).to.be.revertedWith("Not a recognised attestor");
    });

    it("reverts when called by non-owner", async function () {
      const ARFactory = await ethers.getContractFactory("AttestorRegistry");
      const newAR = await ARFactory.deploy();
      await newAR.waitForDeployment();

      await expect(
        registry.connect(other).setAttestorRegistry(await newAR.getAddress())
      ).to.be.revertedWith("Not owner");
    });

    it("reverts on zero address", async function () {
      await expect(
        registry.setAttestorRegistry(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid address");
    });
  });
});

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

async function latestTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp;
}
