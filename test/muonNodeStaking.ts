import { ethers, upgrades } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import axios from "axios";

import { MuonNodeStakingUpgradeableV2 } from "../typechain/MuonNodeStakingUpgradeableV2";
import { MuonNodeManager } from "../typechain/MuonNodeManager";
import { MuonTestToken } from "../typechain/MuonTestToken";

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

  const peerId1 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh1";
  const peerId2 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh2";
  const peerId3 = "QmQ28Fae738pmSuhQPYtsDtwU8pKYPPgf76pSN61T3APh3";

  let nodeManager: MuonNodeManager;
  let muonToken: MuonTestToken;
  let nodeStaking: MuonNodeStakingUpgradeableV2;
  const thirtyDays = 2592000;

  beforeEach(async function () {
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
    ] = await ethers.getSigners();

    const SchnorrSECP256K1Verifier = await ethers.getContractFactory(
      "SchnorrSECP256K1Verifier"
    );
    const verifier = await SchnorrSECP256K1Verifier.connect(deployer).deploy();
    await verifier.deployed();

    const MuonTestToken = await ethers.getContractFactory("MuonTestToken");
    muonToken = await MuonTestToken.connect(deployer).deploy();
    await muonToken.deployed();

    const MuonNodeManager = await ethers.getContractFactory("MuonNodeManager");
    nodeManager = await MuonNodeManager.connect(deployer).deploy();
    await nodeManager.deployed();

    const muonAppId =
      "1566432988060666016333351531685287278204879617528298155619493815104572633831";
    const muonPublicKey = {
      x: "0x570513014bbf0ddc4b0ac6b71164ff1186f26053a4df9facd79d9268456090c9",
      parity: 0,
    };

    const MuonNodeStakingUpgradeableV2 = await ethers.getContractFactory(
      "MuonNodeStakingUpgradeableV2"
    );
    nodeStaking = await upgrades.deployProxy(MuonNodeStakingUpgradeableV2, [
      muonToken.address,
      nodeManager.address,
      verifier.address,
      muonAppId,
      muonPublicKey,
    ]);
    await nodeStaking.deployed();

    await nodeStaking
      .connect(deployer)
      .grantRole(await nodeStaking.DAO_ROLE(), daoRole.address);

    await nodeStaking
      .connect(deployer)
      .grantRole(await nodeStaking.REWARD_ROLE(), rewardRole.address);

    await nodeManager
      .connect(deployer)
      .grantRole(await nodeManager.ADMIN_ROLE(), nodeStaking.address);

    await muonToken
      .connect(deployer)
      .mint(rewardRole.address, ONE.mul(2000000));

    await muonToken.connect(staker1).mint(staker1.address, ONE.mul(1000));
    await muonToken
      .connect(staker1)
      .approve(nodeStaking.address, ONE.mul(1000));
    await nodeStaking
      .connect(staker1)
      .addMuonNode(node1.address, peerId1, ONE.mul(1000));

    await muonToken.connect(deployer).mint(staker2.address, ONE.mul(2000));
    await muonToken
      .connect(staker2)
      .approve(nodeStaking.address, ONE.mul(2000));
    await nodeStaking
      .connect(staker2)
      .addMuonNode(node2.address, peerId2, ONE.mul(2000));

    await muonToken.connect(deployer).mint(staker3.address, ONE.mul(4000));
  });

  const getDummySig = async (
    stakerAddress,
    paidReward,
    rewardPerToken,
    amount
  ) => {
    const response = await axios.get(
      `http://localhost:8000/v1/?app=tss_reward_oracle_test&method=reward&params[stakerAddress]=${stakerAddress}&params[paidReward]=${paidReward}&params[rewardPerToken]=${rewardPerToken}&params[amount]=${amount}`
    );
    return response.data;
  };

  const distributeRewards = async (initialReward) => {
    await muonToken
      .connect(rewardRole)
      .transfer(nodeStaking.address, initialReward);
    await nodeStaking.connect(rewardRole).distributeRewards(initialReward);
  };

  const evmIncreaseTime = async (amount) => {
    const fifteenDays = 60 * 60 * 24 * 15;
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

      const staker1Balance = (await nodeStaking.users(staker1.address)).balance;
      expect(staker1Balance).to.equal(ONE.mul(1000));

      const info2 = await nodeManager.nodeAddressInfo(node2.address);
      expect(info2.id).to.equal(2);
      expect(info2.nodeAddress).to.equal(node2.address);
      expect(info2.stakerAddress).to.equal(staker2.address);
      expect(info2.peerId).to.equal(peerId2);
      expect(info2.active).to.equal(true);
      expect(info2.endTime).to.equal(0);

      const staker2Balance = (await nodeStaking.users(staker2.address)).balance;
      expect(staker2Balance.toString()).to.equal(ONE.mul(2000).toString());
    });

    it("should not add Muon nodes with insufficient stake", async function () {
      const insufficientStake = ONE.mul(500);
      await expect(
        nodeStaking
          .connect(staker3)
          .addMuonNode(node3.address, peerId3, insufficientStake)
      ).to.be.revertedWith(
        "initialStakeAmount is not enough for running a node"
      );
    });

    it("should not add Muon nodes with more than the maximum stake amount", async function () {
      const excessiveStake = ONE.mul(15000);
      await expect(
        nodeStaking
          .connect(staker3)
          .addMuonNode(node3.address, peerId3, excessiveStake)
      ).to.be.revertedWith(">maxStakeAmountPerNode");
    });

    it("should transfer tokens from the staker to the staking contract when adding a Muon node", async function () {
      const initialStakerBalance = await muonToken.balanceOf(staker3.address);
      const initialContractBalance = await muonToken.balanceOf(
        nodeStaking.address
      );

      const stakeAmount = ONE.mul(1000);
      await muonToken
        .connect(staker3)
        .approve(nodeStaking.address, stakeAmount);
      await nodeStaking
        .connect(staker3)
        .addMuonNode(node3.address, peerId3, stakeAmount);

      const newStakerBalance = await muonToken.balanceOf(staker3.address);
      const newContractBalance = await muonToken.balanceOf(nodeStaking.address);

      expect(newStakerBalance).to.equal(initialStakerBalance.sub(stakeAmount));
      expect(newContractBalance).to.equal(
        initialContractBalance.add(stakeAmount)
      );
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
      await muonToken
        .connect(staker3)
        .approve(nodeStaking.address, ONE.mul(3000));

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
      await nodeStaking
        .connect(staker3)
        .addMuonNode(node3.address, peerId3, ONE.mul(3000));

      // Increase time by 10 days
      targetTimestamp = distributeTimestamp + 2 * tenDays;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        targetTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      const staker1ExpectedReward =
        (tenDays * 18000) / 3 + (tenDays * 18000) / 6;
      const staker1ActualReward = await nodeStaking.earned(staker1.address);
      expect(staker1ActualReward).to.be.equal(staker1ExpectedReward);

      const staker2ExpectedReward =
        ((tenDays * 18000) / 3) * 2 + ((tenDays * 18000) / 6) * 2;
      const staker2ActualReward = await nodeStaking.earned(staker2.address);
      expect(staker2ActualReward).to.be.equal(staker2ExpectedReward);

      const staker3ExpectedReward = ((tenDays * 18000) / 6) * 3;
      const staker3ActualReward = await nodeStaking.earned(staker3.address);
      expect(staker3ActualReward).to.be.equal(staker3ExpectedReward);
    });

    it("should update rewards correctly after stake more", async function () {
      await muonToken.connect(deployer).mint(staker2.address, ONE.mul(3000));
      await muonToken
        .connect(staker2)
        .approve(nodeStaking.address, ONE.mul(3000));

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

      const staker2Stake1 = await nodeStaking.users(staker2.address);

      // stakeMore
      await nodeStaking.connect(staker2).stakeMore(ONE.mul(3000));

      const staker2Stake2 = await nodeStaking.users(staker2.address);
      expect(staker2Stake2.balance).to.be.equal(
        staker2Stake1.balance.add(ONE.mul(3000))
      );
      expect(staker2Stake2.pendingRewards).to.be.equal(
        (tenDays * 18000 * 2) / 3
      );
      expect(staker2Stake2.balance).to.be.equal(ONE.mul(5000));

      // Increase time by 10 days
      targetTimestamp = distributeTimestamp + 2 * tenDays;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        targetTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      const staker1ExpectedReward =
        (tenDays * 18000) / 3 + (tenDays * 18000) / 6;
      const staker1ActualReward = await nodeStaking.earned(staker1.address);
      expect(staker1ActualReward).to.be.equal(staker1ExpectedReward);

      const staker2ExpectedReward =
        ((tenDays * 18000) / 3) * 2 + ((tenDays * 18000) / 6) * 5;
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
      expect(await nodeStaking.earned(staker1.address)).to.closeTo(0, 2000);
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
      expect(balance3).to.closeTo(Math.floor(initialReward / 6), 2000);
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
      expect(await nodeStaking.earned(staker1.address)).to.be.closeTo(0, 2000);

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
      // withdraw 100% of reward
      await getReward(staker1, withdrawSig2);

      const balance2 = await muonToken.balanceOf(staker1.address);
      expect(balance2).to.closeTo(balance1.add(earned3), 2000);

      // try to withdraw stake amount
      await expect(nodeStaking.connect(staker1).withdraw()).to.be.revertedWith(
        "exit time not reached yet"
      );

      // Increase time by 7 days
      await evmIncreaseTime(60 * 60 * 24 * 7);

      // withdraw
      await nodeStaking.connect(staker1).withdraw();

      const u3 = await nodeStaking.users(staker1.address);
      expect(u3.balance).to.equal(0);
      expect(u3.pendingRewards).to.equal(0);
      expect(u3.withdrawable).to.equal(0);

      const balance3 = await muonToken.balanceOf(staker1.address);
      expect(balance3).to.equal(balance2.add(u2.balance));
    });
  });

  describe("DAO functions", function () {
    it("DAO should  be able to update exitPendingPeriod", async function () {
      const newVal = 86400;
      await expect(nodeStaking.connect(daoRole).setExitPendingPeriod(newVal))
        .to.emit(nodeStaking, "ExitPendingPeriodUpdated")
        .withArgs(newVal);

      expect(await nodeStaking.exitPendingPeriod()).to.equal(newVal);
    });

    it("DAO should  be able to update minStakeAmountPerNode", async function () {
      const newVal = ONE.mul(10);
      await expect(
        nodeStaking.connect(daoRole).setMinStakeAmountPerNode(newVal)
      )
        .to.emit(nodeStaking, "MinStakeAmountPerNodeUpdated")
        .withArgs(newVal);

      expect(await nodeStaking.minStakeAmountPerNode()).to.equal(newVal);
    });

    it("DAO should  be able to update maxStakeAmountPerNode", async function () {
      const newVal = ONE.mul(100);
      await expect(
        nodeStaking.connect(daoRole).setMaxStakeAmountPerNode(newVal)
      )
        .to.emit(nodeStaking, "MaxStakeAmountPerNodeUpdated")
        .withArgs(newVal);

      expect(await nodeStaking.maxStakeAmountPerNode()).to.equal(newVal);
    });

    it("DAO should  be able to update muonAppId", async function () {
      const newVal =
        "1566432988060666016333351531685287278204879617528298155619493815104572633000";
      await expect(nodeStaking.connect(daoRole).setMuonAppId(newVal))
        .to.emit(nodeStaking, "MuonAppIdUpdated")
        .withArgs(newVal);

      expect(await nodeStaking.muonAppId()).to.equal(newVal);
    });

    it("DAO should  be able to update muonPublicKey", async function () {
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
  });
});
