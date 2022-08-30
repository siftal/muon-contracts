// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.7.0 <0.9.0;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract MuonNodeManager is AccessControl {
  bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

  struct Node {
    uint256 id; // incremental ID
    address nodeAddress; // will be used on the node
    address stakerAddress;
    string peerId; // p2p peer ID
    bool active;
    uint256 time;
  }

  // nodeId => Node
  mapping(uint256 => Node) public nodes;

  // nodeAddress => nodeId
  mapping(address => uint256) public nodeAddressIds;

  // stakerAddress => nodeId
  mapping(address => uint256) public stakerAddressIds;  

  uint256 public lastNodeId = 0;

  event AddNode(Node node);

    constructor(){
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(ADMIN_ROLE, msg.sender);
    }

    function addNode(
      address _nodeAddress,
      address _stakerAddress,
      string calldata _peerId,
      bool _active
    ) public onlyRole(ADMIN_ROLE) {
      require(
        nodeAddressIds[_nodeAddress] == 0,
        "nodeAddress already exists"
      );
      lastNodeId ++;

        nodes[lastNodeId] = Node({
          id: lastNodeId,
          nodeAddress: _nodeAddress,
          stakerAddress: _stakerAddress,
          peerId: _peerId,
          active: _active,
          time: block.timestamp
        });
        nodeAddressIds[_nodeAddress] = lastNodeId;
        stakerAddressIds[_stakerAddress] = lastNodeId;
        
        emit AddNode(nodes[lastNodeId]);
    }

    function getAllNodes() public view returns(
        Node[] memory allNodes
    ){
      allNodes = new Node[](lastNodeId);

        for(uint256 i = 1; i < lastNodeId; i++){
          allNodes[i-1] = nodes[i];
        }
    }

    function nodeAddressInfo(address _addr) public view returns(
      Node memory node
    ){
      node = nodes[nodeAddressIds[_addr]];
    }

    function stakerAddressInfo(address _addr) public view returns(
      Node memory node
    ){
      node = nodes[stakerAddressIds[_addr]];
    }
}
