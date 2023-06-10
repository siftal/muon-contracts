// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/interfaces/IERC721Upgradeable.sol";
import "./IMuonNodeManagerV2.sol";
import "./IVePION.sol";
import "./utils/SchnorrSECP256K1Verifier.sol";

/**
 * @dev Staking contracts for the Muon Nodes
 *
 * Important functions:
 *
 * - addMuonNode
 * Lets the users stake more than a predefined minimum
 * amount of tokens and add a node.
 *
 * - requestExit
 * Nodes that want to exit the network, need to call this function
 * to remove their nodes from the network. The staked amount will be
 * kept in the contract for a period and then they can withdraw
 *
 * - withdraw
 * Lets the users withdraw their staked amount
 *
 * - getReward
 * Lets the users withdraw their rewards
 */
contract MuonNodeStakingUpgradeableV2 is
    Initializable,
    AccessControlUpgradeable
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");
    bytes32 public constant REWARD_ROLE = keccak256("REWARD_ROLE");

    struct User {
        uint256 balance;
        uint256 paidReward;
        uint256 paidRewardPerToken;
        uint256 pendingRewards;
        uint256 withdrawable;
    }

    mapping(address => User) public users;

    IERC20 public muonToken;

    IMuonNodeManager public nodeManager;

    uint256 public totalStaked;

    // ===== configs ======

    // Nodes should deactive their nodes first
    // and wait for some time to be able to unstake
    uint256 public exitPendingPeriod;

    uint256 public minStakeAmountPerNode;
    uint256 public maxStakeAmountPerNode;

    uint256 public REWARD_PERIOD;

    uint256 public periodFinish;
    uint256 public rewardRate;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    // new state variables
    struct SchnorrSign {
        uint256 signature;
        address owner;
        address nonce;
    }
    struct PublicKey {
        uint256 x;
        uint8 parity;
    }
    uint256 public muonAppId;
    PublicKey public muonPublicKey;
    SchnorrSECP256K1Verifier public verifier;
    // reqId => bool
    mapping(bytes => bool) public withdrawRequests;
    // stakerAddress => bool
    mapping(address => bool) public lockedStakes;

    address public vePion;

    // token address => index + 1
    mapping(address => uint16) public isStakingToken;

    address[] public stakingTokens;

    // token => multiplier * 1e18
    mapping(address => uint256) public stakingTokensMultiplier;

    // tier => maxStakeAmount
    mapping(uint64 => uint256) public tiersMaxStakeAmount;

    // stakerAddress => vePion id
    mapping(address => uint256) public usersTokenId;

    event Staked(address indexed stakerAddress, uint256 amount);
    event Withdrawn(address indexed stakerAddress, uint256 amount);
    event RewardGot(bytes reqId, address indexed stakerAddress, uint256 amount);
    event ExitRequested(address indexed stakerAddress);
    event MuonNodeAdded(
        address indexed nodeAddress,
        address indexed stakerAddress,
        string peerId
    );
    event RewardsDistributed(
        uint256 reward,
        uint256 periodStart,
        uint256 rewardPeriod
    );
    event ExitPendingPeriodUpdated(uint256 exitPendingPeriod);
    event MinStakeAmountPerNodeUpdated(uint256 minStakeAmountPerNode);
    event MaxStakeAmountPerNodeUpdated(uint256 maxStakeAmountPerNode);
    event MuonAppIdUpdated(uint256 muonAppId);
    event MuonPublicKeyUpdated(PublicKey muonPublicKey);
    event StakeLocked(address indexed stakerAddress);
    event StakeUnlocked(address indexed stakerAddress);
    event StakingTokenUpdated(address indexed token, uint256 multiplier);
    event TierMaxStakeUpdated(uint64 tier, uint256 maxStakeAmount);

    /**
     * @dev Modifier that updates the reward parameters
     * before all of the functions that can change the rewards.
     *
     * `_forAddress` should be address(0) when new rewards are distributing.
     */
    modifier updateReward(address _forAddress) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (_forAddress != address(0)) {
            users[_forAddress].pendingRewards = earned(_forAddress);
            users[_forAddress].paidRewardPerToken = rewardPerTokenStored;
        }
        _;
    }

    function __MuonNodeStakingUpgradeable_init(
        address muonTokenAddress,
        address nodeManagerAddress,
        address verifierAddress,
        uint256 _muonAppId,
        PublicKey memory _muonPublicKey,
        address _vePion
    ) internal initializer {
        __AccessControl_init();

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(ADMIN_ROLE, msg.sender);
        _setupRole(DAO_ROLE, msg.sender);

        muonToken = IERC20(muonTokenAddress);
        nodeManager = IMuonNodeManager(nodeManagerAddress);

        exitPendingPeriod = 7 days;
        minStakeAmountPerNode = 1000 ether;
        maxStakeAmountPerNode = 10000 ether;
        REWARD_PERIOD = 30 days;

        verifier = SchnorrSECP256K1Verifier(verifierAddress);
        verifier.validatePubKey(_muonPublicKey.x);
        muonPublicKey = _muonPublicKey;
        muonAppId = _muonAppId;
        vePion = _vePion;
    }

    function initialize(
        address muonTokenAddress,
        address nodeManagerAddress,
        address verifierAddress,
        uint256 _muonAppId,
        PublicKey memory _muonPublicKey,
        address _vePion
    ) external initializer {
        __MuonNodeStakingUpgradeable_init(
            muonTokenAddress,
            nodeManagerAddress,
            verifierAddress,
            _muonAppId,
            _muonPublicKey,
            _vePion
        );
    }

    function __MuonNodeStakingUpgradeable_init_unchained()
        internal
        initializer
    {}

    function updateStakingTokens(address[] calldata tokens, uint256[] calldata multipliers)
        external
        onlyRole(DAO_ROLE)
    {
        require(tokens.length == multipliers.length, "Arrays length mismatch");

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 multiplier = multipliers[i];

            if (isStakingToken[token] > 0) {
                if (multiplier == 0) {
                    uint16 tokenIndex = isStakingToken[token] - 1;
                    address lastToken = stakingTokens[stakingTokens.length - 1];

                    stakingTokens[tokenIndex] = lastToken;
                    isStakingToken[lastToken] = isStakingToken[token];
                    stakingTokens.pop();
                    isStakingToken[token] = 0;
                }

                stakingTokensMultiplier[token] = multiplier;
            } else {
                require(multiplier > 0, "Multiplier must be greater than 0");
                stakingTokens.push(token);
                stakingTokensMultiplier[token] = multiplier;
                isStakingToken[token] = uint16(stakingTokens.length);
            }
            emit StakingTokenUpdated(token, multiplier);
        }
    }

    function valueOfVePion(uint256 tokenId)
        public
        view
        returns (uint256 amount)
    {
        uint256[] memory lockedAmounts = IVePION(vePion).getLockedOf(
            tokenId,
            stakingTokens
        );
        amount = 0;
        for (uint256 i = 0; i < lockedAmounts.length; i++) {
            address token = stakingTokens[i];
            uint256 multiplier = stakingTokensMultiplier[token];
            amount += (multiplier * lockedAmounts[i]) / 1e18;
        }
        return amount;
    }

    function updateStaking() public updateReward(msg.sender) {
        IMuonNodeManager.Node memory node = nodeManager.stakerAddressInfo(
            msg.sender
        );
        require(node.id != 0 && node.active, "no active node");

        uint256 tokenId = usersTokenId[msg.sender];
        require(tokenId != 0, "no staking NFT");

        uint256 amount = valueOfVePion(tokenId);
        require(
            amount >= minStakeAmountPerNode,
            "the amount is not enough for running a node"
        );

        uint64 tier = nodeManager.getTier(node.id);
        uint256 maxStakeAmount = tiersMaxStakeAmount[tier];
        if (amount > maxStakeAmount) {
            amount = maxStakeAmount;
        }
        totalStaked -= users[msg.sender].balance;
        users[msg.sender].balance = amount;
        totalStaked += amount;
        emit Staked(msg.sender, amount);
    }

    /**
     * @dev Allows the users to withdraw the staked amount after exiting.
     */
    function withdraw() public {
        IMuonNodeManager.Node memory node = nodeManager.stakerAddressInfo(
            msg.sender
        );
        require(node.id != 0, "node not found");

        require(
            !node.active &&
                (node.endTime + exitPendingPeriod) < block.timestamp,
            "exit time not reached yet"
        );

        require(!lockedStakes[msg.sender], "stake is locked");

        uint256 amount = users[msg.sender].balance;
        require(amount > 0, "balance=0");
        users[msg.sender].balance = 0;

        uint256 tokenId = usersTokenId[msg.sender];
        IERC721Upgradeable(vePion).safeTransferFrom(
            address(this),
            msg.sender,
            tokenId
        );
        usersTokenId[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev Allows the users to withdraw their rewards.
     * @param amount The amount of tokens to withdraw.
     * @param reqId A unique identifier for this withdrawal request.
     * @param signature A tss signature that proves the authenticity of the withdrawal request.
     */
    function getReward(
        uint256 amount,
        uint256 paidRewardPerToken,
        bytes calldata reqId,
        SchnorrSign calldata signature
    ) public {
        // Check if the withdrawal request with the given reqId has already been submitted.
        require(!withdrawRequests[reqId], "this request already submitted");

        // Check if the amount parameter is greater than 0.
        require(amount > 0, "invalid amount");

        IMuonNodeManager.Node memory node = nodeManager.stakerAddressInfo(
            msg.sender
        );
        require(node.id != 0, "node not found");

        require(
            paidRewardPerToken <= rewardPerToken(),
            "invalid paidRewardPerToken"
        );
        require(
            users[msg.sender].paidRewardPerToken <= paidRewardPerToken,
            "invalid paidRewardPerToken"
        );

        // Verify the authenticity of the withdrawal request.
        bytes32 hash = keccak256(
            abi.encodePacked(
                muonAppId,
                reqId,
                msg.sender,
                users[msg.sender].paidReward,
                paidRewardPerToken,
                amount
            )
        );
        bool verified = verifier.verifySignature(
            muonPublicKey.x,
            muonPublicKey.parity,
            signature.signature,
            uint256(hash),
            signature.nonce
        );
        require(verified, "invalid signature");

        if (node.active) {
            require(amount <= earned(msg.sender), "invalid amount");
        } else {
            require(
                amount <= users[msg.sender].pendingRewards,
                "invalid amount"
            );
        }

        users[msg.sender].pendingRewards = 0;
        users[msg.sender].paidReward += amount;
        users[msg.sender].paidRewardPerToken = paidRewardPerToken;
        withdrawRequests[reqId] = true;
        muonToken.transfer(msg.sender, amount);
        emit RewardGot(reqId, msg.sender, amount);
    }

    /**
     * @dev Allows the users to request to exit their nodes
     * from the nework
     */
    function requestExit() public updateReward(msg.sender) {
        IMuonNodeManager.Node memory node = nodeManager.stakerAddressInfo(
            msg.sender
        );
        require(node.id != 0, "node not found");

        require(node.active, "already deactivated");

        require(users[msg.sender].balance > 0, "balance=0");

        totalStaked -= users[msg.sender].balance;
        nodeManager.deactiveNode(node.id);
        emit ExitRequested(msg.sender);
    }

    /**
     * @dev Lets the users stake
     * minimum `minStakeAmountPerNode` tokens
     * to run a node.
     */
    function addMuonNode(
        address nodeAddress,
        string calldata peerId,
        uint256 tokenId
    ) public {
        require(
            usersTokenId[msg.sender] == 0,
            "This node already staked an NFT"
        );

        uint256 amount = valueOfVePion(tokenId);
        require(
            amount >= minStakeAmountPerNode,
            "the amount is not enough for running a node"
        );

        IERC721Upgradeable(vePion).transferFrom(
            msg.sender,
            address(this),
            tokenId
        );
        usersTokenId[msg.sender] = tokenId;

        nodeManager.addNode(
            nodeAddress,
            msg.sender, // stakerAddress,
            peerId,
            true // active
        );

        emit MuonNodeAdded(nodeAddress, msg.sender, peerId);
    }

    /**
     * @dev A wallet/contract that has REWARD_ROLE access
     * can call this function to distribute the rewards.
     *
     * Tokens should be transferred to the contract before
     * calling this function.
     */
    function distributeRewards(uint256 reward)
        public
        updateReward(address(0))
        onlyRole(REWARD_ROLE)
    {
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / REWARD_PERIOD;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / REWARD_PERIOD;
        }
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + REWARD_PERIOD;
        emit RewardsDistributed(reward, block.timestamp, REWARD_PERIOD);
    }

    /**
     * @dev Calculates rewardPerToken until now
     */
    function rewardPerToken() public view returns (uint256) {
        return
            totalStaked == 0
                ? rewardPerTokenStored
                : rewardPerTokenStored +
                    (((lastTimeRewardApplicable() - lastUpdateTime) *
                        rewardRate *
                        1e18) / totalStaked);
    }

    /**
     * @dev Total rewards for an `account`
     */
    function earned(address account) public view returns (uint256) {
        IMuonNodeManager.Node memory node = nodeManager.stakerAddressInfo(
            account
        );

        if (!node.active) {
            return 0;
        } else {
            return
                (users[account].balance *
                    (rewardPerToken() - users[account].paidRewardPerToken)) /
                1e18 +
                users[account].pendingRewards;
        }
    }

    /**
     * @dev Last time of the current reward period
     */
    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /**
     * @dev Allows the admins to lock users' stake.
     * @param stakerAddress The staker's address.
     */
    function lockStake(address stakerAddress) public onlyRole(REWARD_ROLE) {
        IMuonNodeManager.Node memory node = nodeManager.stakerAddressInfo(
            stakerAddress
        );
        require(node.id != 0, "node not found");

        lockedStakes[stakerAddress] = true;
        emit StakeLocked(stakerAddress);
    }

    /**
     * @dev Allows the admins to unlock users' stake.
     * @param stakerAddress The staker's address.
     */
    function unlockStake(address stakerAddress) public onlyRole(REWARD_ROLE) {
        require(lockedStakes[stakerAddress], "is not locked");

        lockedStakes[stakerAddress] = false;
        emit StakeUnlocked(stakerAddress);
    }

    // ======== DAO functions ====================

    function setExitPendingPeriod(uint256 val) public onlyRole(DAO_ROLE) {
        exitPendingPeriod = val;
        emit ExitPendingPeriodUpdated(val);
    }

    function setMinStakeAmountPerNode(uint256 val) public onlyRole(DAO_ROLE) {
        minStakeAmountPerNode = val;
        emit MinStakeAmountPerNodeUpdated(val);
    }

    function setMaxStakeAmountPerNode(uint256 val) public onlyRole(DAO_ROLE) {
        maxStakeAmountPerNode = val;
        emit MaxStakeAmountPerNodeUpdated(val);
    }

    function setMuonAppId(uint256 _muonAppId) public onlyRole(DAO_ROLE) {
        muonAppId = _muonAppId;
        emit MuonAppIdUpdated(_muonAppId);
    }

    function setMuonPublicKey(PublicKey memory _muonPublicKey)
        public
        onlyRole(DAO_ROLE)
    {
        verifier.validatePubKey(_muonPublicKey.x);

        muonPublicKey = _muonPublicKey;
        emit MuonPublicKeyUpdated(_muonPublicKey);
    }

    function setTierMaxStakeAmount(uint64 tier, uint256 maxStakeAmount)
        public
        onlyRole(DAO_ROLE)
    {
        tiersMaxStakeAmount[tier] = maxStakeAmount;
        emit TierMaxStakeUpdated(tier, maxStakeAmount);
    }
}
