const hre = require('hardhat');

async function main() {
  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error('Set DEPLOYER_PRIVATE_KEY in .env to deploy; never commit this value.');
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 10143n) throw new Error('Deployment requires Monad Testnet (chain ID 10143).');
  const Registry = await hre.ethers.getContractFactory('IceDiscoveryRegistry');
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  console.log('IceDiscoveryRegistry deployed to:', await registry.getAddress());
  console.log('Add the address to VITE_CONTRACT_ADDRESS in your local .env, then restart Vite.');
}
main().catch(error => {console.error(error); process.exitCode=1;});
