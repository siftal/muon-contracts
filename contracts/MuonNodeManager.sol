// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "./interfaces/IMuonNodeManager.sol";

contract MuonNodeManager is
    Initializable,
    AccessControlUpgradeable,
    IMuonNodeManager
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    // nodeId => Node
    mapping(uint64 => Node) public nodes;

    // nodeAddress => nodeId
    mapping(address => uint64) public nodeAddressIds;

    // stakerAddress => nodeId
    mapping(address => uint64) public stakerAddressIds;

    uint64 public lastNodeId;

    // muon nodes check lastUpdateTime to sync their memory
    uint256 public lastUpdateTime;

    // commit_id => git commit id
    mapping(string => string) public configs;

    uint64 public lastRoleId;

    // hash(role) => role id
    mapping(bytes32 => uint64) public roleIds;

    // role id => node id => index + 1
    mapping(uint64 => mapping(uint64 => uint16)) public nodesRoles;

    // node id => tier
    mapping(uint64 => uint64) public tiers;

    /**
     * @dev Modifier to update the lastUpdateTime state variable.
     */
    modifier updateState() {
        lastUpdateTime = block.timestamp;
        _;
    }

    /**
     * @dev Modifier to update the lastEditTime of a specific node.
     * @param nodeId The id of the node.
     */
    modifier updateNodeState(uint64 nodeId) {
        nodes[nodeId].lastEditTime = block.timestamp;
        _;
    }

    function __MuonNodeManagerUpgradeable_init() internal initializer {
        __AccessControl_init();

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(ADMIN_ROLE, msg.sender);
        _setupRole(DAO_ROLE, msg.sender);

        lastNodeId = 0;
        lastUpdateTime = block.timestamp;
        lastRoleId = 0;
    }

    /**
     * @dev Initializes the contract.
     */
    function initialize() external initializer {
        __MuonNodeManagerUpgradeable_init();
    }

    function __MuonNodeManagerUpgradeable_init_unchained()
        internal
        initializer
    {}

    /**
     * @dev Adds a new node.
     * Only callable by the ADMIN_ROLE.
     * @param _nodeAddress The address of the node.
     * @param _stakerAddress The address of the staker associated with the node.
     * @param _peerId The peer ID of the node.
     * @param _active Indicates whether the node is active or not.
     */
    function addNode(
        address _nodeAddress,
        address _stakerAddress,
        string calldata _peerId,
        bool _active
    )
        public
        override
        onlyRole(ADMIN_ROLE)
        updateState
    {
        require(nodeAddressIds[_nodeAddress] == 0, "Node address is already registered.");

        require(
            stakerAddressIds[_stakerAddress] == 0,
            "Staker address is already registered."
        );

        lastNodeId++;
        nodes[lastNodeId] = Node({
            id: lastNodeId,
            nodeAddress: _nodeAddress,
            stakerAddress: _stakerAddress,
            peerId: _peerId,
            active: _active,
            roles: new uint64[](0),
            startTime: block.timestamp,
            lastEditTime: block.timestamp,
            endTime: 0
        });

        nodeAddressIds[_nodeAddress] = lastNodeId;
        stakerAddressIds[_stakerAddress] = lastNodeId;

        emit NodeAdded(lastNodeId, nodes[lastNodeId]);
    }

    /**
     * @dev Allows the admins to deactivate the nodes.
     * Only callable by the ADMIN_ROLE.
     * @param nodeId The ID of the node to be deactivated.
     */
    function deactiveNode(uint64 nodeId)
        public
        override
        onlyRole(ADMIN_ROLE)
        updateState
        updateNodeState(nodeId)
    {
        require(nodes[nodeId].id == nodeId, "Node ID not found.");

        require(nodes[nodeId].active, "Node is already deactivated.");

        nodes[nodeId].endTime = block.timestamp;
        nodes[nodeId].active = false;

        emit NodeDeactivated(nodeId);
    }

    /**
     * @dev Adds a role to a given node.
     * Only callable by the DAO_ROLE.
     * @param nodeId The ID of the node.
     * @param roleId The ID of the role.
     */
    function setNodeRole(uint64 nodeId, uint64 roleId)
        public
        onlyRole(DAO_ROLE)
        updateState
        updateNodeState(nodeId)
    {
        require(nodes[nodeId].active, "Node is not active.");

        require(roleId > 0 && roleId <= lastRoleId, "Invalid role ID.");

        require(
            nodesRoles[roleId][nodeId] == 0,
            "Role is already assigned to this node."
        );

        nodes[nodeId].roles.push(roleId);
        nodesRoles[roleId][nodeId] = uint16(nodes[nodeId].roles.length);
        emit NodeRoleSet(nodeId, roleId);
    }

    /**
     * @dev Removes a role from a given node.
     * Only callable by the DAO_ROLE.
     * @param nodeId The ID of the node.
     * @param roleId The ID of the role.
     */
    function unsetNodeRole(uint64 nodeId, uint64 roleId)
        public
        onlyRole(DAO_ROLE)
        updateState
        updateNodeState(nodeId)
    {
        require(roleId > 0 && roleId <= lastRoleId, "Invalid role ID.");

        require(
            nodesRoles[roleId][nodeId] > 0,
            "Node does not have this role."
        );

        uint16 index = nodesRoles[roleId][nodeId] - 1;
        uint64 lRoleId = nodes[nodeId].roles[nodes[nodeId].roles.length - 1];
        nodes[nodeId].roles[index] = lRoleId;
        nodesRoles[lRoleId][nodeId] = index + 1;
        nodes[nodeId].roles.pop();
        nodesRoles[roleId][nodeId] = 0;
        emit NodeRoleUnset(nodeId, roleId);
    }

    /**
     * @dev Returns whether a given node has a given role.
     * @param nodeId The ID of the node.
     * @param role The role to check.
     * @return A boolean indicating whether the node has the role.
     */
    function nodeHasRole(uint64 nodeId, bytes32 role)
        public
        view
        returns (bool)
    {
        return nodesRoles[roleIds[role]][nodeId] > 0;
    }

    /**
     * @dev Returns a list of roles associated with a node.
     * @param nodeId The ID of the node.
     * @return An array of role IDs.
     */
    function getNodeRoles(uint64 nodeId) public view returns (uint64[] memory) {
        return nodes[nodeId].roles;
    }

    /**
     * @dev Returns the information of a node.
     * @param nodeId The ID of the node.
     * @return The node information.
     */
    function getNode(uint64 nodeId) public view returns (Node memory) {
        Node memory node = nodes[nodeId];
        node.roles = getNodeRoles(nodeId);
        return node;
    }

    /**
     * @dev Returns a list of nodes that have been edited.
     * @param _lastEditTime The time of the last edit.
     * @param _from The starting node ID.
     * @param _to The ending node ID.
     * @return nodesList An array of edited nodes.
     */
    function getEditedNodes(
        uint256 _lastEditTime,
        uint64 _from,
        uint64 _to
    ) public view returns (Node[] memory nodesList) {
        _from = _from > 0 ? _from : 1;
        _to = _to <= lastNodeId ? _to : lastNodeId;
        require(_from <= _to, "Invalid range of node IDs.");

        nodesList = new Node[](100);
        uint64 n = 0;
        for (uint64 i = _from; i <= _to && n < 100; i++) {
            Node memory node = nodes[i];

            if (node.lastEditTime > _lastEditTime) {
                nodesList[n] = node;
                nodesList[n].roles = getNodeRoles(i);
                n++;
            }
        }

        // Resize the array to remove any unused elements
        assembly {
            mstore(nodesList, n)
        }
    }

    /**
     * @dev Returns the information of a node associated with the provided node address.
     * @param _addr The node address.
     * @return node The node information.
     */
    function nodeAddressInfo(address _addr)
        public
        view
        returns (Node memory node)
    {
        node = nodes[nodeAddressIds[_addr]];
    }

    /**
     * @dev Returns the information of a node associated with the provided staker address.
     * @param _addr The staker address.
     * @return node The node information.
     */
    function stakerAddressInfo(address _addr)
        public
        view
        override
        returns (Node memory node)
    {
        node = nodes[stakerAddressIds[_addr]];
    }

    /**
     * @dev Returns the tier of a node.
     * @param nodeId The ID of the node.
     * @return The tier of the node.
     */
    function getTier(uint64 nodeId) external view override returns (uint64) {
        return tiers[nodeId];
    }

    /**
     * @dev Sets the tier of a node.
     * Only callable by the DAO_ROLE.
     * @param nodeId The ID of the node.
     * @param tier The tier to set.
     */
    function setTier(uint64 nodeId, uint64 tier) public onlyRole(DAO_ROLE) {
        tiers[nodeId] = tier;
        emit TierSet(nodeId, tier);
    }

    /**
     * @dev Sets a configuration value.
     * Only callable by the DAO_ROLE.
     * @param key The key of the configuration value.
     * @param val The value to be set.
     */
    function setConfig(string memory key, string memory val)
        public
        onlyRole(DAO_ROLE)
    {
        configs[key] = val;
        emit ConfigSet(key, val);
    }

    /**
     * @dev Adds a new role.
     * Only callable by the DAO_ROLE.
     * @param role The role to be added.
     */
    function addNodeRole(bytes32 role) public onlyRole(DAO_ROLE) {
        require(roleIds[role] == 0, "This role has already been added.");

        lastRoleId++;
        roleIds[role] = lastRoleId;
        emit NodeRoleAdded(role, lastRoleId);
    }

    // ======== Events ========
    event NodeAdded(uint64 indexed nodeId, Node node);
    event NodeDeactivated(uint64 indexed nodeId);
    event ConfigSet(string indexed key, string value);
    event NodeRoleAdded(bytes32 indexed role, uint64 roleId);
    event NodeRoleSet(uint64 indexed nodeId, uint64 indexed roleId);
    event NodeRoleUnset(uint64 indexed nodeId, uint64 indexed roleId);
    event TierSet(uint64 indexed nodeId, uint64 indexed tier);
}
