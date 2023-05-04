// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "./IMuonNodeManagerV2.sol";

// TODO: should we allow editing
// nodeAddress, stakerAddress, peerId?

contract MuonNodeManagerUpgradeable is
    Initializable,
    AccessControlUpgradeable,
    IMuonNodeManager
{
    // ADMIN_ROLE could be granted to other smart contracts to let
    // them manage the nodes permissionlessly
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    // nodeId => Node
    mapping(uint256 => Node) public nodes;

    // nodeAddress => nodeId
    mapping(address => uint256) public nodeAddressIds;

    // stakerAddress => nodeId
    mapping(address => uint256) public stakerAddressIds;

    uint64 public lastNodeId;

    // muon nodes check lastUpdateTime to sync their memory
    uint256 public lastUpdateTime;

    // configs
    // commit_id => git commit id
    mapping(string => string) public configs;

    // sha256(role) => node id => bool
    mapping(bytes32 => mapping(uint256 => bool)) public nodesRoles;

    event AddNode(uint64 indexed nodeId, Node node);
    event DeactiveNode(uint64 indexed nodeId);
    event EditNodeAddress(
        uint64 indexed nodeId,
        address oldAddr,
        address newAddr
    );
    event EditPeerId(uint64 indexed nodeId, string oldId, string newId);
    event Config(string indexed key, string value);
    event NodeRoleSet(bytes32 indexed role, uint256 indexed nodeId);
    event NodeRoleUnset(bytes32 indexed role, uint256 indexed nodeId);

    modifier updateState() {
        lastUpdateTime = block.timestamp;
        _;
    }

    function __MuonNodeManagerUpgradeable_init() internal initializer {
        __AccessControl_init();

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(ADMIN_ROLE, msg.sender);
        _setupRole(DAO_ROLE, msg.sender);

        lastNodeId = 0;
        lastUpdateTime = block.timestamp;
    }

    function initialize() external initializer {
        __MuonNodeManagerUpgradeable_init();
    }

    function __MuonNodeManagerUpgradeable_init_unchained()
        internal
        initializer
    {}

    /**
     * @dev Adds a new node.
     *
     * Requirements:
     * - `_nodeAdrress` should be unique.
     * - `_stakerAddress` should be unique
     */
    function addNode(
        address _nodeAddress,
        address _stakerAddress,
        string calldata _peerId,
        bool _active
    ) public override onlyRole(ADMIN_ROLE) {
        _addNode(_nodeAddress, _stakerAddress, _peerId, _active);
    }

    /**
     * @dev Allows the admins to deactive the nodes
     */
    function deactiveNode(uint64 nodeId)
        public
        override
        onlyRole(ADMIN_ROLE)
        updateState
    {
        require(nodes[nodeId].id == nodeId, "Not found");

        require(nodes[nodeId].active, "Already deactived");

        nodes[nodeId].endTime = block.timestamp;
        nodes[nodeId].active = false;
        nodes[nodeId].lastEditTime = block.timestamp;

        emit DeactiveNode(nodeId);
    }

    /**
     * @dev Edits the nodeAddress
     */
    function editNodeAddress(uint64 nodeId, address nodeAddress)
        public
        onlyRole(ADMIN_ROLE)
        updateState
    {
        require(
            nodes[nodeId].id == nodeId && nodes[nodeId].active,
            "Not found"
        );
        require(nodeAddressIds[nodeAddress] == 0, "Duplicate nodeAddress");

        nodeAddressIds[nodeAddress] = nodeId;
        nodeAddressIds[nodes[nodeId].nodeAddress] = 0;

        nodes[nodeId].nodeAddress = nodeAddress;
        nodes[nodeId].lastEditTime = block.timestamp;

        emit EditNodeAddress(nodeId, nodes[nodeId].nodeAddress, nodeAddress);
    }

    /**
     * @dev Edits the nodeAddress
     */
    function editPeerId(uint64 nodeId, string memory peerId)
        public
        onlyRole(ADMIN_ROLE)
        updateState
    {
        require(
            nodes[nodeId].id == nodeId && nodes[nodeId].active,
            "Not found"
        );

        emit EditPeerId(nodeId, nodes[nodeId].peerId, peerId);

        nodes[nodeId].peerId = peerId;
    }

    /**
     * @dev It's a temporary function to insert old contract data
     */
    function addNodes(Node[] memory nodesList) public onlyRole(ADMIN_ROLE) {
        for (uint256 i = 0; i < nodesList.length; i++) {
            lastNodeId++;
            Node memory node = nodesList[i];
            nodes[lastNodeId] = node;
            nodeAddressIds[node.nodeAddress] = lastNodeId;
            stakerAddressIds[node.stakerAddress] = lastNodeId;
        }
    }

    function _addNode(
        address _nodeAddress,
        address _stakerAddress,
        string calldata _peerId,
        bool _active
    ) private updateState {
        require(nodeAddressIds[_nodeAddress] == 0, "Duplicate nodeAddress");
        require(
            stakerAddressIds[_stakerAddress] == 0,
            "Duplicate stakerAddress"
        );
        lastNodeId++;
        nodes[lastNodeId] = Node({
            id: lastNodeId,
            nodeAddress: _nodeAddress,
            stakerAddress: _stakerAddress,
            peerId: _peerId,
            active: _active,
            startTime: block.timestamp,
            lastEditTime: block.timestamp,
            endTime: 0
        });

        nodeAddressIds[_nodeAddress] = lastNodeId;
        stakerAddressIds[_stakerAddress] = lastNodeId;

        emit AddNode(lastNodeId, nodes[lastNodeId]);
    }

    /**
     * @dev Sets a config
     */
    function setConfig(string memory key, string memory val)
        public
        onlyRole(DAO_ROLE)
    {
        configs[key] = val;
    }

    /**
     * @dev Returns whether a given node has a given role.
     */
    function nodeHasRole(bytes32 role, uint256 nodeId)
        public
        view
        returns (bool)
    {
        return nodesRoles[role][nodeId];
    }

    /**
     * @dev Adds a role to a given node.
     */
    function setNodeRole(bytes32 role, uint256 nodeId)
        public
        onlyRole(DAO_ROLE)
        updateState
    {
        require(nodes[nodeId].active, "is not an active node");

        if (!nodesRoles[role][nodeId]) {
            nodesRoles[role][nodeId] = true;
            emit NodeRoleSet(role, nodeId);
        }
    }

    /**
     * @dev Removes a role from a given node.
     */
    function unsetNodeRole(bytes32 role, uint256 nodeId)
        public
        onlyRole(DAO_ROLE)
        updateState
    {
        if (nodesRoles[role][nodeId]) {
            nodesRoles[role][nodeId] = false;
            emit NodeRoleUnset(role, nodeId);
        }
    }

    /**
     * @dev Returns a list of the nodes.
     */
    function getAllNodes(uint256 _from, uint256 _to)
        public
        view
        returns (Node[] memory nodesList)
    {
        _from = _from > 0 ? _from : 1;
        _to = _to <= lastNodeId ? _to : lastNodeId;
        require(_from < _to, "invalid amounts");
        uint256 count = _to - _from + 1;

        nodesList = new Node[](count);
        for (uint256 i = 0; i < count; i++) {
            nodesList[i] = nodes[i + _from];
        }
    }

    /**
     * @dev Returns a list of edited nodes.
     */
    function getEditedNodes(
        uint64 _lastEditTime,
        uint256 _from,
        uint256 _to
    ) public view returns (Node[] memory nodesList) {
        nodesList = new Node[](100);
        uint64 n = 0;
        for (uint256 i = _from; i <= _to && n < 100; i++) {
            Node memory node = nodes[i];

            if (node.lastEditTime > _lastEditTime) {
                nodesList[n] = node;
                n++;
            }
        }

        // Resize the array to remove any unused elements
        assembly {
            mstore(nodesList, n)
        }
    }

    /**
     * @dev Returns `Node` for a valid
     * nodeAddress and an empty Node(node.id==0)
     * for an invalid nodeAddress.
     */
    function nodeAddressInfo(address _addr)
        public
        view
        returns (Node memory node)
    {
        node = nodes[nodeAddressIds[_addr]];
    }

    /**
     * @dev Returns `Node` for a valid
     * stakerAddress and an empty Node(node.id==0)
     * for an invalid stakerAddress.
     */
    function stakerAddressInfo(address _addr)
        public
        view
        override
        returns (Node memory node)
    {
        node = nodes[stakerAddressIds[_addr]];
    }
}
