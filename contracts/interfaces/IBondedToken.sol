// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IBondedToken {
    function lock(
        uint256 tokenId,
        address[] memory tokens,
        uint256[] memory amounts
    ) external;

    function merge(uint256 tokenIdA, uint256 tokenIdB) external;

    function getLockedOf(uint256 tokenId, address[] memory tokens)
        external
        view
        returns (uint256[] memory amounts);

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId
    ) external;

    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) external;

    function approve(address to, uint256 tokenId) external;
}
