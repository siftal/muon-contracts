import { ethers, upgrades } from "hardhat";
import { expect } from "chai";

import { MuonNodeManagerUpgradeable } from "../typechain/MuonNodeManagerUpgradeable";
import { MuonNodeManagerUpgradeableV2 } from "../typechain/MuonNodeManagerUpgradeableV2";

describe("MuonNodeManagerUpgradeability", function () {
  it("deployer should be able to upgrade MuonNodeManager to MuonNodeManagerV2", async function () {
    const [deployer, admin, staker1, staker2, node1, node2] =
      await ethers.getSigners();

    const peerId1 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh1";
    const peerId2 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh2";

    // deploy the v1 contract
    const MuonNodeManagerUpgradeable = await ethers.getContractFactory(
      "MuonNodeManagerUpgradeable"
    );
    const nodeManager = (await upgrades.deployProxy(
      MuonNodeManagerUpgradeable,
      [],
      { initializer: "initialize" }
    )) as MuonNodeStaking;

    await nodeManager
      .connect(deployer)
      .grantRole(await nodeManager.ADMIN_ROLE(), admin.address);

    // add a node on v1 contract
    await nodeManager
      .connect(admin)
      .addNode(node1.address, staker1.address, peerId1, false);

    expect((await nodeManager.stakerAddressInfo(staker1.address)).id).to.equal(1);

    // upgrade to v2
    const MuonNodeManagerUpgradeableV2 = await ethers.getContractFactory(
      "MuonNodeManagerUpgradeableV2"
    );
    await upgrades.prepareUpgrade(
      nodeManager.address,
      MuonNodeManagerUpgradeableV2
    );
    const nodeManagerV2 = (await upgrades.upgradeProxy(
      nodeManager.address,
      MuonNodeManagerUpgradeableV2
    )) as MuonNodeStakingV2;

    // add a node on v2 contract
    await nodeManagerV2
      .connect(admin)
      .addNode(node2.address, staker2.address, peerId2, false);

    expect((await nodeManagerV2.stakerAddressInfo(staker1.address)).id).to.equal(1);
    console.log(await nodeManagerV2.stakerAddressInfo(staker1.address));
    expect((await nodeManagerV2.stakerAddressInfo(staker2.address)).id).to.equal(2);
    console.log(await nodeManagerV2.stakerAddressInfo(staker2.address));
    expect(await nodeManagerV2.version()).to.equal(2);
    console.log(await nodeManagerV2.version());
  });
});
