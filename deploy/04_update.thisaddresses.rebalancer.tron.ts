import dotenv from "dotenv";
dotenv.config();
import {
  getHardhatNetworkConfig, getNetworkConfig, logDeployers,
  idWithMainAsset, getMainAsset,
  getDestinationRebalancerAddresses
} from "../scripts/helpers";
import {
  assert, isSet, DomainSolidity, SolidityDomain, sameIgnoreCase, DEFAULT_ADMIN_ROLE,
} from "../scripts/common";
import {
  Network, NetworkConfig,
} from "../network.config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import {ResourceCalculator} from "../scripts/helpers.tron";

const main: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [admin] = await hre.getUnnamedAccounts();
  const calculator = ResourceCalculator.getInstance();
  const validateDeployers = hre.network.name !== "localtron";
  const deployEnv = process.env.DEPLOY_TYPE === "STAGE" ? "Stage_" : "Prod_";

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log("Updating Rebalancer this-addresses");
  ({network, config} = await getNetworkConfig(validateDeployers));
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  await logDeployers(validateDeployers);

  const {mainAsset} = getMainAsset(config);
  const rebalancerId = deployEnv + idWithMainAsset(mainAsset, "Rebalancer");

  const targetAddress = (await hre.deployments.get(rebalancerId)).address;
  const target = await hre.ethers.getContractAt("Rebalancer", targetAddress);

  const localConfig = await getDestinationRebalancerAddresses(network, mainAsset, true);
  const localConfigDisplay: {Domain: Network, ThisAddress: string}[] = localConfig.map(el => ({
    Domain: SolidityDomain[Number(el.domain)],
    ThisAddress: el.thisAddress as string,
  }));

  const onchainConfig: {Domain: Network, ThisAddress: string}[] = [];
  for (const otherNetwork of Object.values(Network)) {
    if (otherNetwork === network) continue;
    const onchainThisAddress = await target.getThisAddress(DomainSolidity[otherNetwork]);
    onchainConfig.push({Domain: otherNetwork, ThisAddress: onchainThisAddress});
  }

  console.log("The onchain configuration is:");
  console.table(onchainConfig);
  console.log("The updated configuration should be:");
  console.table(localConfigDisplay);

  const toUpdate = localConfigDisplay.filter(el => !onchainConfig.some(el2 =>
    el2.Domain === el.Domain && sameIgnoreCase(el2.ThisAddress, el.ThisAddress)
  ));

  const hasRole = await target.hasRole(DEFAULT_ADMIN_ROLE, admin);

  if (toUpdate.length > 0) {
    const toUpdateParams = toUpdate.map(el => ({
      domain: DomainSolidity[el.Domain],
      thisAddress: el.ThisAddress,
    }));
    if (hasRole) {
      // This does not on the local tronbox TRE, as it doesn't seem to support struct arrays.
      assert(!isSet(process.env.DRY_RUN), "tronbox TRE does not support struct arrays");
      await calculator.execute(
        hre,
        rebalancerId,
        {from: admin, log: true},
        "setThisAddresses",
        toUpdateParams,
      );
      console.log(`Following this-addresses are now set on ${targetAddress}.`);
    } else {
      console.log("To update this-addresses execute the following transaction.");
      console.log(`To: ${targetAddress}`);
      console.log("Function: setThisAddresses");
      console.log("Params:");
      console.table(toUpdateParams.map(el => ({
        ...el,
        domain: `${el.domain} (${SolidityDomain[Number(el.domain)]})`,
      })));
      const updateTx = await target.setThisAddresses.populateTransaction(toUpdateParams);
      console.log(`Raw data: ${updateTx.data}`);
      console.log(await target.setThisAddresses.staticCall(toUpdateParams, {from: admin}));
    }
  } else {
    console.log("There are no this-address updates needed.");
  }

  console.log("Tron resources spent:");
  ResourceCalculator.getInstance().report();
};

main.tags = ["UpdateThisAddressesRebalancer"];
export default main;
