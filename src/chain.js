import { ethers } from 'ethers';

export const MONAD_TESTNET = {
  chainId: '0x279f', // 10143
  chainName: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: ['https://testnet-rpc.monad.xyz'],
  blockExplorerUrls: ['https://testnet.monadexplorer.com']
};
export const EXPLORER = 'https://testnet.monadexplorer.com';
export const ABI = [
  'function recordDeposit(uint256 missionId,uint256 depositId,int32 latitudeE6,int32 longitudeE6,uint16 confidenceBps,bytes32 evidenceHash) external',
  'function totalDiscoveries() view returns (uint256)',
  'event IceDepositMarked(uint256 indexed missionId,uint256 indexed depositId,address indexed scout,int32 latitudeE6,int32 longitudeE6,uint16 confidenceBps,bytes32 evidenceHash,uint256 recordedAt)'
];

function wallet() {
  if (!window.ethereum) throw new Error('MetaMask is not installed. Install it to make testnet transactions.');
  return window.ethereum;
}

export async function connectWallet() {
  const eth = wallet();
  const accounts = await eth.request({ method: 'eth_requestAccounts' });
  if (!accounts?.length) throw new Error('No account selected in MetaMask.');
  await ensureMonadNetwork();
  return accounts[0];
}

export async function ensureMonadNetwork() {
  const eth = wallet();
  const current = await eth.request({ method: 'eth_chainId' });
  if (current.toLowerCase() === MONAD_TESTNET.chainId) return;
  try {
    await eth.request({method:'wallet_switchEthereumChain',params:[{chainId:MONAD_TESTNET.chainId}]});
  } catch (error) {
    if (error.code !== 4902) throw error;
    await eth.request({method:'wallet_addEthereumChain',params:[MONAD_TESTNET]});
    await eth.request({method:'wallet_switchEthereumChain',params:[{chainId:MONAD_TESTNET.chainId}]});
  }
}

export async function sendDiscovery({address, missionId, deposit, latitude, longitude}) {
  if (!ethers.isAddress(address)) throw new Error('A valid deployed registry address is required.');
  await ensureMonadNetwork();
  const provider = new ethers.BrowserProvider(wallet());
  const signer = await provider.getSigner();
  const bytecode = await provider.getCode(address);
  if (bytecode === '0x') throw new Error('No deployed contract found at this address on Monad Testnet.');
  const registry = new ethers.Contract(address,ABI,signer);
  const latE6 = Math.round(latitude*1e6);
  const lonE6 = Math.round(longitude*1e6);
  // Committing a canonical JSON representation gives the event a tamper-evident evidence reference.
  // It does not attest to actual lunar data or verify real sensor observations.
  const evidence = JSON.stringify({source:'SELENE-SYNTHETIC-V1',missionId:String(missionId),depositId:deposit.id,latE6,lonE6,confidence:deposit.confidence});
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(evidence));
  const tx = await registry.recordDeposit(BigInt(missionId),BigInt(deposit.id),latE6,lonE6,deposit.confidence,evidenceHash);
  return { hash:tx.hash,wait:()=>tx.wait(1),evidenceHash };
}
