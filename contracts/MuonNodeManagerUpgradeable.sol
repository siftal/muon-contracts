// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.7.0 <0.9.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "./IMuonNodeManager.sol";

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

    event AddNode(uint64 indexed nodeId, Node node);
    event RemoveNode(uint64 indexed nodeId);
    event DeactiveNode(uint64 indexed nodeId);
    event EditNodeAddress(
        uint64 indexed nodeId,
        address oldAddr,
        address newAddr
    );
    event EditPeerId(uint64 indexed nodeId, string oldId, string newId);
    event Config(string indexed key, string value);

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
     * @dev Removes a node
     */
    function removeNode(uint64 nodeId) public onlyRole(ADMIN_ROLE) updateState {
        require(
            nodes[nodeId].id == nodeId && nodes[nodeId].active,
            "Not found"
        );
        nodes[nodeId].endTime = block.timestamp;
        nodes[nodeId].active = false;
        nodes[nodeId].lastEditTime = block.timestamp;
        emit RemoveNode(nodeId);
    }

    /**
     * @dev Allows the node's owner to deactive its node
     */
    function deactiveNode(uint64 nodeId)
        public
        override
        onlyRole(ADMIN_ROLE)
        updateState
    {
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

        emit EditNodeAddress(nodeId, nodes[nodeId].nodeAddress, nodeAddress);

        nodes[nodeId].nodeAddress = nodeAddress;

        nodes[nodeId].lastEditTime = block.timestamp;
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
            endTime: 0,
            isDeployer: false
        });

        nodeAddressIds[_nodeAddress] = lastNodeId;
        stakerAddressIds[_stakerAddress] = lastNodeId;

        emit AddNode(lastNodeId, nodes[lastNodeId]);
    }

    /**
     * @dev Allows the DAO to set isDeployer
     * for the nodes
     */
    function setIsDeployer(uint64 nodeId, bool _isDeployer)
        public
        onlyRole(DAO_ROLE)
        updateState
    {
        require(nodes[nodeId].isDeployer != _isDeployer, "Alreay updated");
        nodes[nodeId].isDeployer = _isDeployer;
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
     * @dev Returns a list of the nodes.
     * @param from first node id.
     * @param to last node id.
     */
    function getAllNodes(uint256 from, uint256 to)
        public
        view
        returns (Node[] memory nodesList)
    {
        uint256 count = to - from;
        nodesList = new Node[](count);
        for (uint256 i = 0; i <= count; i++) {
            nodesList[i] = nodes[i + from];
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
