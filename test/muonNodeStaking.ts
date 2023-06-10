import { ethers, upgrades } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import axios from "axios";

import { MuonNodeStakingUpgradeableV2 } from "../typechain/MuonNodeStakingUpgradeableV2";
import { MuonNodeManagerUpgradeable } from "../typechain/MuonNodeManagerUpgradeable";
import { PION } from "../typechain/PION";
import { MuonLpTestToken } from "../typechain/MuonLpTestToken";
import { VePION } from "../typechain/VePION";

describe("MuonNodeStakingUpgradeable", function () {
  const ONE = ethers.utils.parseEther("1");

  let deployer: Signer;
  let daoRole: Signer;
  let rewardRole: Signer;
  let node1: Signer;
  let node2: Signer;
  let node3: Signer;
  let staker1: Signer;
  let staker2: Signer;
  let staker3: Signer;
  let user1: Signer;
  let treasury: Signer;

  const peerId1 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh1";
  const peerId2 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh2";
  const peerId3 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh3";

  let nodeManager: MuonNodeManagerUpgradeable;
  let muonToken: PION;
  let muonLpToken: muonLpTestToken;
  let nodeStaking: MuonNodeStakingUpgradeableV2;
  let vePION: VePION;
  const thirtyDays = 2592000;
  const muonTokenMultiplier = ONE;
  const muonLpTokenMultiplier = ONE.mul(2);
  const muonAppId =
    "1566432988060666016333351531685287278204879617528298155619493815104572633831";
  const muonPublicKey = {
    x: "0x570513014bbf0ddc4b0ac6b71164ff1186f26053a4df9facd79d9268456090c9",
    parity: 0,
  };
  const tier1MaxStake = ONE.mul(1000);
  const tier2MaxStake = ONE.mul(4000);
  const tier3MaxStake = ONE.mul(10000);

  before(async () => {
    [
      deployer,
      daoRole,
      rewardRole,
      node1,
      node2,
      node3,
      staker1,
      staker2,
      staker3,
      user1,
      treasury,
    ] = await ethers.getSigners();
  });

  beforeEach(async function () {
    const SchnorrSECP256K1Verifier = await ethers.getContractFactory(
      "SchnorrSECP256K1Verifier"
    );
    const verifier = await SchnorrSECP256K1Verifier.connect(deployer).deploy();
    await verifier.deployed();

    const MuonTestToken = await ethers.getContractFactory("PION");
    muonToken = await upgrades.deployProxy(MuonTestToken, []);
    await muonToken.deployed();

    const MuonLpTestToken = await ethers.getContractFactory("MuonLpTestToken");
    muonLpToken = await MuonLpTestToken.connect(deployer).deploy();
    await muonLpToken.deployed();

    const VePION = await ethers.getContractFactory("VePION");
    vePION = await upgrades.deployProxy(VePION, [
      muonToken.address,
      treasury.address,
    ]);
    await vePION.deployed();

    const MuonNodeManager = await ethers.getContractFactory(
      "MuonNodeManagerUpgradeable"
    );
    nodeManager = await upgrades.deployProxy(MuonNodeManager, []);
    await nodeManager.deployed();

    const MuonNodeStakingUpgradeableV2 = await ethers.getContractFactory(
      "MuonNodeStakingUpgradeableV2"
    );
    nodeStaking = await upgrades.deployProxy(MuonNodeStakingUpgradeableV2, [
      muonToken.address,
      nodeManager.address,
      verifier.address,
      muonAppId,
      muonPublicKey,
      vePION.address,
    ]);
    await nodeStaking.deployed();

    await nodeStaking
      .connect(deployer)
      .grantRole(await nodeStaking.DAO_ROLE(), daoRole.address);

    await nodeStaking
      .connect(deployer)
      .grantRole(await nodeStaking.REWARD_ROLE(), rewardRole.address);

    await nodeStaking
      .connect(daoRole)
      .updateStakingTokens(
        [muonToken.address, muonLpToken.address],
        [muonTokenMultiplier, muonLpTokenMultiplier]
      );

    await vePION.connect(deployer).whitelistTokens([muonLpToken.address]);
    await vePION.connect(deployer).whitelistTransferFor([nodeStaking.address]);

    await nodeStaking.connect(daoRole).setTierMaxStakeAmount(1, tier1MaxStake);
    await nodeStaking.connect(daoRole).setTierMaxStakeAmount(2, tier2MaxStake);
    await nodeStaking.connect(daoRole).setTierMaxStakeAmount(3, tier3MaxStake);

    await nodeManager
      .connect(deployer)
      .grantRole(await nodeManager.ADMIN_ROLE(), nodeStaking.address);

    await nodeManager
      .connect(deployer)
      .grantRole(await nodeManager.DAO_ROLE(), daoRole.address);

    await muonToken
      .connect(deployer)
      .mint(rewardRole.address, ONE.mul(2000000));

    await mintVePION(1000, 1000, staker1);
    await vePION.connect(staker1).approve(nodeStaking.address, 1);
    await nodeStaking.connect(staker1).addMuonNode(node1.address, peerId1, 1);
    // check added node
    expect(await vePION.ownerOf(1)).to.equal(nodeStaking.address);
    expect(await nodeStaking.usersTokenId(staker1.address)).to.equal(1);
    expect(await nodeStaking.valueOfVePion(1)).to.equal(ONE.mul(3000));
    // newly added nodes' tiers are 0, so their maximum stake amount will be 0
    expect(await nodeManager.getTier(1)).to.equal(0);
    expect((await nodeStaking.users(staker1.address)).balance).to.equal(0);
    // admins can set tier
    await nodeManager.connect(daoRole).setTier(1, 1);
    await nodeStaking.connect(staker1).updateStaking();
    expect((await nodeStaking.users(staker1.address)).balance).to.equal(
      tier1MaxStake
    );

    await mintVePION(1000, 500, staker2);
    await vePION.connect(staker2).approve(nodeStaking.address, 2);
    await nodeStaking.connect(staker2).addMuonNode(node2.address, peerId2, 2);
    await nodeManager.connect(daoRole).setTier(2, 2);
    await nodeStaking.connect(staker2).updateStaking();
  });

  const getDummySig = async (
    stakerAddress,
    paidReward,
    rewardPerToken,
    amount
  ) => {
    // console.log(
    //   `http://localhost:8000/v1/?app=tss_reward_oracle_test&method=reward&params[stakerAddress]=${stakerAddress}&params[paidReward]=${paidReward}&params[rewardPerToken]=${rewardPerToken}&params[amount]=${amount}`
    // );
    const response = await axios.get(
      `http://localhost:8000/v1/?app=tss_reward_oracle_test&method=reward&params[stakerAddress]=${stakerAddress}&params[paidReward]=${paidReward}&params[rewardPerToken]=${rewardPerToken}&params[amount]=${amount}`
    );
    return response.data;
  };

  const mintVePION = async (muonAmount, muonLpAmount, _to) => {
    await muonToken.connect(deployer).mint(_to.address, ONE.mul(muonAmount));
    await muonLpToken
      .connect(deployer)
      .mint(_to.address, ONE.mul(muonLpAmount));
    await muonToken.connect(_to).approve(vePION.address, ONE.mul(muonAmount));
    await muonLpToken
      .connect(_to)
      .approve(vePION.address, ONE.mul(muonLpAmount));
    await vePION
      .connect(_to)
      .mintAndLock(
        [muonToken.address, muonLpToken.address],
        [ONE.mul(muonAmount), ONE.mul(muonLpAmount)],
        _to.address
      );
  };

  const distributeRewards = async (initialReward) => {
    await muonToken
      .connect(rewardRole)
      .transfer(nodeStaking.address, initialReward);
    await nodeStaking.connect(rewardRole).distributeRewards(initialReward);
  };

  const evmIncreaseTime = async (amount) => {
    await ethers.provider.send("evm_increaseTime", [amount]);
    await ethers.provider.send("evm_mine", []);
  };

  const getReward = async (staker, tssSig) => {
    const reqId = tssSig["result"]["reqId"];
    const rewardPerToken = tssSig["result"]["data"]["signParams"][4]["value"];
    const amount = tssSig["result"]["data"]["signParams"][5]["value"];
    const sig = {
      signature: tssSig["result"]["signatures"][0]["signature"],
      owner: tssSig["result"]["signatures"][0]["owner"],
      nonce: tssSig["result"]["data"]["init"]["nonceAddress"],
    };
    await nodeStaking
      .connect(staker)
      .getReward(amount, rewardPerToken, reqId, sig);
  };

  describe("add node", function () {
    it("should add Muon nodes correctly", async function () {
      const info1 = await nodeManager.nodeAddressInfo(node1.address);
      expect(info1.id).to.equal(1);
      expect(info1.nodeAddress).to.equal(node1.address);
      expect(info1.stakerAddress).to.equal(staker1.address);
      expect(info1.peerId).to.equal(peerId1);
      expect(info1.active).to.equal(true);
      expect(info1.endTime).to.equal(0);

      const info2 = await nodeManager.nodeAddressInfo(node2.address);
      expect(info2.id).to.equal(2);
      expect(info2.nodeAddress).to.equal(node2.address);
      expect(info2.stakerAddress).to.equal(staker2.address);
      expect(info2.peerId).to.equal(peerId2);
      expect(info2.active).to.equal(true);
      expect(info2.endTime).to.equal(0);
    });

    it("should not add Muon nodes with insufficient stake", async function () {
      await mintVePION(1, 1, staker3);
      await expect(
        nodeStaking.connect(staker3).addMuonNode(node3.address, peerId3, 3)
      ).to.be.revertedWith("the amount is not enough for running a node");
    });

    it("nodes can not stake more than the MaxStakeAmount of their tier", async function () {
      await mintVePION(10000, 10000, staker3);
      await vePION.connect(staker3).approve(nodeStaking.address, 3);
      await nodeStaking.connect(staker3).addMuonNode(node3.address, peerId3, 3);

      expect(await nodeStaking.usersTokenId(staker3.address)).to.equal(3);
      expect(await nodeStaking.valueOfVePion(3)).to.equal(ONE.mul(30000));
      // newly added nodes' tiers are 0, so their maximum stake amount will be 0
      expect(await nodeManager.getTier(3)).to.equal(0);
      expect((await nodeStaking.users(staker3.address)).balance).to.equal(0);
      // admins can set tier
      await nodeManager.connect(daoRole).setTier(3, 1);
      await nodeStaking.connect(staker3).updateStaking();
      expect((await nodeStaking.users(staker3.address)).balance)
        .to.equal(await nodeStaking.tiersMaxStakeAmount(1))
        .to.equal(tier1MaxStake);
    });

    it("should transfer NFT from the staker to the staking contract when adding a Muon node", async function () {
      await mintVePION(10000, 10000, staker3);
      expect(await vePION.ownerOf(3)).to.equal(staker3.address);
      await vePION.connect(staker3).approve(nodeStaking.address, 3);
      await nodeStaking.connect(staker3).addMuonNode(node3.address, peerId3, 3);
      expect(await vePION.ownerOf(3)).to.equal(nodeStaking.address);
    });
  });

  describe("distribute rewards", function () {
    it("should update rewards correctly after distributing", async function () {
      const totalStaked = await nodeStaking.totalStaked();
      // set initial reward as a multiplier of 30 days and total stake to make sure there is no leftover
      const initialReward = (thirtyDays * totalStaked) / 10 ** 18;
      await distributeRewards(initialReward);
      const rewardPeriod = await nodeStaking.REWARD_PERIOD();
      expect(rewardPeriod).to.be.equal(60 * 60 * 24 * 30);

      const expectedRewardRate = initialReward / rewardPeriod;
      const rewardRate = await nodeStaking.rewardRate();
      expect(expectedRewardRate).to.be.equal(rewardRate);

      // Increase time by 15 days
      const fifteenDays = 60 * 60 * 24 * 15;
      await evmIncreaseTime(fifteenDays);

      const rewardPerToken = await nodeStaking.rewardPerToken();
      const expectedRewardPerToken = parseInt(
        (fifteenDays * rewardRate * 10 ** 18) / totalStaked
      );
      expect(rewardPerToken).to.be.equal(expectedRewardPerToken);

      let staker1Reward = await nodeStaking.earned(staker1.address);
      let staker2Reward = await nodeStaking.earned(staker2.address);
      expect(staker1Reward.add(staker2Reward)).to.be.equal(initialReward / 2);

      const staker1ExpectedReward = initialReward / 6;
      const staker1ActualReward = await nodeStaking.earned(staker1.address);
      expect(staker1ActualReward).to.be.equal(staker1ExpectedReward);

      const staker2ExpectedReward = initialReward / 3;
      const staker2ActualReward = await nodeStaking.earned(staker2.address);
      expect(staker2ActualReward).to.be.equal(staker2ExpectedReward);
    });

    it("should update rewards correctly after joining new nodes", async function () {
      await mintVePION(1000, 1000, staker3);
      await vePION.connect(staker3).approve(nodeStaking.address, 3);

      // set initial reward as a multiplier of 30 days and total stake to make sure there is no leftover
      const initialReward = thirtyDays * 18000;
      await distributeRewards(initialReward);
      const distributeTimestamp = (await ethers.provider.getBlock("latest"))
        .timestamp;

      // Increase time by 10 days
      const tenDays = 60 * 60 * 24 * 10;
      let targetTimestamp = distributeTimestamp + tenDays;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        targetTimestamp,
      ]);

      // add new node
      await nodeStaking.connect(staker3).addMuonNode(node3.address, peerId3, 3);
      await nodeManager.connect(daoRole).setTier(3, 2);
      await nodeStaking.connect(staker3).updateStaking();

      // Increase time by 10 days
      targetTimestamp = distributeTimestamp + 2 * tenDays;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        targetTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      const staker1ExpectedReward =
        (tenDays * 18000) / 3 + (tenDays * 18000) / 6;
      const staker1ActualReward = await nodeStaking.earned(staker1.address);
      // tolerance for 2 seconds
      expect(staker1ActualReward).to.closeTo(staker1ExpectedReward, 18000);

      const staker2ExpectedReward =
        ((tenDays * 18000) / 3) * 2 + ((tenDays * 18000) / 6) * 2;
      const staker2ActualReward = await nodeStaking.earned(staker2.address);
      // tolerance for 2 seconds
      expect(staker2ActualReward).to.closeTo(staker2ExpectedReward, 18000);

      const staker3ExpectedReward = ((tenDays * 18000) / 6) * 3;
      const staker3ActualReward = await nodeStaking.earned(staker3.address);
      // tolerance for 2 seconds
      expect(staker3ActualReward).to.closeTo(staker3ExpectedReward, 18000);
    });

    it("should update rewards correctly after lock more", async function () {
      const tenDays = 60 * 60 * 24 * 10;

      await muonToken.connect(deployer).mint(staker2.address, ONE.mul(1000));
      await muonToken.connect(staker2).approve(vePION.address, ONE.mul(1000));
      await vePION
        .connect(staker2)
        .lock(2, [muonToken.address], [ONE.mul(1000)]);

      // set initial reward as a multiplier of 30 days and total stake to make sure there is no leftover
      const initialReward = thirtyDays * 12000;
      await distributeRewards(initialReward);
      const distributeTimestamp = (await ethers.provider.getBlock("latest"))
        .timestamp;

      // Increase time by 10 days
      let targetTimestamp = distributeTimestamp + tenDays;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        targetTimestamp,
      ]);

      const staker2Stake1 = await nodeStaking.users(staker2.address);
      // lock more
      await nodeStaking.connect(staker2).updateStaking();
      const staker2Stake2 = await nodeStaking.users(staker2.address);
      expect(staker2Stake2.balance).to.be.equal(
        staker2Stake1.balance.add(ONE.mul(1000))
      );
      expect(staker2Stake2.pendingRewards).to.be.equal(
        (tenDays * 12000 * 2) / 3
      );
      expect(staker2Stake2.balance).to.be.equal(ONE.mul(3000));

      const staker1ExpectedReward1 = (tenDays * 12000) / 3;
      const staker1ActualReward1 = await nodeStaking.earned(staker1.address);
      expect(staker1ActualReward1).to.be.equal(staker1ExpectedReward1);

      // Increase time by 10 days
      targetTimestamp = distributeTimestamp + 2 * tenDays;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        targetTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      const staker1ExpectedReward =
        (tenDays * 12000) / 3 + (tenDays * 12000) / 4;
      const staker1ActualReward = await nodeStaking.earned(staker1.address);
      expect(staker1ActualReward).to.be.equal(staker1ExpectedReward);

      const staker2ExpectedReward =
        ((tenDays * 12000) / 3) * 2 + ((tenDays * 12000) / 4) * 3;
      const staker2ActualReward = await nodeStaking.earned(staker2.address);
      expect(staker2ActualReward).to.be.equal(staker2ExpectedReward);
    });

    it("should update rewards correctly after distributing twice", async function () {
      // Distribute initial rewards and wait 10 days then distribute additionalReward
      const initialReward = thirtyDays * 3000;
      const additionalReward = thirtyDays * 4000;
      await muonToken
        .connect(rewardRole)
        .transfer(nodeStaking.address, initialReward);

      await muonToken
        .connect(rewardRole)
        .transfer(nodeStaking.address, additionalReward);

      await nodeStaking.connect(rewardRole).distributeRewards(initialReward);
      const distributeTimestamp = (await ethers.provider.getBlock("latest"))
        .timestamp;

      const rewardPeriod = await nodeStaking.REWARD_PERIOD();
      let expectedRewardRate = initialReward / rewardPeriod;
      let actualRewardRate = await nodeStaking.rewardRate();
      expect(expectedRewardRate).to.be.equal(actualRewardRate);

      // Increase time by 10 days
      const tenDays = 60 * 60 * 24 * 10;
      let targetTimestamp = distributeTimestamp + tenDays;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        targetTimestamp,
      ]);

      await nodeStaking.connect(rewardRole).distributeRewards(additionalReward);

      const newRevard = additionalReward + (initialReward / 3) * 2;
      expectedRewardRate = await nodeStaking.rewardRate();
      actualRewardRate = await nodeStaking.rewardRate();
      expect(expectedRewardRate).to.be.equal(actualRewardRate);

      // Increase time by 10 days
      targetTimestamp = distributeTimestamp + 2 * tenDays;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        targetTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      let staker1ExpectedReward = (tenDays * 3000) / 3 + (tenDays * 6000) / 3;
      let staker1ActualReward = await nodeStaking.earned(staker1.address);
      expect(staker1ActualReward).to.be.equal(staker1ExpectedReward);

      let staker2ExpectedReward =
        ((tenDays * 3000) / 3) * 2 + ((tenDays * 6000) / 3) * 2;
      let staker2ActualReward = await nodeStaking.earned(staker2.address);
      expect(staker2ActualReward).to.be.equal(staker2ExpectedReward);
    });
  });

  describe("withdraw", function () {
    it("should not allow non-stakers to withdraw", async function () {
      // Distribute rewards
      const initialReward = thirtyDays * 3000;
      await distributeRewards(initialReward);

      // Increase time by 15 days
      await evmIncreaseTime(60 * 60 * 24 * 15);

      // generate a dummy tts sig to withdraw 85% of the maximum reward
      const paidReward = (await nodeStaking.users(staker1.address)).paidReward;
      const rewardPerToken = await nodeStaking.rewardPerToken();
      const reward85 = parseInt(
        ((await nodeStaking.earned(staker1.address)) * 85) / 100
      );
      const withdrawSig = await getDummySig(
        staker1.address,
        paidReward,
        rewardPerToken,
        reward85
      );

      // try to getReward by non-stakers
      await expect(getReward(user1, withdrawSig)).to.be.revertedWith(
        "node not found"
      );
    });

    it("should allow stakers to withdraw their reward by tss network signature", async function () {
      // Distribute rewards
      const initialReward = thirtyDays * 3000;
      await distributeRewards(initialReward);

      // Increase time by 15 days
      await evmIncreaseTime(60 * 60 * 24 * 15);

      // Check staker1's balance before withdrawal
      const balance1 = await muonToken.balanceOf(staker1.address);

      // generate a dummy tts sig to withdraw 85% of the maximum reward
      const paidReward = (await nodeStaking.users(staker1.address)).paidReward;
      const rewardPerToken = await nodeStaking.rewardPerToken();
      const earned1 = await nodeStaking.earned(staker1.address);
      const reward85 = parseInt((earned1 * 85) / 100);
      const withdrawSig = await getDummySig(
        staker1.address,
        paidReward,
        rewardPerToken,
        reward85
      );

      // withdraw 85% of reward
      await getReward(staker1, withdrawSig);

      // check the result of withdrawing
      const staker1Stake = await nodeStaking.users(staker1.address);
      expect(staker1Stake.paidReward).to.equal(reward85);
      expect(staker1Stake.paidRewardPerToken).to.equal(rewardPerToken);
      expect(await muonToken.balanceOf(staker1.address)).to.equal(
        balance1.add(reward85)
      );

      // tolerance for 2 seconds
      expect(await nodeStaking.earned(staker1.address)).to.closeTo(0, 3000);
    });

    it("should not allow stakers to reuse tss network signature", async function () {
      // Distribute rewards
      await distributeRewards(thirtyDays * 3000);

      // Increase time by 15 days
      await evmIncreaseTime(60 * 60 * 24 * 15);

      // Check staker1's balance before withdrawal
      const balance1 = await muonToken.balanceOf(staker1.address);

      // generate a dummy tts sig to withdraw 85% of the maximum reward
      const paidReward = (await nodeStaking.users(staker1.address)).paidReward;
      const rewardPerToken = await nodeStaking.rewardPerToken();
      const earned1 = await nodeStaking.earned(staker1.address);
      const reward85 = parseInt((earned1 * 85) / 100);
      const withdrawSig = await getDummySig(
        staker1.address,
        paidReward,
        rewardPerToken,
        reward85
      );

      // withdraw 85% of reward
      await getReward(staker1, withdrawSig);

      expect(await muonToken.balanceOf(staker1.address)).to.equal(
        balance1.add(reward85)
      );

      // try to withdraw again
      await expect(getReward(staker1, withdrawSig)).to.be.revertedWith(
        "this request already submitted"
      );
    });

    it("stakers  should be able to withdraw their reward multiple times", async function () {
      // Distribute rewards
      const initialReward = thirtyDays * 3000;
      await distributeRewards(initialReward);

      // Increase time by 10 days
      await evmIncreaseTime(60 * 60 * 24 * 10);

      // Check staker1's balance before withdrawal
      const balance1 = await muonToken.balanceOf(staker1.address);

      // generate a dummy tts sig to withdraw 100% of the maximum reward
      const paidReward1 = (await nodeStaking.users(staker1.address)).paidReward;
      const rewardPerToken1 = await nodeStaking.rewardPerToken();
      const earned1 = await nodeStaking.earned(staker1.address);
      const withdrawSig1 = await getDummySig(
        staker1.address,
        paidReward1,
        rewardPerToken1,
        earned1
      );

      // withdraw 100% of reward
      await getReward(staker1, withdrawSig1);

      // check the result of withdrawing
      const staker1Stake1 = await nodeStaking.users(staker1.address);
      expect(staker1Stake1.paidReward).to.equal(earned1);
      expect(staker1Stake1.paidRewardPerToken).to.equal(rewardPerToken1);
      const balance2 = await muonToken.balanceOf(staker1.address);
      expect(balance2).to.equal(balance1.add(earned1));
      expect(balance2).to.equal(Math.floor(initialReward / 9));

      // Increase time by 5 days
      await evmIncreaseTime(60 * 60 * 24 * 5);

      // generate a dummy tts sig to withdraw 100% of the maximum reward
      const paidReward2 = (await nodeStaking.users(staker1.address)).paidReward;
      const rewardPerToken2 = await nodeStaking.rewardPerToken();
      const earned2 = await nodeStaking.earned(staker1.address);
      const withdrawSig2 = await getDummySig(
        staker1.address,
        paidReward2,
        rewardPerToken2,
        earned2
      );

      // withdraw 100% of reward
      await getReward(staker1, withdrawSig2);

      // check the result of withdrawing
      const staker1Stake2 = await nodeStaking.users(staker1.address);
      expect(staker1Stake2.paidReward).to.equal(earned1.add(earned2));
      expect(staker1Stake2.paidRewardPerToken).to.equal(rewardPerToken2);
      const balance3 = await muonToken.balanceOf(staker1.address);
      expect(balance3).to.equal(balance2.add(earned2));
      // tolerance for 2 seconds
      expect(balance3).to.closeTo(Math.floor(initialReward / 6), 3000);
    });

    it("should not allow stakers to withdraw more than their reward by getting several signatures", async function () {
      // Distribute rewards
      const initialReward = thirtyDays * 3000;
      await distributeRewards(initialReward);

      // Increase time by 10 days
      await evmIncreaseTime(60 * 60 * 24 * 10);

      // Check staker1's balance before withdrawal
      const balance1 = await muonToken.balanceOf(staker1.address);

      // get first tts sig
      const paidReward1 = (await nodeStaking.users(staker1.address)).paidReward;
      const rewardPerToken1 = await nodeStaking.rewardPerToken();
      const earned1 = await nodeStaking.earned(staker1.address);
      const withdrawSig1 = await getDummySig(
        staker1.address,
        paidReward1,
        rewardPerToken1,
        earned1
      );

      // Increase time by 1 minute
      await evmIncreaseTime(60);

      // get second tts sig
      const paidReward2 = (await nodeStaking.users(staker1.address)).paidReward;
      const rewardPerToken2 = await nodeStaking.rewardPerToken();
      const earned2 = await nodeStaking.earned(staker1.address);
      const withdrawSig2 = await getDummySig(
        staker1.address,
        paidReward2,
        rewardPerToken2,
        earned2
      );

      // withdraw first time
      await getReward(staker1, withdrawSig1);

      // check the result of withdrawing
      const staker1Stake1 = await nodeStaking.users(staker1.address);
      expect(staker1Stake1.paidReward).to.equal(earned1);
      expect(staker1Stake1.paidRewardPerToken).to.equal(rewardPerToken1);
      const balance2 = await muonToken.balanceOf(staker1.address);
      expect(balance2).to.equal(balance1.add(earned1));

      // try to withdraw second time
      await expect(getReward(staker1, withdrawSig2)).to.be.revertedWith(
        "invalid signature"
      );
    });

    it("should allow exited stakers to withdraw their stake and reward after the lock period", async function () {
      // Distribute rewards
      const initialReward = thirtyDays * 3000;
      await distributeRewards(initialReward);

      // Increase time by 10 days
      await evmIncreaseTime(60 * 60 * 24 * 10);

      // generate a dummy tts sig to withdraw 100% of the maximum reward
      const paidReward1 = (await nodeStaking.users(staker1.address)).paidReward;
      const rewardPerToken1 = await nodeStaking.rewardPerToken();
      const earned1 = await nodeStaking.earned(staker1.address);
      const withdrawSig1 = await getDummySig(
        staker1.address,
        paidReward1,
        rewardPerToken1,
        earned1
      );
      // withdraw 100% of reward
      await getReward(staker1, withdrawSig1);

      const balance1 = await muonToken.balanceOf(staker1.address);

      // tolerance for 2 seconds
      expect(await nodeStaking.earned(staker1.address)).to.be.closeTo(0, 3000);

      const u1 = await nodeStaking.users(staker1.address);
      expect(u1.balance).to.equal(ONE.mul(1000));
      expect(u1.pendingRewards).to.equal(0);
      expect(u1.withdrawable).to.equal(0);

      // Increase time by 10 days
      await evmIncreaseTime(60 * 60 * 24 * 10);

      const earned2 = await nodeStaking.earned(staker1.address);

      // requestExit
      await nodeStaking.connect(staker1).requestExit();

      const u2 = await nodeStaking.users(staker1.address);
      expect(u2.balance).to.equal(ONE.mul(1000));
      expect(u2.pendingRewards).to.closeTo(earned2, 2000);
      expect(u2.withdrawable).to.equal(0);

      expect(await nodeStaking.earned(staker1.address)).to.be.equal(0);

      // generate a dummy tts sig to withdraw 80% of the maximum reward
      const paidReward2 = (await nodeStaking.users(staker1.address)).paidReward;
      const rewardPerToken2 = await nodeStaking.rewardPerToken();
      const earned3 = parseInt((u2.pendingRewards * 80) / 100);
      const withdrawSig2 = await getDummySig(
        staker1.address,
        paidReward2,
        rewardPerToken2,
        earned3
      );
      // withdraw 80% of reward
      await getReward(staker1, withdrawSig2);

      const balance2 = await muonToken.balanceOf(staker1.address);
      expect(balance2).to.closeTo(balance1.add(earned3), 2000);

      // try to withdraw stake amount
      await expect(nodeStaking.connect(staker1).withdraw()).to.be.revertedWith(
        "exit time not reached yet"
      );

      // Increase time by 7 days
      await evmIncreaseTime(60 * 60 * 24 * 7);

      expect(await vePION.ownerOf(1)).to.equal(nodeStaking.address);

      // withdraw
      await nodeStaking.connect(staker1).withdraw();

      const u3 = await nodeStaking.users(staker1.address);
      expect(u3.balance).to.equal(0);
      expect(u3.pendingRewards).to.equal(0);
      expect(u3.withdrawable).to.equal(0);
      expect(await vePION.ownerOf(1)).to.equal(staker1.address);
    });

    it("should not allow stakers to withdraw their stake if it's locked", async function () {
      // Distribute rewards
      const initialReward = thirtyDays * 3000;
      await distributeRewards(initialReward);

      // Increase time by 10 days
      await evmIncreaseTime(60 * 60 * 24 * 10);

      // try to lock non exist staker
      await expect(
        nodeStaking.connect(rewardRole).lockStake(user1.address)
      ).to.be.revertedWith("node not found");

      // try to unlock not locked staker
      await expect(
        nodeStaking.connect(rewardRole).unlockStake(staker1.address)
      ).to.be.revertedWith("is not locked");

      const earned1 = await nodeStaking.earned(staker1.address);

      // requestExit
      await nodeStaking.connect(staker1).requestExit();

      // lock the stake
      await nodeStaking.connect(rewardRole).lockStake(staker1.address);

      // Increase time by 7 days
      await evmIncreaseTime(60 * 60 * 24 * 7);

      const u1 = await nodeStaking.users(staker1.address);
      expect(u1.balance).to.equal(ONE.mul(1000));
      expect(u1.pendingRewards).to.closeTo(earned1, 2000);
      expect(u1.paidReward).to.equal(0);

      // try to withdraw the stake
      await expect(nodeStaking.connect(staker1).withdraw()).to.be.revertedWith(
        "stake is locked"
      );

      // unlock the stake
      await nodeStaking.connect(rewardRole).unlockStake(staker1.address);

      expect(await vePION.ownerOf(1)).to.equal(nodeStaking.address);

      // withdraw
      await nodeStaking.connect(staker1).withdraw();

      const u2 = await nodeStaking.users(staker1.address);
      expect(u2.balance).to.equal(0);
      expect(u2.pendingRewards).to.equal(u1.pendingRewards);
      expect(u2.paidReward).to.equal(0);

      expect(await vePION.ownerOf(1)).to.equal(staker1.address);

      // exited nodes should be able to get their unclaimed reward
      const paidReward = u2.paidReward;
      const rewardPerToken = await nodeStaking.rewardPerToken();
      const earned = u2.pendingRewards;
      const withdrawSig = await getDummySig(
        staker1.address,
        paidReward,
        rewardPerToken,
        earned
      );
      // withdraw reward
      await getReward(staker1, withdrawSig);

      const balance2 = await muonToken.balanceOf(staker1.address);
      expect(balance2).to.equal(u2.pendingRewards);

      const u3 = await nodeStaking.users(staker1.address);
      expect(u3.balance).to.equal(0);
      expect(u3.pendingRewards).to.equal(0);
      expect(u3.paidReward).to.equal(u2.pendingRewards);
    });
  });

  describe("DAO functions", function () {
    it("DAO should be able to update exitPendingPeriod", async function () {
      const newVal = 86400;
      await expect(nodeStaking.connect(daoRole).setExitPendingPeriod(newVal))
        .to.emit(nodeStaking, "ExitPendingPeriodUpdated")
        .withArgs(newVal);

      expect(await nodeStaking.exitPendingPeriod()).to.equal(newVal);
    });

    it("DAO should be able to update minStakeAmountPerNode", async function () {
      const newVal = ONE.mul(10);
      await expect(
        nodeStaking.connect(daoRole).setMinStakeAmountPerNode(newVal)
      )
        .to.emit(nodeStaking, "MinStakeAmountPerNodeUpdated")
        .withArgs(newVal);

      expect(await nodeStaking.minStakeAmountPerNode()).to.equal(newVal);
    });

    it("DAO should be able to update maxStakeAmountPerNode", async function () {
      const newVal = ONE.mul(100);
      await expect(
        nodeStaking.connect(daoRole).setMaxStakeAmountPerNode(newVal)
      )
        .to.emit(nodeStaking, "MaxStakeAmountPerNodeUpdated")
        .withArgs(newVal);

      expect(await nodeStaking.maxStakeAmountPerNode()).to.equal(newVal);
    });

    it("DAO should be able to update muonAppId", async function () {
      const newVal =
        "1566432988060666016333351531685287278204879617528298155619493815104572633000";
      await expect(nodeStaking.connect(daoRole).setMuonAppId(newVal))
        .to.emit(nodeStaking, "MuonAppIdUpdated")
        .withArgs(newVal);

      expect(await nodeStaking.muonAppId()).to.equal(newVal);
    });

    it("DAO should be able to update muonPublicKey", async function () {
      const newPublicKey = {
        x: "0x1234567890123456789012345678901234567890123456789012345678901234",
        parity: 1,
      };

      await expect(nodeStaking.connect(daoRole).setMuonPublicKey(newPublicKey))
        .to.emit(nodeStaking, "MuonPublicKeyUpdated")
        .withArgs([newPublicKey.x, newPublicKey.parity]);

      const updatedPublicKey = await nodeStaking.muonPublicKey();
      expect(updatedPublicKey.x).to.equal(newPublicKey.x);
      expect(updatedPublicKey.parity).to.equal(newPublicKey.parity);
    });

    it("DAO should be able to remove a staking tokens", async () => {
      const muonTokenIPO = await nodeStaking.isStakingToken(muonToken.address);
      const muonLpTokenIPO = await nodeStaking.isStakingToken(
        muonLpToken.address
      );
      expect(muonTokenIPO).to.equal(1);
      expect(muonLpTokenIPO).to.equal(2);
      expect(await nodeStaking.stakingTokens(muonTokenIPO - 1)).to.equal(
        muonToken.address
      );
      expect(await nodeStaking.stakingTokens(muonLpTokenIPO - 1)).to.equal(
        muonLpToken.address
      );
    });

    it("DAO should be able to add a new staking token", async () => {
      const dummyToken = ethers.Wallet.createRandom();
      const dummyTokenMultiplier = ONE.mul(3);
      await nodeStaking.updateStakingTokens(
        [dummyToken.address],
        [dummyTokenMultiplier]
      );
      expect(await nodeStaking.isStakingToken(dummyToken.address)).to.equal(3);
      expect(await nodeStaking.stakingTokens(2)).to.equal(dummyToken.address);
      expect(
        await nodeStaking.stakingTokensMultiplier(dummyToken.address)
      ).to.equal(dummyTokenMultiplier);
    });

    it("DAO should be able to update the multiplier of an existing staking token", async () => {
      expect(
        await nodeStaking.stakingTokensMultiplier(muonToken.address)
      ).to.equal(muonTokenMultiplier);
      const newMuonTokenMultiplier = ONE.mul(3);
      await nodeStaking.updateStakingTokens(
        [muonToken.address],
        [newMuonTokenMultiplier]
      );
      expect(await nodeStaking.isStakingToken(muonToken.address)).to.equal(1);
      expect(await nodeStaking.isStakingToken(muonLpToken.address)).to.equal(2);
      expect(await nodeStaking.stakingTokens(0)).to.equal(muonToken.address);
      expect(await nodeStaking.stakingTokens(1)).to.equal(muonLpToken.address);
      expect(
        await nodeStaking.stakingTokensMultiplier(muonLpToken.address)
      ).to.equal(muonLpTokenMultiplier);
      expect(
        await nodeStaking.stakingTokensMultiplier(muonToken.address)
      ).to.equal(newMuonTokenMultiplier);
    });

    it("DAO should be able to remove a staking token", async () => {
      const newMuonTokenMultiplier = 0;
      expect(await nodeStaking.stakingTokens(0)).to.equal(muonToken.address);
      await nodeStaking.updateStakingTokens(
        [muonToken.address],
        [newMuonTokenMultiplier]
      );
      expect(await nodeStaking.isStakingToken(muonToken.address)).to.equal(0);
      expect(await nodeStaking.stakingTokens(0)).to.equal(muonLpToken.address);
      expect(
        await nodeStaking.stakingTokensMultiplier(muonToken.address)
      ).to.equal(newMuonTokenMultiplier);
    });

    it("DAO should be able to add or update multiple staking tokens", async () => {
      const newMuonTokenMultiplier = ONE.mul(4);
      const newMuonLpTokenMultiplier = ONE.mul(4);
      const dummyToken1 = ethers.Wallet.createRandom();
      const dummyToken1Multiplier = ONE.mul(3);
      const dummyToken2 = ethers.Wallet.createRandom();
      const dummyToken2Multiplier = ONE.mul(4);

      expect(
        await nodeStaking.stakingTokensMultiplier(muonToken.address)
      ).to.equal(muonTokenMultiplier);
      expect(
        await nodeStaking.stakingTokensMultiplier(muonLpToken.address)
      ).to.equal(muonLpTokenMultiplier);

      await nodeStaking.updateStakingTokens(
        [
          muonToken.address,
          dummyToken1.address,
          dummyToken2.address,
          muonLpToken.address,
        ],
        [
          newMuonTokenMultiplier,
          dummyToken1Multiplier,
          dummyToken2Multiplier,
          newMuonLpTokenMultiplier,
        ]
      );

      expect(await nodeStaking.isStakingToken(muonToken.address)).to.equal(1);
      expect(await nodeStaking.isStakingToken(muonLpToken.address)).to.equal(2);
      expect(await nodeStaking.isStakingToken(dummyToken1.address)).to.equal(3);
      expect(await nodeStaking.isStakingToken(dummyToken2.address)).to.equal(4);

      expect(await nodeStaking.stakingTokens(0)).to.equal(muonToken.address);
      expect(await nodeStaking.stakingTokens(1)).to.equal(muonLpToken.address);
      expect(await nodeStaking.stakingTokens(2)).to.equal(dummyToken1.address);
      expect(await nodeStaking.stakingTokens(3)).to.equal(dummyToken2.address);
      expect(
        await nodeStaking.stakingTokensMultiplier(muonToken.address)
      ).to.equal(newMuonTokenMultiplier);
      expect(
        await nodeStaking.stakingTokensMultiplier(muonLpToken.address)
      ).to.equal(newMuonLpTokenMultiplier);
      expect(
        await nodeStaking.stakingTokensMultiplier(dummyToken1.address)
      ).to.equal(dummyToken1Multiplier);
      expect(
        await nodeStaking.stakingTokensMultiplier(dummyToken2.address)
      ).to.equal(dummyToken2Multiplier);
    });

    it("DAO should be able to remove one staking token and update another", async () => {
      const newMuonTokenMultiplier = 0;
      const newMuonLpTokenMultiplier = ONE.mul(4);

      expect(
        await nodeStaking.stakingTokensMultiplier(muonToken.address)
      ).to.equal(muonTokenMultiplier);
      expect(
        await nodeStaking.stakingTokensMultiplier(muonLpToken.address)
      ).to.equal(muonLpTokenMultiplier);

      await nodeStaking.updateStakingTokens(
        [muonLpToken.address, muonToken.address],
        [newMuonLpTokenMultiplier, newMuonTokenMultiplier]
      );

      expect(await nodeStaking.isStakingToken(muonToken.address)).to.equal(0);
      expect(await nodeStaking.isStakingToken(muonLpToken.address)).to.equal(1);
      expect(await nodeStaking.stakingTokens(0)).to.equal(muonLpToken.address);
      expect(
        await nodeStaking.stakingTokensMultiplier(muonToken.address)
      ).to.equal(newMuonTokenMultiplier);
      expect(
        await nodeStaking.stakingTokensMultiplier(muonLpToken.address)
      ).to.equal(newMuonLpTokenMultiplier);
    });
  });
});
