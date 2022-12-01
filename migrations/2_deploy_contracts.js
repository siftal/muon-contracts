const nodeManager = artifacts.require("MuonNodeManager.sol");
const nodeStaking = artifacts.require("MuonNodeStaking.sol");
const token = artifacts.require("MuonTestToken.sol");

const { toBN } = web3.utils;

function parseArgv() {
    let args = process.argv.slice(2);
    let params = args.filter((arg) => arg.startsWith("--"));
    let result = {};
    params.map((p) => {
        let [key, value] = p.split("=");
        result[key.slice(2)] = value === undefined ? true : value;
    });
    return result;
}

/**
 * Deploy MuonNodeManager:
 * ./node_modules/.bin/truffle deploy --network=development --node-manager --nodes=../nodes.json --deployer
 *
 * Deploy Token:
 * ./node_modules/.bin/truffle deploy --network=development --token
 *
 * Deploy MounNodeStaking:
 * ./node_modules/.bin/truffle deploy --node-staking --token-addr=0x-token --node-manager-addr=0x-node-manager
 */
module.exports = async function (deployer) {
    let args = parseArgv();
    if (args["node-manager"]) {
        await deployer.deploy(nodeManager);
        nodeManagerDeployed = await nodeManager.deployed();
        if (args["nodes"]) {
            let nodes = require(args["nodes"]);
            console.log(`Adding ${nodes.length} nodes`);
            for (i = 0; i < nodes.length; i++) {
                console.log(`Node ${nodes[i][1]}`);
                await nodeManagerDeployed.addNode(
                    nodes[i][1],
                    nodes[i][2],
                    nodes[i][3],
                    true
                );
            }
            if ("--deployer") {
                for (i = 0; i < nodes.length; i++) {
                    console.log(`Set isDeployer for ${nodes[i][1]}`);
                    await nodeManagerDeployed.setIsDeployer(i + 1, true);
                }
            }
        }
    }

    if (args["token"]) {
        await deployer.deploy(token);
    }

    if (args["node-staking"]) {
        await deployer.deploy(
            nodeStaking,
            args["token-addr"],
            args["node-manager-addr"]
        );
    }
};
