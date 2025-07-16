// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract MultiTokenStaking is
    Initializable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    IERC20 public usdt;
    IERC20 public usdc;
    IERC20 public dai;

    struct RewardPool {
        uint256 usdtBalance;
        uint256 usdcBalance;
        uint256 daiBalance;
    }
    RewardPool public rewardPool;
    struct APYTier {
        uint256 minStakeAmount;
        uint256 apy; // in basis points (100 = 1%)
        uint256 lockPeriod; // in seconds
    }
    APYTier[] public tiers;
    struct Staker {
        uint256 amount;
        uint256 tokenType; // 0=USDT, 1=USDC, 2=DAI
        uint256 tier;
        uint256 startTime;
        uint256 lastClaimTime;
        uint256 claimedRewards;
    }
    mapping(address => Staker[]) public stakers;

    // Events
    event Staked(
        address indexed user,
        uint256 amount,
        uint256 tokenType,
        uint256 tier
    );
    event Unstaked(address indexed user, uint256 amount, uint256 tokenType);
    event RewardClaimed(
        address indexed user,
        uint256 amount,
        uint256 tokenType
    );
    event FallbackReceived(address indexed sender, uint256 amount);
    // constructor(
    //     address _usdt,
    //     address _usdc,
    //     address _dai,
    //     uint256[] memory _minStakeAmounts,
    //     uint256[] memory _apys,
    //     uint256[] memory _lockPeriods
    // )
    function initialize(
        address _usdt,
        address _usdc,
        address _dai,
        uint256[] memory _minStakeAmounts,
        uint256[] memory _apys,
        uint256[] memory _lockPeriods
    ) public initializer {
        require(
            _minStakeAmounts.length == 3 &&
                _apys.length == 3 &&
                _lockPeriods.length == 3,
            "Invalid tier setup"
        );
        __ReentrancyGuard_init();
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __Pausable_init();
        usdt = IERC20(_usdt);
        usdc = IERC20(_usdc);
        dai = IERC20(_dai);

        for (uint256 i = 0; i < 3; i++) {
            tiers.push(
                APYTier({
                    minStakeAmount: _minStakeAmounts[i],
                    apy: _apys[i],
                    lockPeriod: _lockPeriods[i]
                })
            );
        }
    }
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}
    fallback() external payable {
        emit FallbackReceived(msg.sender, msg.value);
    }

    receive() external payable {
        emit FallbackReceived(msg.sender, msg.value);
    }
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
    function addRewardFunds(
        uint256 usdtAmount,
        uint256 usdcAmount,
        uint256 daiAmount
    ) external onlyOwner {
        if (usdtAmount > 0) {
            usdt.transferFrom(msg.sender, address(this), usdtAmount);
            rewardPool.usdtBalance += usdtAmount;
        }
        if (usdcAmount > 0) {
            usdc.transferFrom(msg.sender, address(this), usdcAmount);
            rewardPool.usdcBalance += usdcAmount;
        }
        if (daiAmount > 0) {
            dai.transferFrom(msg.sender, address(this), daiAmount);
            rewardPool.daiBalance += daiAmount;
        }
    }

    function stake(
        uint256 amount,
        uint256 tokenType,
        uint256 tier
    ) external nonReentrant {
        require(tier < 3, "Invalid tier");
        require(
            amount >= tiers[tier].minStakeAmount,
            "Amount below minimum for tier"
        );

        IERC20 token = _getToken(tokenType);
        token.transferFrom(msg.sender, address(this), amount);

        stakers[msg.sender].push(
            Staker({
                amount: amount,
                tokenType: tokenType,
                tier: tier,
                startTime: block.timestamp,
                lastClaimTime: block.timestamp,
                claimedRewards: 0
            })
        );

        emit Staked(msg.sender, amount, tokenType, tier);
    }

    function unstake(uint256 stakeIndex) external nonReentrant {
        require(stakeIndex < stakers[msg.sender].length, "Invalid stake index");
        Staker storage staker = stakers[msg.sender][stakeIndex];

        require(
            block.timestamp >= staker.startTime + tiers[staker.tier].lockPeriod,
            "Lock period not ended"
        );
        _claimReward(stakeIndex);

        IERC20 token = _getToken(staker.tokenType);
        token.transfer(msg.sender, staker.amount);
        _removeStake(msg.sender, stakeIndex);

        emit Unstaked(msg.sender, staker.amount, staker.tokenType);
    }

    function claimReward(uint256 stakeIndex) external nonReentrant {
        _claimReward(stakeIndex);
    }

    function _claimReward(uint256 stakeIndex) internal {
        Staker storage staker = stakers[msg.sender][stakeIndex];
        uint256 reward = calculateReward(msg.sender, stakeIndex);

        if (reward > 0) {
            uint256 usdtReward = (reward * rewardPool.usdtBalance) /
                (rewardPool.usdtBalance +
                    rewardPool.usdcBalance +
                    rewardPool.daiBalance);
            uint256 usdcReward = (reward * rewardPool.usdcBalance) /
                (rewardPool.usdtBalance +
                    rewardPool.usdcBalance +
                    rewardPool.daiBalance);
            uint256 daiReward = reward - usdtReward - usdcReward;

            // Ensure we don't overdraw from the pool
            usdtReward = usdtReward > rewardPool.usdtBalance
                ? rewardPool.usdtBalance
                : usdtReward;
            usdcReward = usdcReward > rewardPool.usdcBalance
                ? rewardPool.usdcBalance
                : usdcReward;
            daiReward = daiReward > rewardPool.daiBalance
                ? rewardPool.daiBalance
                : daiReward;

            // Update pool balances
            rewardPool.usdtBalance -= usdtReward;
            rewardPool.usdcBalance -= usdcReward;
            rewardPool.daiBalance -= daiReward;

            // Transfer rewards
            if (usdtReward > 0) usdt.transfer(msg.sender, usdtReward);
            if (usdcReward > 0) usdc.transfer(msg.sender, usdcReward);
            if (daiReward > 0) dai.transfer(msg.sender, daiReward);

            staker.claimedRewards += reward;
            staker.lastClaimTime = block.timestamp;

            emit RewardClaimed(msg.sender, reward, staker.tokenType);
        }
    }

    // Calculate pending reward
    function calculateReward(
        address user,
        uint256 stakeIndex
    ) public view returns (uint256) {
        Staker storage staker = stakers[user][stakeIndex];
        uint256 timeStaked = block.timestamp - staker.lastClaimTime;
        uint256 apy = tiers[staker.tier].apy;

        // Calculate annual reward then prorate for actual time staked
        uint256 annualReward = (staker.amount * apy) / 10000;
        return (annualReward * timeStaked) / 365 days;
    }

    // Helper function to get token instance
    function _getToken(uint256 tokenType) internal view returns (IERC20) {
        if (tokenType == 0) return usdt;
        if (tokenType == 1) return usdc;
        if (tokenType == 2) return dai;
        revert("Invalid token type");
    }

    // Helper function to remove a stake
    function _removeStake(address user, uint256 stakeIndex) internal {
        uint256 lastIndex = stakers[user].length - 1;
        if (stakeIndex != lastIndex) {
            stakers[user][stakeIndex] = stakers[user][lastIndex];
        }
        stakers[user].pop();
    }

    // Get all stakes for a user
    function getUserStakes(
        address user
    ) external view returns (Staker[] memory) {
        return stakers[user];
    }
}
