import { expect } from "chai";
import { ethers } from "hardhat";
import { AttestorRegistry } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

// Enum mirror — must match contract order
const Tier = {
  None: 0,
  WorkflowVerified: 1,
  InteractionVerified: 2,
  IdentityVerified: 3,
};

describe("AttestorRegistry", function () {
  let registry: AttestorRegistry;
  let owner: HardhatEthersSigner;
  let attestor: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, attestor, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("AttestorRegistry");
    registry = (await Factory.deploy()) as AttestorRegistry;
    await registry.waitForDeployment();
  });

  // ─────────────────────────────────────────────
  //  Deployment
  // ─────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets the deployer as owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("starts with zero attestors", async function () {
      expect(await registry.getAttestorCount()).to.equal(0);
    });
  });

  // ─────────────────────────────────────────────
  //  registerAttestor
  // ─────────────────────────────────────────────

  describe("registerAttestor", function () {
    it("registers an attestor and stores the profile correctly", async function () {
      await registry.registerAttestor(
        attestor.address,
        "tone.io",
        Tier.WorkflowVerified
      );

      const [name, tier, registeredAt, active] = await registry.getAttestor(
        attestor.address
      );
      expect(name).to.equal("tone.io");
      expect(tier).to.equal(Tier.WorkflowVerified);
      expect(registeredAt).to.be.gt(0);
      expect(active).to.be.true;
    });

    it("increments the attestor count", async function () {
      await registry.registerAttestor(
        attestor.address,
        "tone.io",
        Tier.WorkflowVerified
      );
      expect(await registry.getAttestorCount()).to.equal(1);
    });

    it("adds address to the enumerable list", async function () {
      await registry.registerAttestor(
        attestor.address,
        "tone.io",
        Tier.WorkflowVerified
      );
      expect(await registry.getAttestorByIndex(0)).to.equal(attestor.address);
    });

    it("emits AttestorRegistered event", async function () {
      await expect(
        registry.registerAttestor(attestor.address, "tone.io", Tier.WorkflowVerified)
      )
        .to.emit(registry, "AttestorRegistered")
        .withArgs(attestor.address, "tone.io", Tier.WorkflowVerified, anyValue);
    });

    it("supports all three valid tiers", async function () {
      const [a, b, c] = await ethers.getSigners().then((s) => s.slice(3));

      await registry.registerAttestor(a.address, "App A", Tier.WorkflowVerified);
      await registry.registerAttestor(b.address, "App B", Tier.InteractionVerified);
      await registry.registerAttestor(c.address, "App C", Tier.IdentityVerified);

      expect(await registry.getAttestorTier(a.address)).to.equal(Tier.WorkflowVerified);
      expect(await registry.getAttestorTier(b.address)).to.equal(Tier.InteractionVerified);
      expect(await registry.getAttestorTier(c.address)).to.equal(Tier.IdentityVerified);
    });

    it("reverts when called by non-owner", async function () {
      await expect(
        registry
          .connect(other)
          .registerAttestor(attestor.address, "tone.io", Tier.WorkflowVerified)
      ).to.be.revertedWith("Not owner");
    });

    it("reverts on zero address", async function () {
      await expect(
        registry.registerAttestor(ethers.ZeroAddress, "tone.io", Tier.WorkflowVerified)
      ).to.be.revertedWith("Invalid address");
    });

    it("reverts on empty name", async function () {
      await expect(
        registry.registerAttestor(attestor.address, "", Tier.WorkflowVerified)
      ).to.be.revertedWith("Name cannot be empty");
    });

    it("reverts on None tier", async function () {
      await expect(
        registry.registerAttestor(attestor.address, "tone.io", Tier.None)
      ).to.be.revertedWith("Invalid tier");
    });

    it("reverts if attestor is already registered", async function () {
      await registry.registerAttestor(attestor.address, "tone.io", Tier.WorkflowVerified);
      await expect(
        registry.registerAttestor(attestor.address, "tone.io", Tier.WorkflowVerified)
      ).to.be.revertedWith("Already registered");
    });
  });

  // ─────────────────────────────────────────────
  //  removeAttestor
  // ─────────────────────────────────────────────

  describe("removeAttestor", function () {
    beforeEach(async function () {
      await registry.registerAttestor(attestor.address, "tone.io", Tier.WorkflowVerified);
    });

    it("sets active to false", async function () {
      await registry.removeAttestor(attestor.address);
      const [, , , active] = await registry.getAttestor(attestor.address);
      expect(active).to.be.false;
    });

    it("isAttestor returns false after removal", async function () {
      await registry.removeAttestor(attestor.address);
      expect(await registry.isAttestor(attestor.address)).to.be.false;
    });

    it("emits AttestorRemoved event", async function () {
      await expect(registry.removeAttestor(attestor.address))
        .to.emit(registry, "AttestorRemoved")
        .withArgs(attestor.address, anyValue);
    });

    it("reverts when called by non-owner", async function () {
      await expect(
        registry.connect(other).removeAttestor(attestor.address)
      ).to.be.revertedWith("Not owner");
    });

    it("reverts if attestor is not active", async function () {
      await registry.removeAttestor(attestor.address);
      await expect(
        registry.removeAttestor(attestor.address)
      ).to.be.revertedWith("Not an active attestor");
    });

    it("reverts if address was never registered", async function () {
      await expect(
        registry.removeAttestor(other.address)
      ).to.be.revertedWith("Not an active attestor");
    });
  });

  // ─────────────────────────────────────────────
  //  updateAttestorTier
  // ─────────────────────────────────────────────

  describe("updateAttestorTier", function () {
    beforeEach(async function () {
      await registry.registerAttestor(attestor.address, "tone.io", Tier.WorkflowVerified);
    });

    it("updates the tier correctly", async function () {
      await registry.updateAttestorTier(attestor.address, Tier.InteractionVerified);
      expect(await registry.getAttestorTier(attestor.address)).to.equal(
        Tier.InteractionVerified
      );
    });

    it("emits AttestorTierUpdated with old and new tier", async function () {
      await expect(
        registry.updateAttestorTier(attestor.address, Tier.IdentityVerified)
      )
        .to.emit(registry, "AttestorTierUpdated")
        .withArgs(
          attestor.address,
          Tier.WorkflowVerified,
          Tier.IdentityVerified,
          anyValue
        );
    });

    it("reverts when called by non-owner", async function () {
      await expect(
        registry.connect(other).updateAttestorTier(attestor.address, Tier.IdentityVerified)
      ).to.be.revertedWith("Not owner");
    });

    it("reverts on None tier", async function () {
      await expect(
        registry.updateAttestorTier(attestor.address, Tier.None)
      ).to.be.revertedWith("Invalid tier");
    });

    it("reverts if attestor is not active", async function () {
      await registry.removeAttestor(attestor.address);
      await expect(
        registry.updateAttestorTier(attestor.address, Tier.IdentityVerified)
      ).to.be.revertedWith("Not an active attestor");
    });
  });

  // ─────────────────────────────────────────────
  //  transferOwnership
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

    it("reverts acceptOwnership when no transfer is pending", async function () {
      await expect(
        registry.connect(other).acceptOwnership()
      ).to.be.revertedWith("Not pending owner");
    });

    it("new owner can register attestors after accepting", async function () {
      await registry.transferOwnership(other.address);
      await registry.connect(other).acceptOwnership();
      await expect(
        registry.connect(other).registerAttestor(attestor.address, "tone.io", Tier.WorkflowVerified)
      ).to.not.be.reverted;
    });

    it("old owner loses access after transfer is accepted", async function () {
      await registry.transferOwnership(other.address);
      await registry.connect(other).acceptOwnership();
      await expect(
        registry.registerAttestor(attestor.address, "tone.io", Tier.WorkflowVerified)
      ).to.be.revertedWith("Not owner");
    });

    it("owner can overwrite pendingOwner before acceptance", async function () {
      await registry.transferOwnership(other.address);
      await registry.transferOwnership(attestor.address);
      expect(await registry.pendingOwner()).to.equal(attestor.address);
      await expect(
        registry.connect(other).acceptOwnership()
      ).to.be.revertedWith("Not pending owner");
    });
  });

  // ─────────────────────────────────────────────
  //  Read Functions
  // ─────────────────────────────────────────────

  describe("Read functions", function () {
    beforeEach(async function () {
      await registry.registerAttestor(attestor.address, "tone.io", Tier.WorkflowVerified);
    });

    it("isAttestor returns true for active attestor", async function () {
      expect(await registry.isAttestor(attestor.address)).to.be.true;
    });

    it("isAttestor returns false for unregistered address", async function () {
      expect(await registry.isAttestor(other.address)).to.be.false;
    });

    it("getAttestorTier returns correct tier", async function () {
      expect(await registry.getAttestorTier(attestor.address)).to.equal(
        Tier.WorkflowVerified
      );
    });

    it("getAttestorByIndex returns correct address", async function () {
      expect(await registry.getAttestorByIndex(0)).to.equal(attestor.address);
    });

    it("getAttestorByIndex reverts out of bounds", async function () {
      await expect(registry.getAttestorByIndex(1)).to.be.revertedWith(
        "Index out of bounds"
      );
    });

    it("getAttestorCount reflects multiple registrations", async function () {
      await registry.registerAttestor(other.address, "DaVinci Resolve", Tier.WorkflowVerified);
      expect(await registry.getAttestorCount()).to.equal(2);
    });

    it("getAttestorCount does not decrease after removal", async function () {
      await registry.removeAttestor(attestor.address);
      // Count tracks ever-registered, not active-only
      expect(await registry.getAttestorCount()).to.equal(1);
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
