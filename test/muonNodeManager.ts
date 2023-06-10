import { ethers, upgrades } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";

import { MuonNodeManagerUpgradeable } from "../typechain/MuonNodeManagerUpgradeable";

describe("MuonNodeManagerUpgradeable", function () {
  let deployer: Signer;
  let adminRole: Signer;
  let daoRole: Signer;
  let node1: Signer;
  let node2: Signer;
  let node3: Signer;
  let staker1: Signer;
  let staker2: Signer;
  let staker3: Signer;
  let user1: Signer;

  const peerId1 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh1";
  const peerId2 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh2";
  const peerId3 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh3";

  let nodeManager: MuonNodeManagerUpgradeable;

  before(async function () {
    [
      deployer,
      adminRole,
      daoRole,
      node1,
      node2,
      node3,
      staker1,
      staker2,
      staker3,
      user1,
    ] = await ethers.getSigners();
  });

  beforeEach(async function () {
    const MuonNodeManagerUpgradeable = await ethers.getContractFactory(
      "MuonNodeManagerUpgradeable"
    );
    nodeManager = await upgrades.deployProxy(MuonNodeManagerUpgradeable, []);
    await nodeManager.deployed();

    await nodeManager
      .connect(deployer)
      .grantRole(await nodeManager.ADMIN_ROLE(), adminRole.address);

    await nodeManager
      .connect(deployer)
      .grantRole(await nodeManager.DAO_ROLE(), daoRole.address);
  });

  describe("addNode", function () {
    it("should add a new node", async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);
      const node = await nodeManager.nodes(1);
      expect(node.id).to.equal(1);
      expect(node.nodeAddress).to.equal(node1.address);
      expect(node.stakerAddress).to.equal(staker1.address);
      expect(node.peerId).to.equal(peerId1);
      expect(node.active).to.equal(true);
    });

    it("should not allow duplicate nodeAddress", async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);

      await expect(
        nodeManager
          .connect(adminRole)
          .addNode(node1.address, staker2.address, peerId2, true)
      ).to.be.revertedWith("Duplicate nodeAddress");
    });

    it("should not allow duplicate stakerAddress", async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);

      await expect(
        nodeManager
          .connect(adminRole)
          .addNode(node2.address, staker1.address, peerId2, true)
      ).to.be.revertedWith("Duplicate stakerAddress");
    });
  });

  describe("deactiveNode", function () {
    it("should deactive an active node", async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);

      await nodeManager.connect(adminRole).deactiveNode(1);
      const node = await nodeManager.nodes(1);
      expect(node.active).to.equal(false);
      expect(node.endTime).to.not.equal(0);
    });

    it("should not deactive an already deactived node", async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);

      await nodeManager.connect(adminRole).deactiveNode(1);
      await expect(
        nodeManager.connect(adminRole).deactiveNode(1)
      ).to.be.revertedWith("Already deactived");
    });

    it("should not deactive a non-existent node", async function () {
      await expect(
        nodeManager.connect(adminRole).deactiveNode(2)
      ).to.be.revertedWith("Not found");
    });
  });

  describe("editNodeAddress", function () {
    it("should edit the nodeAddress", async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);

      await nodeManager.editNodeAddress(1, node2.address);
      expect((await nodeManager.nodes(1)).nodeAddress).to.equal(node2.address);
      expect((await nodeManager.nodeAddressInfo(node1.address)).id).to.equal(0);
    });

    it("should not allow duplicate nodeAddress", async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);
      await nodeManager
        .connect(adminRole)
        .addNode(node2.address, staker2.address, peerId2, true);

      await expect(
        nodeManager.editNodeAddress(1, node2.address)
      ).to.be.revertedWith("Duplicate nodeAddress");
    });

    it("should not allow editing non-existent node", async function () {
      await expect(
        nodeManager.editNodeAddress(3, adminRole.address)
      ).to.be.revertedWith("Not found");
    });

    it("should not allow editing inactive node", async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);
      await nodeManager.connect(adminRole).deactiveNode(1);
      await expect(
        nodeManager.editNodeAddress(1, node2.address)
      ).to.be.revertedWith("Not found");
    });
  });

  describe("editPeerId", function () {
    it("should edit the peerId", async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);
      await nodeManager.editPeerId(1, peerId2);
      const node = await nodeManager.nodes(1);
      expect(node.peerId).to.equal(peerId2);
    });

    it("should not allow editing non-existent node", async function () {
      await expect(nodeManager.editPeerId(2, "peerId")).to.be.revertedWith(
        "Not found"
      );
    });

    it("should not allow editing inactive node", async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);
      await nodeManager.connect(adminRole).deactiveNode(1);
      await expect(nodeManager.editPeerId(1, "peerId")).to.be.revertedWith(
        "Not found"
      );
    });
  });

  describe("getAllNodes", function () {
    beforeEach(async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);
      await nodeManager
        .connect(adminRole)
        .addNode(node2.address, staker2.address, peerId2, true);
      await nodeManager
        .connect(adminRole)
        .addNode(node3.address, staker3.address, peerId3, true);
    });

    it("should return all nodes between the given ids", async function () {
      const nodes = await nodeManager.getEditedNodes(0, 1, 2);
      expect(nodes.length).to.equal(2);
      expect(nodes[0].peerId).to.equal(peerId1);
      expect(nodes[1].peerId).to.equal(peerId2);
    });

    it("should return empty array if no nodes found", async function () {
      const nodes = await nodeManager.getEditedNodes(0, 0, 4);
      expect(nodes.length).to.equal(3);
    });
  });

  describe("nodeAddressInfo", function () {
    it("should return Node for a valid nodeAddress", async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);
      const node = await nodeManager.nodeAddressInfo(node1.address);
      expect(node.id).to.equal(1);
      expect(node.peerId).to.equal(peerId1);
    });

    it("should return empty Node for an invalid nodeAddress", async function () {
      const node = await nodeManager.nodeAddressInfo(staker3.address);
      expect(node.id).to.equal(0);
    });
  });

  describe("stakerAddressInfo", function () {
    it("should return Node for a valid stakerAddress", async function () {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);
      const node = await nodeManager.stakerAddressInfo(staker1.address);
      expect(node.id).to.equal(1);
      expect(node.peerId).to.equal(peerId1);
    });

    it("should return empty Node for an invalid stakerAddress", async function () {
      const node = await nodeManager.stakerAddressInfo(node3.address);
      expect(node.id).to.equal(0);
    });
  });

  describe("node roles", () => {
    it("not permitted accounts should not be able to add/set/unset nodes' roles", async () => {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);
      const nodeId = 1;
      const role = ethers.utils.solidityKeccak256(["string"], ["poa"]);

      const DAO_ROLE = await nodeManager.DAO_ROLE();
      const revertMSG = `AccessControl: account ${adminRole.address.toLowerCase()} is missing role ${DAO_ROLE}`;
      await expect(
        nodeManager.connect(adminRole).addNodeRole(role)
      ).to.be.revertedWith(revertMSG);

      await nodeManager.connect(daoRole).addNodeRole(role);
      const roleId = await nodeManager.roleIds(role);
      await expect(
        nodeManager.connect(adminRole).setNodeRole(nodeId, roleId)
      ).to.be.revertedWith(revertMSG);

      await expect(
        nodeManager.connect(adminRole).unsetNodeRole(nodeId, roleId)
      ).to.be.revertedWith(revertMSG);
    });

    it("should not allow to set/unset the roles which not been added yet", async () => {
      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);

      const nodeId = 1;
      const role = ethers.utils.solidityKeccak256(["string"], ["poa"]);
      const roleId = await nodeManager.roleIds(role);

      await expect(
        nodeManager.connect(daoRole).setNodeRole(nodeId, roleId)
      ).to.be.revertedWith("unknown role");

      await expect(
        nodeManager.connect(daoRole).unsetNodeRole(nodeId, roleId)
      ).be.revertedWith("unknown role");
    });

    it("dao should be able to add/set nodes' roles", async () => {
      const startTime = (await ethers.provider.getBlock("latest")).timestamp;

      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);

      const nodeId = 1;
      const roleDeployers = ethers.utils.solidityKeccak256(
        ["string"],
        ["deployers"]
      );
      await nodeManager.connect(daoRole).addNodeRole(roleDeployers);
      const roleIdDeployers = await nodeManager.roleIds(roleDeployers);
      await nodeManager.connect(daoRole).setNodeRole(nodeId, roleIdDeployers);
      expect(await nodeManager.nodeHasRole(nodeId, roleDeployers)).to.be.true;
      let node = await nodeManager.getNode(nodeId);
      let nodeRoles = node.roles.map((role) => role.toNumber());
      expect(nodeRoles.includes(1)).to.be.true;

      const rolePoa = ethers.utils.solidityKeccak256(["string"], ["poa"]);
      await nodeManager.connect(daoRole).addNodeRole(rolePoa);
      const roleIdPoa = await nodeManager.roleIds(rolePoa);
      await nodeManager.connect(daoRole).setNodeRole(nodeId, roleIdPoa);
      expect(await nodeManager.nodeHasRole(nodeId, rolePoa)).to.be.true;

      const nodeRoleSetEvents = await nodeManager.queryFilter(
        nodeManager.filters.NodeRoleSet(nodeId, null)
      );

      expect(nodeRoleSetEvents[0].args.nodeId).to.equal(nodeId);
      expect(nodeRoleSetEvents[0].args.roleId).to.equal(roleIdDeployers);

      expect(nodeRoleSetEvents[1].args.nodeId).to.equal(nodeId);
      expect(nodeRoleSetEvents[1].args.roleId).to.equal(roleIdPoa);

      const nodes = await nodeManager.getEditedNodes(0, 1, 1000);
      node = nodes[0];
      nodeRoles = node.roles.map((role) => role.toNumber());
      expect(nodeRoles).to.deep.equal([1, 2]);

      const editedNodes = await nodeManager.getEditedNodes(startTime, 1, 1000);
      node = editedNodes[0];
      nodeRoles = node.roles.map((role) => role.toNumber());
      expect(nodeRoles).to.deep.equal([1, 2]);
    });

    it("dao should be able to unset nodes' roles", async () => {
      const startTime = (await ethers.provider.getBlock("latest")).timestamp;

      await nodeManager
        .connect(adminRole)
        .addNode(node1.address, staker1.address, peerId1, true);

      const nodeId = 1;
      const roleDeployers = ethers.utils.solidityKeccak256(
        ["string"],
        ["deployers"]
      );
      await nodeManager.connect(daoRole).addNodeRole(roleDeployers);
      const roleIdDeployers = await nodeManager.roleIds(roleDeployers);
      await nodeManager.connect(daoRole).setNodeRole(nodeId, roleIdDeployers);
      expect(await nodeManager.nodeHasRole(nodeId, roleDeployers)).to.be.true;

      const rolePoa = ethers.utils.solidityKeccak256(["string"], ["poa"]);
      await nodeManager.connect(daoRole).addNodeRole(rolePoa);
      const roleIdPoa = await nodeManager.roleIds(rolePoa);
      await nodeManager.connect(daoRole).setNodeRole(nodeId, roleIdPoa);
      expect(await nodeManager.nodeHasRole(nodeId, rolePoa)).to.be.true;

      let node = await nodeManager.getNode(nodeId);
      let nodeRoles = node.roles.map((role) => role.toNumber());
      expect(nodeRoles).to.deep.equal([1, 2]);

      let nodes = await nodeManager.getEditedNodes(0, 1, 1000);
      node = nodes[0];
      nodeRoles = node.roles.map((role) => role.toNumber());
      expect(nodeRoles).to.deep.equal([1, 2]);

      let editedNodes = await nodeManager.getEditedNodes(startTime, 1, 1000);
      node = editedNodes[0];
      nodeRoles = node.roles.map((role) => role.toNumber());
      expect(nodeRoles).to.deep.equal([1, 2]);

      await nodeManager.connect(daoRole).unsetNodeRole(nodeId, roleIdDeployers);
      expect(await nodeManager.nodeHasRole(nodeId, roleDeployers)).to.be.false;
      expect(await nodeManager.nodeHasRole(nodeId, rolePoa)).to.be.true;

      node = await nodeManager.getNode(nodeId);
      nodeRoles = node.roles.map((role) => role.toNumber());
      expect(nodeRoles.includes(1)).to.be.false;
      expect(nodeRoles.includes(2)).to.be.true;

      nodes = await nodeManager.getEditedNodes(0, 1, 1000);
      node = nodes[0];
      nodeRoles = node.roles.map((role) => role.toNumber());
      expect(nodeRoles).to.deep.equal([2]);

      editedNodes = await nodeManager.getEditedNodes(startTime, 1, 1000);
      node = editedNodes[0];
      nodeRoles = node.roles.map((role) => role.toNumber());
      expect(nodeRoles).to.deep.equal([2]);
    });
  });

  describe("get nodes", () => {
    it("get edited nodes / get all nodes", async () => {
      const startTime = (await ethers.provider.getBlock("latest")).timestamp;

      for (let i = 1; i <= 10; i++) {
        await nodeManager
          .connect(adminRole)
          .addNode(
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            `peerId${i}`,
            true
          );
      }

      const targetTimestamp = startTime + 2 * 3600;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        targetTimestamp,
      ]);

      for (let i = 1; i <= 5; i++) {
        await nodeManager
          .connect(adminRole)
          .addNode(
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            `peerId${i}`,
            true
          );
      }

      const nodeId = 1;
      const roleDeployers = ethers.utils.solidityKeccak256(
        ["string"],
        ["deployers"]
      );
      await nodeManager.connect(daoRole).addNodeRole(roleDeployers);
      const roleIdDeployers = await nodeManager.roleIds(roleDeployers);
      await nodeManager.connect(daoRole).setNodeRole(nodeId, roleIdDeployers);
      expect(await nodeManager.nodeHasRole(nodeId, roleDeployers)).to.be.true;

      // get the list of the nodes that were edited in the past hour
      const endTime = (await ethers.provider.getBlock("latest")).timestamp;
      const lastEditTime = endTime - 3600;
      const editedNodesList = await nodeManager.getEditedNodes(
        lastEditTime,
        1,
        1000
      );

      expect(editedNodesList).to.have.lengthOf(6);
      const node = editedNodesList[0];
      const nodeRoles = node.roles.map((role) => role.toNumber());
      expect(nodeRoles).to.deep.equal([1]);

      const allNodesList = await nodeManager.getEditedNodes(0, 1, 1000);
      expect(allNodesList).to.have.lengthOf(15);

      expect(await nodeManager.lastNodeId()).to.be.equal(15);
    });
  });
});
