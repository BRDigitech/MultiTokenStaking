import { expect } from "chai";
import { parseUnits } from "ethers";
// import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
describe("MultiTokenStaking", function () {
  let staking;
  let usdt;
  let usdc;
  let dai;
  let owner;
  let user1;
  let user2;

  // Tier parameters
  const tierParams = [
    { minAmount: parseUnits("100", 18), apy: 500, lockPeriod: 86400 * 30 }, // 5% APY, 30 days
    { minAmount: parseUnits("1000", 18), apy: 800, lockPeriod: 86400 * 90 }, // 8% APY, 90 days
    { minAmount: parseUnits("5000", 18), apy: 1200, lockPeriod: 86400 * 180 } // 12% APY, 180 days
  ];

  before(async () => {
    [owner, user1, user2] = await ethers.getSigners();
    // console.log("owner",await owner.getAddress())
    // console.log("user1",user1)
    // console.log("user2",user2)
    // Deploy dummy tokens
    const USDT = await ethers.getContractFactory("DummyUSDT");
    const USDC = await ethers.getContractFactory("DummyUSDC");
    const DAI = await ethers.getContractFactory("DummyDAI");

    usdt = await USDT.deploy();
    usdc = await USDC.deploy();
    dai = await DAI.deploy();
    // console.log("usdt",await usdt.getAddress())

    // console.log("dai",dai)
    // Mint tokens to users
    await usdt.mint(owner.address, parseUnits("100000", 18));
    console.log("i ran 1")
    await usdc.mint(owner.address, parseUnits("100000", 18));
    console.log("i ran 2")
    await dai.mint(owner.address, parseUnits("100000", 18));
    console.log("i ran 3")
    await usdt.mint(user1.address, parseUnits("10000", 18));
    console.log("i ran 4")
    await usdc.mint(user1.address, parseUnits("10000", 18));
    console.log("i ran 5")
    await dai.mint(user1.address, parseUnits("10000", 18));
    console.log("i ran 6")

    // Deploy staking contract
    const Staking = await ethers.getContractFactory("MultiTokenStaking");
    staking = await upgrades.deployProxy(Staking, [
      await usdt.getAddress(),
      await usdc.getAddress(),
      await dai.getAddress(),
      tierParams.map(t => t.minAmount),
      tierParams.map(t => t.apy),
      tierParams.map(t => t.lockPeriod)
    ], { initializer: "initialize" })
    console.log("i ran 7")
    // let ownerAdder = await owner.getAddress()
    // let stakingAdder = await staking.getAddress()
    // Fund reward pool
    await usdt.connect(owner).approve(staking, parseUnits("5000", 18));
    console.log("i ran 8")
    await usdc.connect(owner).approve(staking, parseUnits("3000", 18));
    console.log("i ran 9")
    await dai.connect(owner).approve(staking, parseUnits("2000", 18));
    console.log("i ran 10")
    await staking.connect(owner).addRewardFunds(
      parseUnits("5000", 18),
      parseUnits("3000", 18),
      parseUnits("2000", 18)
    );
    console.log("i ran 11")
  });

  describe("Initialization", () => {
    it("Should set correct token addresses", async () => {
      expect(await staking.usdt()).to.equal(await usdt.getAddress());
      expect(await staking.usdc()).to.equal(await usdc.getAddress());
      expect(await staking.dai()).to.equal(await dai.getAddress());
    });

    it("Should initialize tiers correctly", async () => {
      for (let i = 0; i < 3; i++) {
        const tier = await staking.tiers(i);
        expect(tier.minStakeAmount).to.equal(tierParams[i].minAmount);
        expect(tier.apy).to.equal(tierParams[i].apy);
        expect(tier.lockPeriod).to.equal(tierParams[i].lockPeriod);
      }
    });

    it("Should have funded reward pool", async () => {
      const pool = await staking.rewardPool();
      expect(pool.usdtBalance).to.equal(parseUnits("5000", 18));
      expect(pool.usdcBalance).to.equal(parseUnits("3000", 18));
      expect(pool.daiBalance).to.equal(parseUnits("2000", 18));
    });
  });

  describe("Staking", () => {
    it("Should allow staking USDT in tier 0", async () => {
      const amount = tierParams[0].minAmount;
      await usdt.connect(user1).approve(staking, amount);

      await expect(staking.connect(user1).stake(amount, 0, 0))
        .to.emit(staking, "Staked")
        .withArgs(await user1.getAddress(), amount, 0, 0);

      const stakes = await staking.getUserStakes(await user1.getAddress());
      expect(stakes.length).to.equal(1);
      expect(stakes[0].amount).to.equal(amount);
      expect(stakes[0].tokenType).to.equal(0); // USDT
      expect(stakes[0].tier).to.equal(0);
    });

    it("Should reject staking below minimum amount", async () => {
      const amount = parseUnits("99", 18);
      await usdt.connect(user1).approve(await staking.getAddress(), amount);

      await expect(staking.connect(user1).stake(amount, 0, 0))
        .to.be.revertedWith("Amount below minimum for tier");
    });

    it("Should reject invalid token type", async () => {
      const amount = tierParams[0].minAmount;
      await usdt.connect(user1).approve(await staking.getAddress(), amount);

      await expect(staking.connect(user1).stake(amount, 3, 0))
        .to.be.reverted;
    });
  });

  describe("Reward Calculation", () => {
    it("Should calculate correct rewards", async () => {
      // Stake some USDC in tier 1
      const amount = tierParams[1].minAmount;
      await usdc.connect(user1).approve(await staking.getAddress(), amount);
      await staking.connect(user1).stake(amount, 1, 1);

      // Fast-forward 30 days
      await ethers.provider.send("evm_increaseTime", [86400 * 30]);
      await ethers.provider.send("evm_mine", []);

      const stakeIndex = 1; // Second stake
      const expectedReward = (amount * BigInt(tierParams[1].apy) * BigInt(30)) / (BigInt(10000) * BigInt(365));
      const calculatedReward = await staking.calculateReward(await user1.getAddress(), stakeIndex);
      const calculatedRewardBigInt = BigInt(calculatedReward.toString());

      // Calculate 1% tolerance
      const tolerance = expectedReward / BigInt(100);
      expect(
        calculatedRewardBigInt >= expectedReward - tolerance &&
        calculatedRewardBigInt <= expectedReward + tolerance
      ).to.be.true;
    });
  });

  describe("Claiming Rewards", () => {
    it("Should allow claiming rewards", async () => {
      const initialUSDT = await usdt.balanceOf(await user1.getAddress());
      const initialUSDC = await usdc.balanceOf(await user1.getAddress());
      const initialDAI = await dai.balanceOf(await user1.getAddress());

      const stakeIndex = 1;
      await staking.connect(user1).claimReward(stakeIndex);

      const finalUSDT = await usdt.balanceOf(await user1.getAddress());
      const finalUSDC = await usdc.balanceOf(await user1.getAddress());
      const finalDAI = await dai.balanceOf(await user1.getAddress());

      // Should have received some combination of rewards
      expect(finalUSDT + (finalUSDC) + (finalDAI)).to.be.gt(
        initialUSDT + (initialUSDC) + (initialDAI)
      );
    });
  });

  describe("Unstaking", () => {
    it("Should allow unstaking after lock period", async () => {
      const stakeIndex = 0;
      const stakesBefore = await staking.getUserStakes(await user1.getAddress());
      const stakedAmount = stakesBefore[stakeIndex].amount;
      // Fast-forward past lock period
      await ethers.provider.send("evm_increaseTime", [tierParams[0].lockPeriod + 1]);
      await ethers.provider.send("evm_mine", []);

      const finalBalance = await usdt.balanceOf(await user1.getAddress());
      await expect(staking.connect(user1).unstake(stakeIndex))
        .to.emit(staking, "Unstaked")
        // .withArgs(await user1.getAddress(), stakedAmount , 0);

      const stakesAfter = await staking.getUserStakes(await user1.getAddress());
      expect(stakesAfter.length).to.equal(1); // Only the USDC stake remains
    });

    it("Should reject unstaking before lock period", async () => {
      const stakeIndex = 0; // USDC stake with 90 day lock

      await expect(staking.connect(user1).unstake(stakeIndex))
        .to.be.revertedWith("Lock period not ended");
    });
  });

  describe("Pausable", () => {
    it("Should pause and unpause contract", async () => {
      await staking.connect(owner).pause();
      expect(await staking.paused()).to.be.true;

      const amount = tierParams[0].minAmount;
      await usdt.connect(user2).approve(await staking.getAddress(), amount);

      await staking.connect(owner).unpause();
      expect(await staking.paused()).to.be.false;
    });
  });

  describe("Upgradeability", () => {
    it("Should upgrade contract", async () => {
      const StakingV2 = await ethers.getContractFactory("MultiTokenStaking");
      const stakingV2 = await upgrades.upgradeProxy(await staking.getAddress(), StakingV2);

      // Verify state is preserved
      expect(await stakingV2.usdt()).to.equal(await usdt.getAddress());
    });

    it("Should reject upgrade from non-owner", async () => {
      const StakingV2 = await ethers.getContractFactory("MultiTokenStaking");

      await expect(
        upgrades.upgradeProxy(await staking.getAddress(), StakingV2.connect(user1))
      ).to.be.reverted;
    });
  });

}); 