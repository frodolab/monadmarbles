// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MonadMarbles} from "../src/MonadMarbles.sol";

// A small, dependency-free Foundry cheatcode interface.
interface Vm {
    function prank(address sender) external;
    function deal(address who, uint256 newBalance) external;
    function warp(uint256 newTimestamp) external;
    function expectRevert(bytes4 errorSelector) external;
}

contract ReentrantEntrant {
    MonadMarbles public immutable game;
    uint256 public joinedRaceId;
    bool public attempted;
    bool public reenteredSuccessfully;

    constructor(MonadMarbles game_) {
        game = game_;
    }

    function enter(uint256 raceId) external payable {
        joinedRaceId = raceId;
        game.joinRace{value: msg.value}(raceId, 0);
    }

    function withdraw(uint256 raceId) external {
        game.claimPrize(raceId);
    }

    receive() external payable {
        attempted = true;
        try game.claimPrize(joinedRaceId) {
            reenteredSuccessfully = true;
        } catch {}
    }
}

contract MonadMarblesTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MonadMarbles internal game;
    uint256 internal raceId;

    uint256 internal constant FEE = 0.1 ether;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CAROL = address(0xCA701);
    address internal constant SETTLER = address(0x5E771E);

    function setUp() public {
        game = new MonadMarbles();
        vm.deal(address(this), 100 ether);
        vm.deal(ALICE, 10 ether);
        vm.deal(BOB, 10 ether);
        vm.deal(CAROL, 10 ether);
        raceId = game.createRace(FEE, 48);
    }

    function _join(address wallet, uint8 design) internal returns (uint256 entryId) {
        vm.prank(wallet);
        entryId = game.joinRace{value: FEE}(raceId, design);
    }

    function _twoEntrants() internal returns (uint256 aliceId, uint256 bobId) {
        aliceId = _join(ALICE, 0);
        bobId = _join(BOB, 13);
    }

    function testNewRaceIsOpenAndConfigurable() public view {
        MonadMarbles.Race memory race = game.getRace(raceId);
        require(race.status == MonadMarbles.RaceStatus.Open, "not open");
        require(race.entryFee == FEE, "wrong fee");
        require(race.maxEntries == 48, "wrong capacity");
        require(race.entryCount == 0 && race.prizePool == 0, "incorrect defaults");
        require(game.activeRaceId() == raceId, "wrong active race");
        require(game.nextRaceId() == raceId + 1, "wrong next race");
        require(game.DEFAULT_ENTRY_FEE() == FEE, "wrong suggested fee");
    }

    function testJoinRegistersEntryAndEscrowsExactFee() public {
        (uint256 aliceId, uint256 bobId) = _twoEntrants();
        require(aliceId == 1 && bobId == 2, "unexpected entries");
        MonadMarbles.Entry memory alice = game.getEntry(aliceId);
        require(alice.player == ALICE && alice.raceId == raceId && alice.design == 0, "alice entry");
        require(game.getEntry(bobId).design == 13, "design 13 must be valid");
        MonadMarbles.Race memory race = game.getRace(raceId);
        require(race.entryCount == 2 && race.prizePool == 2 * FEE, "wrong pool");
        require(address(game).balance == 2 * FEE, "funds not escrowed");
        require(game.entryIdOf(raceId, ALICE) == aliceId, "missing wallet mapping");
    }

    function testInvalidFeeAndDesignRevert() public {
        vm.expectRevert(MonadMarbles.IncorrectEntryFee.selector);
        vm.prank(ALICE);
        game.joinRace{value: 0.05 ether}(raceId, 0);

        vm.expectRevert(MonadMarbles.InvalidMarbleDesign.selector);
        vm.prank(ALICE);
        game.joinRace{value: FEE}(raceId, 14);

        vm.expectRevert(MonadMarbles.IncorrectEntryFee.selector);
        vm.prank(ALICE);
        game.joinRace{value: 0.2 ether}(raceId, 0);
    }

    function testOneMarblePerWallet() public {
        _join(ALICE, 0);
        vm.expectRevert(MonadMarbles.AlreadyEntered.selector);
        vm.prank(ALICE);
        game.joinRace{value: FEE}(raceId, 1);
    }

    function testFullRaceRejectsAdditionalEntries() public {
        game.cancelRace(raceId);
        raceId = game.createRace(FEE, 2);
        _twoEntrants();
        vm.expectRevert(MonadMarbles.RaceFull.selector);
        vm.prank(CAROL);
        game.joinRace{value: FEE}(raceId, 1);
    }

    function testOnlyOneActiveRaceAndCapacityValidated() public {
        vm.expectRevert(MonadMarbles.ActiveRaceExists.selector);
        game.createRace(FEE, 48);

        game.cancelRace(raceId);

        vm.expectRevert(MonadMarbles.InvalidCapacity.selector);
        game.createRace(FEE, 49);

        vm.expectRevert(MonadMarbles.InvalidCapacity.selector);
        game.createRace(FEE, 1);

        vm.expectRevert(MonadMarbles.InvalidEntryFee.selector);
        game.createRace(0, 48);

        uint256 nextId = game.createRace(FEE, 48);
        require(nextId == 2, "race IDs should be monotonic");
    }

    function testOnlyOwnerCreatesRace() public {
        vm.expectRevert(MonadMarbles.Unauthorized.selector);
        vm.prank(ALICE);
        game.createRace(FEE, 48);
    }

    function testCannotCloseUntilTwoAndCannotJoinAfterClose() public {
        _join(ALICE, 1);
        vm.expectRevert(MonadMarbles.NotEnoughEntrants.selector);
        game.closeEntries(raceId);
        _join(BOB, 2);
        game.closeEntries(raceId);

        require(game.getRace(raceId).status == MonadMarbles.RaceStatus.Closed, "not closed");
        vm.expectRevert(MonadMarbles.WrongRaceState.selector);
        vm.prank(CAROL);
        game.joinRace{value: FEE}(raceId, 3);
    }

    function testOnlyOperatorCanCloseAndFinalize() public {
        (uint256 aliceId,) = _twoEntrants();

        vm.expectRevert(MonadMarbles.Unauthorized.selector);
        vm.prank(CAROL);
        game.closeEntries(raceId);

        game.setSettler(SETTLER);
        vm.prank(SETTLER);
        game.closeEntries(raceId);

        vm.expectRevert(MonadMarbles.Unauthorized.selector);
        vm.prank(CAROL);
        game.finalizeRace(raceId, aliceId);

        vm.prank(SETTLER);
        game.finalizeRace(raceId, aliceId);
        require(game.getRace(raceId).winningEntryId == aliceId, "wrong settled entry");
    }

    function testCannotFinalizeBeforeCloseOrWithWrongEntry() public {
        (uint256 aliceId,) = _twoEntrants();
        vm.expectRevert(MonadMarbles.WrongRaceState.selector);
        game.finalizeRace(raceId, aliceId);
        game.closeEntries(raceId);
        vm.expectRevert(MonadMarbles.InvalidWinnerEntry.selector);
        game.finalizeRace(raceId, 999);
        game.finalizeRace(raceId, aliceId);
        vm.expectRevert(MonadMarbles.WrongRaceState.selector);
        game.finalizeRace(raceId, aliceId);
    }

    function testCannotUseWinnerFromPreviousRace() public {
        (uint256 oldEntryId,) = _twoEntrants();
        game.closeEntries(raceId);
        game.finalizeRace(raceId, oldEntryId);
        raceId = game.createRace(FEE, 48);
        _twoEntrants();
        game.closeEntries(raceId);
        vm.expectRevert(MonadMarbles.InvalidWinnerEntry.selector);
        game.finalizeRace(raceId, oldEntryId);
    }

    function testWinnerClaimsWholePoolExactlyOnce() public {
        (uint256 aliceId,) = _twoEntrants();
        game.closeEntries(raceId);
        game.finalizeRace(raceId, aliceId);

        vm.expectRevert(MonadMarbles.NotWinner.selector);
        vm.prank(BOB);
        game.claimPrize(raceId);

        uint256 beforeBalance = ALICE.balance;
        vm.prank(ALICE);
        game.claimPrize(raceId);
        require(ALICE.balance == beforeBalance + 2 * FEE, "wrong winner payout");
        require(game.getRace(raceId).prizePool == 0, "pool not cleared");
        require(game.getRace(raceId).prizeClaimed, "claim not marked");

        vm.expectRevert(MonadMarbles.PrizeAlreadyClaimed.selector);
        vm.prank(ALICE);
        game.claimPrize(raceId);
    }

    function testOwnerCanCancelAndAllEntrantsCanRefund() public {
        _twoEntrants();
        game.cancelRace(raceId);
        require(game.activeRaceId() == 0, "active race not cleared");
        require(game.getRace(raceId).status == MonadMarbles.RaceStatus.Canceled, "not canceled");

        uint256 beforeAlice = ALICE.balance;
        uint256 beforeBob = BOB.balance;
        vm.prank(ALICE);
        game.claimRefund(raceId);
        vm.prank(BOB);
        game.claimRefund(raceId);

        require(ALICE.balance == beforeAlice + FEE, "wrong Alice refund");
        require(BOB.balance == beforeBob + FEE, "wrong Bob refund");
        require(game.getRace(raceId).prizePool == 0, "pool not empty");

        vm.expectRevert(MonadMarbles.RefundAlreadyClaimed.selector);
        vm.prank(ALICE);
        game.claimRefund(raceId);
    }

    function testUnregisteredWalletCannotTakeRefund() public {
        _join(ALICE, 0);
        game.cancelRace(raceId);
        vm.expectRevert(MonadMarbles.NotRegistered.selector);
        vm.prank(CAROL);
        game.claimRefund(raceId);
    }

    function testAnyoneCanCancelAfterTimeoutButItNeverAutoStarts() public {
        _join(ALICE, 0);
        vm.expectRevert(MonadMarbles.CancellationUnavailable.selector);
        vm.prank(CAROL);
        game.cancelRace(raceId);

        vm.warp(block.timestamp + game.CANCELLATION_TIMEOUT() + 1);
        require(game.getRace(raceId).status == MonadMarbles.RaceStatus.Open, "cannot auto-start");
        vm.prank(CAROL);
        game.cancelRace(raceId);
        require(game.getRace(raceId).status == MonadMarbles.RaceStatus.Canceled, "cancel failed");
    }

    function testCannotCancelAfterFinalize() public {
        (uint256 aliceId,) = _twoEntrants();
        game.closeEntries(raceId);
        game.finalizeRace(raceId, aliceId);
        vm.expectRevert(MonadMarbles.WrongRaceState.selector);
        game.cancelRace(raceId);
    }

    function testPrizeClaimRejectsReentrancy() public {
        ReentrantEntrant attacker = new ReentrantEntrant(game);
        attacker.enter{value: FEE}(raceId);
        _join(BOB, 1);
        game.closeEntries(raceId);
        game.finalizeRace(raceId, game.entryIdOf(raceId, address(attacker)));

        attacker.withdraw(raceId);
        require(attacker.attempted(), "reentry was not attempted");
        require(!attacker.reenteredSuccessfully(), "reentry succeeded");
        require(address(attacker).balance == 2 * FEE, "payout duplicated or lost");
        require(game.getRace(raceId).prizePool == 0, "pool not cleared");
    }

    function testOwnershipTransferIsTwoStep() public {
        game.transferOwnership(ALICE);
        vm.expectRevert(MonadMarbles.Unauthorized.selector);
        vm.prank(BOB);
        game.acceptOwnership();
        vm.prank(ALICE);
        game.acceptOwnership();
        require(game.owner() == ALICE, "owner was not updated");
        require(game.settler() == ALICE, "old owner still has settlement access");

        vm.expectRevert(MonadMarbles.Unauthorized.selector);
        game.createRace(FEE, 48);
    }

    function testFuzzRejectsIncorrectFees(uint96 amount) public {
        if (amount == FEE) return;
        vm.deal(ALICE, uint256(amount) + FEE + 1);
        vm.expectRevert(MonadMarbles.IncorrectEntryFee.selector);
        vm.prank(ALICE);
        game.joinRace{value: amount}(raceId, 0);
    }
}
