require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
require('dotenv').config();

const rpc = process.env.MONAD_TESTNET_RPC || 'https://testnet-rpc.monad.xyz';
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

module.exports = {
  solidity: { version: '0.8.24', settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    hardhat: {},
    monadTestnet: {
      url: rpc,
      chainId: 10143,
      accounts: privateKey ? [privateKey] : []
    }
  }
};
