// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MonadMarblesAuto} from "../src/MonadMarblesAuto.sol";

interface VmAuto {
    function prank(address sender) external;
    function deal(address who, uint256 balance) external;
    function chainId(uint256 chain) external;
    function expectRevert(bytes4 errorSelector) external;
}

contract RejectingWallet {
    MonadMarblesAuto public immutable game;
    constructor(MonadMarblesAuto game_) { game = game_; }
    function enter(uint256 raceId) external payable {
        game.joinRace{value: msg.value}(raceId, 0);
    }
    receive() external payable { revert("I refuse payment"); }
}

contract ReenteringWallet {
    MonadMarblesAuto public immutable game;
    uint256 public raceId;
    bool public attempted;
    bool public succeeded;
    constructor(MonadMarblesAuto game_) { game = game_; }
    function enter(uint256 id) external payable {
        raceId = id;
        game.joinRace{value: msg.value}(id, 0);
    }
    receive() external payable {
        attempted = true;
        try game.claimRefund(raceId) { succeeded = true; } catch {}
    }
}

contract MonadMarblesAutoTest {
    VmAuto private constant vm = VmAuto(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant SETTLER = address(0x5E771E);
    uint256 private constant FEE = 0.1 ether;

    MonadMarblesAuto private game;
    uint256 private raceId;

    function setUp() public {
        game = new MonadMarblesAuto();
        vm.deal(address(this), 10 ether);
        vm.deal(ALICE, 3 ether);
        vm.deal(BOB, 3 ether);
        vm.deal(SETTLER, 1 ether);
        raceId = game.createRace(FEE, 48);
    }

    function joinBoth() private returns (uint256 aliceId, uint256 bobId) {
        vm.prank(ALICE);
        aliceId = game.joinRace{value: FEE}(raceId, 0);
        vm.prank(BOB);
        bobId = game.joinRace{value: FEE}(raceId, 9);
    }

    function testChainAndVersion() public {
        require(game.AUTO_PAYOUT(), "must advertise auto settlement");
        vm.chainId(143);
        vm.expectRevert(MonadMarblesAuto.WrongChain.selector);
        new MonadMarblesAuto();
        vm.chainId(31337);
    }

    function testAutoPayoutEntirePoolInFinalizationTransaction() public {
        (uint256 aliceId,) = joinBoth();
        uint256 before = ALICE.balance;
        game.closeEntries(raceId);
        game.setSettler(SETTLER);

        vm.prank(SETTLER);
        game.finalizeRace(raceId, aliceId);

        MonadMarblesAuto.Race memory settled = game.getRace(raceId);
        require(settled.status == MonadMarblesAuto.RaceStatus.Finalized, "status incorrect");
        require(settled.prizeClaimed, "must be marked paid in same tx");
        require(settled.winningEntryId == aliceId, "entry id incorrect");
        require(settled.prizePool == 0, "escrow not cleared");
        require(game.activeRaceId() == 0, "active race not reset");
        require(ALICE.balance == before + 2 * FEE, "winner did not receive the whole pool");
        require(address(game).balance == 0, "contract retained the prize");
    }

    function testUntrustedWalletCannotTriggerPayout() public {
        (uint256 aliceId,) = joinBoth();
        game.closeEntries(raceId);
        vm.expectRevert(MonadMarblesAuto.Unauthorized.selector);
        vm.prank(BOB);
        game.finalizeRace(raceId, aliceId);
        require(address(game).balance == 2 * FEE, "unauthorized payment");
    }

    function testCannotPayoutTwiceOrPayoutWrongRace() public {
        (uint256 aliceId,) = joinBoth();
        game.closeEntries(raceId);
        vm.expectRevert(MonadMarblesAuto.InvalidWinnerEntry.selector);
        game.finalizeRace(raceId, 123456);
        game.finalizeRace(raceId, aliceId);
        vm.expectRevert(MonadMarblesAuto.WrongRaceState.selector);
        game.finalizeRace(raceId, aliceId);
        require(address(game).balance == 0, "double payout");
    }

    function testRejectingRecipientRevertsEverythingAndAllowsCancelRefund() public {
        RejectingWallet rejecting = new RejectingWallet(game);
        rejecting.enter{value: FEE}(raceId);
        vm.prank(BOB);
        game.joinRace{value: FEE}(raceId, 1);
        game.closeEntries(raceId);
        vm.expectRevert(MonadMarblesAuto.PayoutFailed.selector);
        game.finalizeRace(raceId, game.entryIdOf(raceId, address(rejecting)));
        require(game.getRace(raceId).status == MonadMarblesAuto.RaceStatus.Closed, "settlement must roll back");
        require(game.getRace(raceId).prizePool == 2 * FEE, "money must stay escrowed");
        require(game.activeRaceId() == raceId, "race must remain active");
        game.cancelRace(raceId);
        uint256 before = BOB.balance;
        vm.prank(BOB);
        game.claimRefund(raceId);
        require(BOB.balance == before + FEE, "Bob refund unavailable");
    }

    function testMaliciousReceiverCannotStealRefundWhenPaid() public {
        ReenteringWallet winningContract = new ReenteringWallet(game);
        winningContract.enter{value: FEE}(raceId);
        vm.prank(BOB);
        game.joinRace{value: FEE}(raceId, 1);
        game.closeEntries(raceId);
        game.finalizeRace(raceId, game.entryIdOf(raceId, address(winningContract)));
        require(winningContract.attempted(), "receiver did not call back");
        require(!winningContract.succeeded(), "callback incorrectly received a refund");
        require(address(winningContract).balance == 2 * FEE, "winner received wrong amount");
        require(game.getRace(raceId).prizePool == 0, "money left in escrow");
    }

    function testNoAutomaticStartAndRefundsStillSupported() public {
        joinBoth();
        require(game.getRace(raceId).status == MonadMarblesAuto.RaceStatus.Open, "race should not auto-start");
        game.closeEntries(raceId);
        game.cancelRace(raceId);
        vm.prank(ALICE);
        game.claimRefund(raceId);
        vm.prank(BOB);
        game.claimRefund(raceId);
        require(address(game).balance == 0, "refunds must clear escrow");
    }
}
