// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/interfaces/IERC721Upgradeable.sol";
import "./utils/SchnorrSECP256K1Verifier.sol";
import "./interfaces/IMuonNodeManager.sol";
import "./interfaces/IBondedToken.sol";

contract MuonNodeStaking is Initializable, AccessControlUpgradeable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");
    bytes32 public constant REWARD_ROLE = keccak256("REWARD_ROLE");

    uint256 public totalStaked;

    uint256 public exitPendingPeriod;

    uint256 public minStakeAmountPerNode;

    uint256 public periodFinish;

    uint256 public rewardRate;

    uint256 public lastUpdateTime;

    uint256 public rewardPerTokenStored;

    uint256 public muonAppId;

    uint256 public REWARD_PERIOD;

    PublicKey public muonPublicKey;

    struct SchnorrSign {
        uint256 signature;
        address owner;
        address nonce;
    }

    struct PublicKey {
        uint256 x;
        uint8 parity;
    }

    struct User {
        uint256 balance;
        uint256 paidReward;
        uint256 paidRewardPerToken;
        uint256 pendingRewards;
        uint256 tokenId;
    }
    mapping(address => User) public users;

    SchnorrSECP256K1Verifier public verifier;

    IMuonNodeManager public nodeManager;

    IERC20 public muonToken;

    // reqId => bool
    mapping(bytes => bool) public withdrawRequests;

    // stakerAddress => bool
    mapping(address => bool) public lockedStakes;

    // address public vePion;
    IBondedToken public bondedToken;

    // token address => index + 1
    mapping(address => uint16) public isStakingToken;

    address[] public stakingTokens;

    // token => multiplier * 1e18
    mapping(address => uint256) public stakingTokensMultiplier;

    // tier => maxStakeAmount
    mapping(uint64 => uint256) public tiersMaxStakeAmount;

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
        address bondedTokenAddress
    ) internal initializer {
        __AccessControl_init();

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(ADMIN_ROLE, msg.sender);
        _setupRole(DAO_ROLE, msg.sender);

        muonToken = IERC20(muonTokenAddress);
        nodeManager = IMuonNodeManager(nodeManagerAddress);

        exitPendingPeriod = 7 days;
        minStakeAmountPerNode = 1000 ether;
        REWARD_PERIOD = 30 days;

        verifier = SchnorrSECP256K1Verifier(verifierAddress);
        verifier.validatePubKey(_muonPublicKey.x);
        muonPublicKey = _muonPublicKey;
        muonAppId = _muonAppId;
        bondedToken = IBondedToken(bondedTokenAddress);
    }

    /**
     * @dev Initializes the contract.
     * @param muonTokenAddress The address of the Muon token.
     * @param nodeManagerAddress The address of the Muon Node Manager contract.
     * @param verifierAddress The address of the SchnorrSECP256K1Verifier contract.
     * @param _muonAppId The Muon app ID.
     * @param _muonPublicKey The Muon public key.
     * @param bondedTokenAddress The address of the BondedToken contract.
     */
    function initialize(
        address muonTokenAddress,
        address nodeManagerAddress,
        address verifierAddress,
        uint256 _muonAppId,
        PublicKey memory _muonPublicKey,
        address bondedTokenAddress
    ) external initializer {
        __MuonNodeStakingUpgradeable_init(
            muonTokenAddress,
            nodeManagerAddress,
            verifierAddress,
            _muonAppId,
            _muonPublicKey,
            bondedTokenAddress
        );
    }

    function __MuonNodeStakingUpgradeable_init_unchained()
        internal
        initializer
    {}

    /**
     * @dev Updates the list of staking tokens and their multipliers.
     * Only callable by the DAO_ROLE.
     * @param tokens The array of staking token addresses.
     * @param multipliers The array of corresponding multipliers for each token.
     */
    function updateStakingTokens(
        address[] calldata tokens,
        uint256[] calldata multipliers
    ) external onlyRole(DAO_ROLE) {
        require(
            tokens.length == multipliers.length,
            "Mismatch in the length of arrays."
        );

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
                require(
                    multiplier > 0,
                    "Invalid multiplier. The multiplier value must be greater than 0."
                );
                stakingTokens.push(token);
                stakingTokensMultiplier[token] = multiplier;
                isStakingToken[token] = uint16(stakingTokens.length);
            }
            emit StakingTokenUpdated(token, multiplier);
        }
    }

    /**
     * @dev Locks the specified tokens in the BondedToken contract for a given tokenId.
     * The staker must first approve the contract to transfer the tokens on their behalf.
     * Only the staker can call this function.
     * @param tokenId The unique identifier of the token.
     * @param tokens The array of token addresses to be locked.
     * @param amounts The corresponding array of token amounts to be locked.
     */
    function lockToBondedToken(
        uint256 tokenId,
        address[] memory tokens,
        uint256[] memory amounts
    ) external {
        require(
            tokens.length == amounts.length,
            "Mismatch in the length of arrays."
        );

        for (uint256 i = 0; i < tokens.length; i++) {
            require(
                IERC20(tokens[i]).transferFrom(
                    msg.sender,
                    address(this),
                    amounts[i]
                ),
                "Failed to transfer tokens from your account to the staker contract."
            );
            require(
                IERC20(tokens[i]).approve(address(bondedToken), amounts[i]),
                "Failed to approve to the bondedToken contract to spend tokens on your behalf."
            );
        }

        bondedToken.lock(tokenId, tokens, amounts);

        updateStaking();
    }

    /**
     * @dev Merges two bonded tokens in the BondedToken contract.
     * The staker must first approve the contract to transfer the tokenIdA on their behalf.
     * @param tokenIdA The id of the first token to be merged.
     * @param tokenIdB The id of the second token to be merged.
     */
    function mergeBondedTokens(uint256 tokenIdA, uint256 tokenIdB) external {
        bondedToken.transferFrom(msg.sender, address(this), tokenIdA);
        bondedToken.approve(address(bondedToken), tokenIdA);

        bondedToken.merge(tokenIdA, tokenIdB);

        updateStaking();
    }

    /**
     * @dev Calculates the total value of a bonded token in terms of the staking tokens.
     * @param tokenId The id of the bonded token.
     * @return amount The total value of the bonded token.
     */
    function valueOfBondedToken(uint256 tokenId)
        public
        view
        returns (uint256 amount)
    {
        uint256[] memory lockedAmounts = bondedToken.getLockedOf(
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

    /**
     * @dev Updates the staking status for the staker.
     * This function calculates the staked amount based on the locked tokens and their multipliers,
     * and updates the balance and total staked amount accordingly.
     * Only callable by staker.
     */
    function updateStaking() public updateReward(msg.sender) {
        IMuonNodeManager.Node memory node = nodeManager.stakerAddressInfo(
            msg.sender
        );
        require(
            node.id != 0 && node.active,
            "No active node found for the staker address."
        );

        uint256 tokenId = users[msg.sender].tokenId;
        require(tokenId != 0, "No staking found for the staker address.");

        uint256 amount = valueOfBondedToken(tokenId);
        require(
            amount >= minStakeAmountPerNode,
            "Insufficient amount to run a node."
        );

        uint64 tier = nodeManager.getTier(node.id);
        uint256 maxStakeAmount = tiersMaxStakeAmount[tier];
        if (amount > maxStakeAmount) {
            amount = maxStakeAmount;
        }

        if (users[msg.sender].balance != amount) {
            totalStaked -= users[msg.sender].balance;
            users[msg.sender].balance = amount;
            totalStaked += amount;
            emit Staked(msg.sender, amount);
        }
    }

    /**
     * @dev Allows the stakers to withdraw their rewards.
     * @param amount The amount of tokens to withdraw.
     * @param reqId The id of the withdrawal request.
     * @param signature A tss signature that proves the authenticity of the withdrawal request.
     */
    function getReward(
        uint256 amount,
        uint256 paidRewardPerToken,
        bytes calldata reqId,
        SchnorrSign calldata signature
    ) public {
        require(
            !withdrawRequests[reqId],
            "This request has already been submitted."
        );

        require(amount > 0, "Invalid withdrawal amount.");

        IMuonNodeManager.Node memory node = nodeManager.stakerAddressInfo(
            msg.sender
        );
        require(node.id != 0, "Node not found for the staker address.");

        require(
            paidRewardPerToken <= rewardPerToken() ||
                users[msg.sender].paidRewardPerToken < paidRewardPerToken,
            "Invalid paidRewardPerToken value."
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
        require(verified, "Invalid signature.");

        if (node.active) {
            require(amount <= earned(msg.sender), "Invalid withdrawal amount.");
        } else {
            require(
                amount <= users[msg.sender].pendingRewards,
                "Invalid withdrawal amount."
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
     * @dev Allows stakers to request to exit from the network.
     * Stakers can withdraw the staked amount after the exit pending period has passed.
     */
    function requestExit() public updateReward(msg.sender) {
        IMuonNodeManager.Node memory node = nodeManager.stakerAddressInfo(
            msg.sender
        );
        require(node.id != 0, "Node not found for the staker address.");

        require(node.active, "The node is already deactivated.");

        require(
            users[msg.sender].balance > 0,
            "No staked balance available for withdrawal."
        );

        totalStaked -= users[msg.sender].balance;
        nodeManager.deactiveNode(node.id);
        emit ExitRequested(msg.sender);
    }

    /**
     * @dev Allows stakers to withdraw their staked amount after exiting the network and exit pending period has passed.
     */
    function withdraw() public {
        IMuonNodeManager.Node memory node = nodeManager.stakerAddressInfo(
            msg.sender
        );
        require(node.id != 0, "Node not found for the staker address.");

        require(
            !node.active &&
                (node.endTime + exitPendingPeriod) < block.timestamp,
            "The exit time has not been reached yet."
        );

        require(
            !lockedStakes[msg.sender],
            "Your stake is currently locked and cannot be withdrawn."
        );

        uint256 amount = users[msg.sender].balance;
        require(amount > 0, "No staked balance available for withdrawal.");

        users[msg.sender].balance = 0;
        uint256 tokenId = users[msg.sender].tokenId;
        require(tokenId != 0, "No staking found for the staker address.");

        bondedToken.safeTransferFrom(address(this), msg.sender, tokenId);
        users[msg.sender].tokenId = 0;
        emit Withdrawn(msg.sender, tokenId);
    }

    /**
     * @dev Allows users to add a Muon node.
     * The user must have a sufficient staking amount in the BondedToken contract to run a node.
     * @param nodeAddress The address of the Muon node.
     * @param peerId The peer ID of the node.
     * @param tokenId The id of the staking token.
     */
    function addMuonNode(
        address nodeAddress,
        string calldata peerId,
        uint256 tokenId
    ) public {
        require(
            users[msg.sender].tokenId == 0,
            "You have already staked an NFT. Multiple staking is not allowed."
        );

        uint256 amount = valueOfBondedToken(tokenId);
        require(
            amount >= minStakeAmountPerNode,
            "Insufficient amount to run a node."
        );

        bondedToken.transferFrom(msg.sender, address(this), tokenId);
        users[msg.sender].tokenId = tokenId;

        nodeManager.addNode(
            nodeAddress,
            msg.sender, // stakerAddress,
            peerId,
            true // active
        );

        emit MuonNodeAdded(nodeAddress, msg.sender, peerId);
    }

    /**
     * @dev Distributes the specified reward amount to the stakers.
     * Only callable by the REWARD_ROLE.
     * @param reward The reward amount to be distributed.
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
     * @dev Calculates the current reward per token.
     * The reward per token is the amount of reward earned per staking token until now.
     * @return The current reward per token.
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
     * @dev Calculates the total rewards earned by a node.
     * @param account The staker address of a node.
     * @return The total rewards earned by a node.
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
     * @dev Returns the last time when rewards were applicable.
     * @return The last time when rewards were applicable.
     */
    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /**
     * @dev Locks the specified staker's stake.
     * Only callable by the REWARD_ROLE.
     * @param stakerAddress The address of the staker.
     */
    function lockStake(address stakerAddress) public onlyRole(REWARD_ROLE) {
        IMuonNodeManager.Node memory node = nodeManager.stakerAddressInfo(
            stakerAddress
        );
        require(node.id != 0, "Node not found for the staker address.");

        lockedStakes[stakerAddress] = true;
        emit StakeLocked(stakerAddress);
    }

    /**
     * @dev Unlocks the specified staker's stake.
     * Only callable by the REWARD_ROLE.
     * @param stakerAddress The address of the staker.
     */
    function unlockStake(address stakerAddress) public onlyRole(REWARD_ROLE) {
        require(lockedStakes[stakerAddress], "The stake is not locked.");

        lockedStakes[stakerAddress] = false;
        emit StakeUnlocked(stakerAddress);
    }

    // ======== DAO functions ========

    function setExitPendingPeriod(uint256 val) public onlyRole(DAO_ROLE) {
        exitPendingPeriod = val;
        emit ExitPendingPeriodUpdated(val);
    }

    function setMinStakeAmountPerNode(uint256 val) public onlyRole(DAO_ROLE) {
        minStakeAmountPerNode = val;
        emit MinStakeAmountPerNodeUpdated(val);
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

    // ======== Events ========
    event Staked(address indexed stakerAddress, uint256 amount);
    event Withdrawn(address indexed stakerAddress, uint256 tokenId);
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
    event MuonAppIdUpdated(uint256 muonAppId);
    event MuonPublicKeyUpdated(PublicKey muonPublicKey);
    event StakeLocked(address indexed stakerAddress);
    event StakeUnlocked(address indexed stakerAddress);
    event StakingTokenUpdated(address indexed token, uint256 multiplier);
    event TierMaxStakeUpdated(uint64 tier, uint256 maxStakeAmount);
}
