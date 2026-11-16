// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IceDiscoveryRegistry
 * @notice Public, immutable audit log of USER-SUBMITTED SIMULATION discoveries.
 * @dev This registry does not verify planetary observations, sensor data, or geographic accuracy.
 */
contract IceDiscoveryRegistry {
    struct Discovery {
        uint256 missionId;
        uint256 depositId;
        address scout;
        int32 latitudeE6;
        int32 longitudeE6;
        uint16 confidenceBps;
        bytes32 evidenceHash;
        uint64 recordedAt;
    }

    Discovery[] private _discoveries;
    mapping(bytes32 => bool) public recorded;

    event IceDepositMarked(
        uint256 indexed missionId,
        uint256 indexed depositId,
        address indexed scout,
        int32 latitudeE6,
        int32 longitudeE6,
        uint16 confidenceBps,
        bytes32 evidenceHash,
        uint256 recordedAt
    );

    function recordDeposit(
        uint256 missionId,
        uint256 depositId,
        int32 latitudeE6,
        int32 longitudeE6,
        uint16 confidenceBps,
        bytes32 evidenceHash
    ) external {
        require(latitudeE6 >= -90000000 && latitudeE6 <= 90000000, "Invalid latitude");
        require(longitudeE6 >= -180000000 && longitudeE6 <= 180000000, "Invalid longitude");
        require(confidenceBps <= 10000, "Invalid confidence");
        require(evidenceHash != bytes32(0), "Missing evidence hash");
        bytes32 key = keccak256(abi.encode(msg.sender, missionId, depositId));
        require(!recorded[key], "Deposit already recorded");
        recorded[key] = true;
        _discoveries.push(Discovery({
            missionId: missionId,
            depositId: depositId,
            scout: msg.sender,
            latitudeE6: latitudeE6,
            longitudeE6: longitudeE6,
            confidenceBps: confidenceBps,
            evidenceHash: evidenceHash,
            recordedAt: uint64(block.timestamp)
        }));
        emit IceDepositMarked(missionId, depositId, msg.sender, latitudeE6, longitudeE6, confidenceBps, evidenceHash, block.timestamp);
    }

    function totalDiscoveries() external view returns (uint256) { return _discoveries.length; }
    function getDiscovery(uint256 index) external view returns (Discovery memory) { return _discoveries[index]; }
}
