const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('IceDiscoveryRegistry', function () {
  let registry, signer;
  const proof = ethers.keccak256(ethers.toUtf8Bytes('synthetic-readings-v1'));
  beforeEach(async function () {
    [signer] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory('IceDiscoveryRegistry')).deploy();
  });
  it('records a discovery and emits the immutable audit event', async function () {
    await expect(registry.recordDeposit(12, 1, -85000000, 23400000, 9340, proof))
      .to.emit(registry, 'IceDepositMarked')
      .withArgs(12, 1, signer.address, -85000000, 23400000, 9340, proof, (x) => x > 0);
    expect(await registry.totalDiscoveries()).to.equal(1n);
    const entry = await registry.getDiscovery(0);
    expect(entry.scout).to.equal(signer.address);
    expect(entry.confidenceBps).to.equal(9340n);
  });
  it('rejects duplicate mission/deposit pairs from the same wallet', async function () {
    await registry.recordDeposit(12, 1, -85000000, 23400000, 9340, proof);
    await expect(registry.recordDeposit(12, 1, -85000000, 23400000, 9340, proof)).to.be.revertedWith('Deposit already recorded');
  });
  it('validates coordinates, confidence and evidence', async function () {
    await expect(registry.recordDeposit(12, 1, -95000000, 0, 9000, proof)).to.be.revertedWith('Invalid latitude');
    await expect(registry.recordDeposit(12, 1, -85000000, 190000000, 9000, proof)).to.be.revertedWith('Invalid longitude');
    await expect(registry.recordDeposit(12, 1, -85000000, 0, 10001, proof)).to.be.revertedWith('Invalid confidence');
    await expect(registry.recordDeposit(12, 1, -85000000, 0, 9000, ethers.ZeroHash)).to.be.revertedWith('Missing evidence hash');
  });
});
