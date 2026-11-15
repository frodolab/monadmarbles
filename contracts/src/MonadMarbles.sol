// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title MonadMarbles
 * @notice Testnet-only race entry registry and prize escrow for Monad Marbles.
 * @dev The race simulation happens off-chain. The owner/settler is trusted to
 *      report the winning entry; this contract does NOT verify race physics.
 *      There is no automatic race start or rolling race timer.
 *      This prototype is not audited. Do not use for real-money wagering.
 */
contract MonadMarbles {
    uint16 public constant MAX_MARBLES = 48;
    uint8 public constant DESIGN_COUNT = 14; // 0 through 13
    uint256 public constant DEFAULT_ENTRY_FEE = 0.1 ether; // 0.1 testnet MON
    uint256 public constant CANCELLATION_TIMEOUT = 24 hours;

    enum RaceStatus {
        NotCreated,
        Open,
        Closed,
        Finalized,
        Canceled
    }

    struct Race {
        RaceStatus status;
        uint256 entryFee;
        uint256 prizePool;
        uint256 winningEntryId;
        uint64 createdAt;
        uint64 closedAt;
        uint16 maxEntries;
        uint16 entryCount;
        bool prizeClaimed;
    }

    struct Entry {
        uint256 raceId;
        address player;
        uint8 design;
    }

    address public owner;
    address public pendingOwner;
    address public settler;

    uint256 public nextRaceId = 1;
    uint256 public nextEntryId = 1;
    uint256 public activeRaceId;

    mapping(uint256 => Race) public races;
    mapping(uint256 => Entry) public entries;
    mapping(uint256 => mapping(address => uint256)) public entryIdOf;
    mapping(uint256 => mapping(address => bool)) public refundClaimed;

    bool private entered;

    error Unauthorized();
    error ZeroAddress();
    error InvalidEntryFee();
    error InvalidCapacity();
    error ActiveRaceExists();
    error WrongRaceState();
    error IncorrectEntryFee();
    error InvalidMarbleDesign();
    error AlreadyEntered();
    error RaceFull();
    error NotEnoughEntrants();
    error InvalidWinnerEntry();
    error NotWinner();
    error PrizeAlreadyClaimed();
    error NotRegistered();
    error RefundAlreadyClaimed();
    error CancellationUnavailable();
    error PayoutFailed();
    error ReentrantCall();
    error DirectPaymentDisabled();
    error WrongChain();

    event OwnershipTransferStarted(address indexed currentOwner, address indexed proposedOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SettlerChanged(address indexed previousSettler, address indexed newSettler);
    event RaceCreated(uint256 indexed raceId, uint256 entryFee, uint16 maxEntries);
    event PlayerJoined(
        uint256 indexed raceId,
        uint256 indexed entryId,
        address indexed player,
        uint8 design,
        uint256 amount
    );
    event EntriesClosed(uint256 indexed raceId, uint16 entryCount);
    event RaceFinalized(
        uint256 indexed raceId,
        uint256 indexed winningEntryId,
        address indexed winner,
        uint256 prizePool
    );
    event RaceCanceled(uint256 indexed raceId);
    event PrizeClaimed(uint256 indexed raceId, uint256 indexed entryId, address indexed winner, uint256 amount);
    event RefundClaimed(uint256 indexed raceId, uint256 indexed entryId, address indexed player, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != owner && msg.sender != settler) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    constructor() {
        // Refuse accidental mainnet deployments. 31337 is the local Anvil / Foundry chain.
        if (block.chainid != 10143 && block.chainid != 31337) revert WrongChain();
        owner = msg.sender;
        settler = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        emit SettlerChanged(address(0), msg.sender);
    }

    receive() external payable {
        revert DirectPaymentDisabled();
    }

    fallback() external payable {
        revert DirectPaymentDisabled();
    }

    /**
     * @notice An owner manually creates the next race.
     * @dev On-chain race IDs are consecutive uint256 values. UUIDs and server
     *      session IDs remain separate and should NEVER be used as race IDs here.
     */
    function createRace(uint256 entryFee, uint16 maxEntries)
        external
        onlyOwner
        returns (uint256 raceId)
    {
        if (activeRaceId != 0) revert ActiveRaceExists();
        if (entryFee == 0) revert InvalidEntryFee();
        if (maxEntries < 2 || maxEntries > MAX_MARBLES) revert InvalidCapacity();

        raceId = nextRaceId++;
        races[raceId] = Race({
            status: RaceStatus.Open,
            entryFee: entryFee,
            prizePool: 0,
            winningEntryId: 0,
            createdAt: uint64(block.timestamp),
            closedAt: 0,
            maxEntries: maxEntries,
            entryCount: 0,
            prizeClaimed: false
        });
        activeRaceId = raceId;
        emit RaceCreated(raceId, entryFee, maxEntries);
    }

    /**
     * @notice A wallet enters an open race by paying the exact testnet fee.
     * @dev One marble per wallet per race in Beta 4. Nicknames are off-chain.
     */
    function joinRace(uint256 raceId, uint8 design)
        external
        payable
        nonReentrant
        returns (uint256 entryId)
    {
        Race storage race = races[raceId];
        if (race.status != RaceStatus.Open || activeRaceId != raceId) revert WrongRaceState();
        if (design >= DESIGN_COUNT) revert InvalidMarbleDesign();
        if (race.entryCount >= race.maxEntries) revert RaceFull();
        if (entryIdOf[raceId][msg.sender] != 0) revert AlreadyEntered();
        if (msg.value != race.entryFee) revert IncorrectEntryFee();

        entryId = nextEntryId++;
        entries[entryId] = Entry({raceId: raceId, player: msg.sender, design: design});
        entryIdOf[raceId][msg.sender] = entryId;
        race.entryCount += 1;
        race.prizePool += msg.value;

        emit PlayerJoined(raceId, entryId, msg.sender, design, msg.value);
    }

    /**
     * @notice Called explicitly by the operator BEFORE the server starts its
     *         synchronized ten-second countdown.
     * @dev No on-chain countdown and no automatic race start.
     */
    function closeEntries(uint256 raceId) external onlyOperator {
        Race storage race = races[raceId];
        if (race.status != RaceStatus.Open || activeRaceId != raceId) revert WrongRaceState();
        if (race.entryCount < 2) revert NotEnoughEntrants();
        race.status = RaceStatus.Closed;
        race.closedAt = uint64(block.timestamp);
        emit EntriesClosed(raceId, race.entryCount);
    }

    /**
     * @notice Report the winner of the server-authoritative physics simulation.
     * @dev Requires a TRUSTED owner/settler account. This is not a proof of
     *      physics correctness or a trustless randomness mechanism.
     */
    function finalizeRace(uint256 raceId, uint256 winningEntryId) external onlyOperator {
        Race storage race = races[raceId];
        if (race.status != RaceStatus.Closed || activeRaceId != raceId) revert WrongRaceState();

        Entry storage winnerEntry = entries[winningEntryId];
        if (winningEntryId == 0 || winnerEntry.raceId != raceId) revert InvalidWinnerEntry();

        race.status = RaceStatus.Finalized;
        race.winningEntryId = winningEntryId;
        activeRaceId = 0;

        emit RaceFinalized(raceId, winningEntryId, winnerEntry.player, race.prizePool);
    }

    /**
     * @notice Withdraw the pool after a trusted operator finalizes the race.
     * @dev Pull-payment design and checks-effects-interactions; only one claim.
     */
    function claimPrize(uint256 raceId) external nonReentrant {
        Race storage race = races[raceId];
        if (race.status != RaceStatus.Finalized) revert WrongRaceState();
        if (race.prizeClaimed) revert PrizeAlreadyClaimed();

        uint256 winningEntryId = race.winningEntryId;
        if (msg.sender != entries[winningEntryId].player) revert NotWinner();

        uint256 amount = race.prizePool;
        race.prizeClaimed = true;
        race.prizePool = 0;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert PayoutFailed();
        emit PrizeClaimed(raceId, winningEntryId, msg.sender, amount);
    }

    /**
     * @notice Cancel a race and allow each entrant to individually claim a refund.
     * @dev Owner can cancel immediately. Anyone can cancel a stuck race after
     *      24 hours from creation. This timeout DOES NOT start races.
     */
    function cancelRace(uint256 raceId) external {
        Race storage race = races[raceId];
        if (race.status != RaceStatus.Open && race.status != RaceStatus.Closed) {
            revert WrongRaceState();
        }
        if (msg.sender != owner && block.timestamp < uint256(race.createdAt) + CANCELLATION_TIMEOUT) {
            revert CancellationUnavailable();
        }

        race.status = RaceStatus.Canceled;
        if (activeRaceId == raceId) activeRaceId = 0;
        emit RaceCanceled(raceId);
    }

    function claimRefund(uint256 raceId) external nonReentrant {
        Race storage race = races[raceId];
        if (race.status != RaceStatus.Canceled) revert WrongRaceState();

        uint256 entryId = entryIdOf[raceId][msg.sender];
        if (entryId == 0) revert NotRegistered();
        if (refundClaimed[raceId][msg.sender]) revert RefundAlreadyClaimed();

        uint256 amount = race.entryFee;
        refundClaimed[raceId][msg.sender] = true;
        race.prizePool -= amount;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert PayoutFailed();
        emit RefundClaimed(raceId, entryId, msg.sender, amount);
    }

    function setSettler(address newSettler) external onlyOwner {
        if (newSettler == address(0)) revert ZeroAddress();
        emit SettlerChanged(settler, newSettler);
        settler = newSettler;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        // When the former owner was also the settler, revoke settlement
        // authority during ownership transfer rather than leaving stale access.
        if (settler == previousOwner) {
            settler = owner;
            emit SettlerChanged(previousOwner, owner);
        }
        emit OwnershipTransferred(previousOwner, owner);
    }

    function getRace(uint256 raceId) external view returns (Race memory) {
        return races[raceId];
    }

    function getEntry(uint256 entryId) external view returns (Entry memory) {
        return entries[entryId];
    }
}
