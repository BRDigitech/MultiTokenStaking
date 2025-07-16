require("@nomicfoundation/hardhat-toolbox");
// require("@nomiclabs/hardhat-ethers");
require("@openzeppelin/hardhat-upgrades");
/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.28",
  networks: {
    hardhat: {
      chainId: 1337,
      allowUnlimitedContractSize: true,
      mining: {
        auto: true,
        interval: 0
      }
    }
  }
};