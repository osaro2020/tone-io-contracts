import { expect } from "chai";
import { ethers } from "hardhat";
import { CreatorRegistry } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("CreatorRegistry", function () {
  let registry: CreatorRegistry;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("CreatorRegistry");
    registry = (await Factory.deploy()) as CreatorRegistry;
    await registry.waitForDeployment();
  });

  // ─────────────────────────────────────────────
  //  registerCreator — new registration
  // ─────────────────────────────────────────────

  describe("registerCreator — new registration", function () {
    it("stores name and registeredAt timestamp", async function () {
      await registry.connect(alice).registerCreator("Alice");
      const [name, registeredAt] = await registry.getCreator(alice.address);
      expect(name).to.equal("Alice");
      expect(registeredAt).to.be.gt(0);
    });

    it("sets the reverse lookup correctly", async function () {
      await registry.connect(alice).registerCreator("Alice");
      expect(await registry.getFunction("getAddress(string)").staticCall("Alice")).to.equal(alice.address);
    });

    it("isRegistered returns true after registration", async function () {
      await registry.connect(alice).registerCreator("Alice");
      expect(await registry.isRegistered(alice.address)).to.be.true;
    });

    it("isRegistered returns false before registration", async function () {
      expect(await registry.isRegistered(alice.address)).to.be.false;
    });

    it("emits CreatorRegistered event", async function () {
      await expect(registry.connect(alice).registerCreator("Alice"))
        .to.emit(registry, "CreatorRegistered")
        .withArgs(alice.address, "Alice", anyValue);
    });

    it("allows a 64-character name (max length)", async function () {
      const maxName = "A".repeat(64);
      await expect(registry.connect(alice).registerCreator(maxName)).to.not.be.reverted;
    });

    it("reverts on empty name", async function () {
      await expect(
        registry.connect(alice).registerCreator("")
      ).to.be.revertedWith("Name cannot be empty");
    });

    it("reverts on name longer than 64 characters", async function () {
      const tooLong = "A".repeat(65);
      await expect(
        registry.connect(alice).registerCreator(tooLong)
      ).to.be.revertedWith("Name too long");
    });

    it("reverts if name is already taken by another creator", async function () {
      await registry.connect(alice).registerCreator("Alice");
      await expect(
        registry.connect(bob).registerCreator("Alice")
      ).to.be.revertedWith("Name already taken");
    });

    it("allows two different creators to use different names", async function () {
      await registry.connect(alice).registerCreator("Alice");
      await expect(registry.connect(bob).registerCreator("Bob")).to.not.be.reverted;
    });
  });

  // ─────────────────────────────────────────────
  //  registerCreator — name update
  // ─────────────────────────────────────────────

  describe("registerCreator — name update", function () {
    beforeEach(async function () {
      await registry.connect(alice).registerCreator("Alice");
    });

    it("updates the stored name", async function () {
      await registry.connect(alice).registerCreator("Alice2");
      const [name] = await registry.getCreator(alice.address);
      expect(name).to.equal("Alice2");
    });

    it("clears the old reverse lookup", async function () {
      await registry.connect(alice).registerCreator("Alice2");
      expect(await registry.getFunction("getAddress(string)").staticCall("Alice")).to.equal(ethers.ZeroAddress);
    });

    it("sets the new reverse lookup", async function () {
      await registry.connect(alice).registerCreator("Alice2");
      expect(await registry.getFunction("getAddress(string)").staticCall("Alice2")).to.equal(alice.address);
    });

    it("emits CreatorUpdated event", async function () {
      await expect(registry.connect(alice).registerCreator("Alice2"))
        .to.emit(registry, "CreatorUpdated")
        .withArgs(alice.address, "Alice", "Alice2", anyValue);
    });

    it("allows updating to the same name (no-op update)", async function () {
      await expect(registry.connect(alice).registerCreator("Alice")).to.not.be.reverted;
      expect(await registry.getFunction("getAddress(string)").staticCall("Alice")).to.equal(alice.address);
    });

    it("reverts if the new name is taken by another creator", async function () {
      await registry.connect(bob).registerCreator("Bob");
      await expect(
        registry.connect(alice).registerCreator("Bob")
      ).to.be.revertedWith("Name already taken");
    });

    it("does not allow silently overwriting another creator's reverse lookup", async function () {
      // Alice = "Alice", Bob = "Bob"
      // Alice tries to rename to "Bob" — must be rejected
      await registry.connect(bob).registerCreator("Bob");
      await expect(
        registry.connect(alice).registerCreator("Bob")
      ).to.be.revertedWith("Name already taken");

      // Bob's lookup must be intact
      expect(await registry.getFunction("getAddress(string)").staticCall("Bob")).to.equal(bob.address);
    });

    it("preserves registeredAt timestamp across updates", async function () {
      const [, originalTs] = await registry.getCreator(alice.address);
      await registry.connect(alice).registerCreator("Alice2");
      const [, updatedTs] = await registry.getCreator(alice.address);
      // registeredAt is not reset on update — it stays as the original
      expect(updatedTs).to.equal(originalTs);
    });
  });

  // ─────────────────────────────────────────────
  //  approveLink
  // ─────────────────────────────────────────────

  describe("approveLink", function () {
    it("does not revert when approving a valid address", async function () {
      await expect(registry.connect(alice).approveLink(bob.address)).to.not.be.reverted;
    });

    it("reverts on zero address", async function () {
      await expect(
        registry.connect(alice).approveLink(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid address");
    });

    it("reverts when approving self", async function () {
      await expect(
        registry.connect(alice).approveLink(alice.address)
      ).to.be.revertedWith("Cannot approve self");
    });
  });

  // ─────────────────────────────────────────────
  //  linkWallet
  // ─────────────────────────────────────────────

  describe("linkWallet", function () {
    beforeEach(async function () {
      // Standard two-step: Bob approves Alice, then Alice links Bob
      await registry.connect(bob).approveLink(alice.address);
    });

    it("links two wallets bidirectionally", async function () {
      await registry.connect(alice).linkWallet(bob.address);
      expect(await registry.areLinked(alice.address, bob.address)).to.be.true;
      expect(await registry.areLinked(bob.address, alice.address)).to.be.true;
    });

    it("adds both addresses to each other's linked wallets list", async function () {
      await registry.connect(alice).linkWallet(bob.address);

      const aliceLinks = await registry.getLinkedWallets(alice.address);
      const bobLinks = await registry.getLinkedWallets(bob.address);

      expect(aliceLinks).to.include(bob.address);
      expect(bobLinks).to.include(alice.address);
    });

    it("emits WalletsLinked event", async function () {
      await expect(registry.connect(alice).linkWallet(bob.address))
        .to.emit(registry, "WalletsLinked")
        .withArgs(alice.address, bob.address, anyValue);
    });

    it("clears the approval after linking", async function () {
      await registry.connect(alice).linkWallet(bob.address);
      // Bob tries to re-use the cleared approval — must fail
      await expect(
        registry.connect(bob).linkWallet(alice.address)
      ).to.be.revertedWith("Already linked");
    });

    it("reverts on zero address", async function () {
      await expect(
        registry.connect(alice).linkWallet(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid address");
    });

    it("reverts when linking to self", async function () {
      await expect(
        registry.connect(alice).linkWallet(alice.address)
      ).to.be.revertedWith("Cannot link to self");
    });

    it("reverts if already linked", async function () {
      await registry.connect(alice).linkWallet(bob.address);
      // Re-approve and try again
      await registry.connect(bob).approveLink(alice.address);
      await expect(
        registry.connect(alice).linkWallet(bob.address)
      ).to.be.revertedWith("Already linked");
    });

    it("reverts if the other wallet has not approved", async function () {
      await expect(
        registry.connect(alice).linkWallet(carol.address)
      ).to.be.revertedWith("Other wallet has not approved");
    });

    it("works when the approver calls linkWallet (either party can initiate)", async function () {
      // Bob approved Alice — but Bob can also call linkWallet for Alice
      await registry.connect(alice).approveLink(bob.address);
      await expect(registry.connect(bob).linkWallet(alice.address)).to.not.be.reverted;
    });
  });

  // ─────────────────────────────────────────────
  //  Read Functions
  // ─────────────────────────────────────────────

  describe("Read functions", function () {
    it("getAddress returns zero address for unregistered name", async function () {
      expect(await registry.getFunction("getAddress(string)").staticCall("Nobody")).to.equal(ethers.ZeroAddress);
    });

    it("getLinkedWallets returns empty array before any linking", async function () {
      const links = await registry.getLinkedWallets(alice.address);
      expect(links).to.have.length(0);
    });

    it("areLinked returns false for unlinked wallets", async function () {
      expect(await registry.areLinked(alice.address, bob.address)).to.be.false;
    });

    it("getCreator returns empty name for unregistered address", async function () {
      const [name, registeredAt] = await registry.getCreator(alice.address);
      expect(name).to.equal("");
      expect(registeredAt).to.equal(0);
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
