import { ethers, upgrades } from "hardhat";
import { expect } from "chai";

import { MuonNodeStakingUpgradeable } from "../typechain/MuonNodeStakingUpgradeable";
import { MuonNodeStakingUpgradeableV2 } from "../typechain/MuonNodeStakingUpgradeableV2";
import { MuonNodeManager } from "../typechain/MuonNodeManager";
import { MuonTestToken } from "../typechain/MuonTestToken";
import { SchnorrSECP256K1Verifier } from "./utils/SchnorrSECP256K1Verifier.sol";

describe("MuonNodeStakingUpgradeability", function () {
  it("deployer should be able to upgrade MuonNodeStaking to MuonNodeStakingV2", async function () {
    const [deployer, staker1, staker2, node1, node2] =
      await ethers.getSigners();

    const ONE = ethers.utils.parseEther("1");

    const peerId1 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh1";
    const peerId2 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh2";

    const SchnorrSECP256K1Verifier = await ethers.getContractFactory(
      "SchnorrSECP256K1Verifier"
    );
    const verifier = await SchnorrSECP256K1Verifier.connect(deployer).deploy();
    await verifier.deployed();

    const MuonTestToken = await ethers.getContractFactory("MuonTestToken");
    const muonToken = await MuonTestToken.connect(deployer).deploy();
    await muonToken.deployed();

    const MuonNodeManager = await ethers.getContractFactory("MuonNodeManager");
    const nodeManager = await MuonNodeManager.connect(deployer).deploy();
    await nodeManager.deployed();

    // deploy the v1 contract
    const MuonNodeStakingUpgradeable = await ethers.getContractFactory(
      "MuonNodeStakingUpgradeable"
    );
    const nodeStaking = (await upgrades.deployProxy(
      MuonNodeStakingUpgradeable,
      [muonToken.address, nodeManager.address],
      { initializer: "initialize" }
    )) as MuonNodeStaking;

    await nodeManager
      .connect(deployer)
      .grantRole(await nodeManager.ADMIN_ROLE(), nodeStaking.address);

    // add a node on v1 contract
    await muonToken.connect(staker1).mint(staker1.address, ONE.mul(1000));
    await muonToken
      .connect(staker1)
      .approve(nodeStaking.address, ONE.mul(1000));
    await nodeStaking
      .connect(staker1)
      .addMuonNode(node1.address, peerId1, ONE.mul(1000));

    expect((await nodeStaking.users(staker1.address)).balance).to.equal(
      ONE.mul(1000)
    );
    expect(await nodeStaking.totalStaked()).to.equal(ONE.mul(1000));

    // upgrade to v2
    const MuonNodeStakingUpgradeableV2 = await ethers.getContractFactory(
      "MuonNodeStakingUpgradeableV2"
    );
    await upgrades.prepareUpgrade(
      nodeStaking.address,
      MuonNodeStakingUpgradeableV2
    );
    const nodeStakingV2 = (await upgrades.upgradeProxy(
      nodeStaking.address,
      MuonNodeStakingUpgradeableV2
    )) as MuonNodeStakingV2;

    // add a node on v1 contract
    await muonToken.connect(deployer).mint(staker2.address, ONE.mul(2000));
    await muonToken
      .connect(staker2)
      .approve(nodeStakingV2.address, ONE.mul(2000));
    await nodeStakingV2
      .connect(staker2)
      .addMuonNode(node2.address, peerId2, ONE.mul(2000));

    // check node1, node2 and totalStaked
    expect((await nodeStakingV2.users(staker1.address)).balance).to.equal(
      ONE.mul(1000)
    );
    expect((await nodeStakingV2.users(staker2.address)).balance).to.equal(
      ONE.mul(2000)
    );
    expect(await nodeStakingV2.totalStaked()).to.equal(ONE.mul(3000));
  });
});
