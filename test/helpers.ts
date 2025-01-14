const chai = require("chai");
const {expect} = chai;
import hre from "hardhat";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

const getCreateAddress = (from, nonce) => {
  return hre.ethers.getCreateAddress({from: from.address || from.target || from, nonce});
};

const getContractAt = async (contractName, address, signer) => {
  return hre.ethers.getContractAt(contractName, address, signer);
};

const deploy = async (contractName, signer, txParams, ...params) => {
  const factory = await hre.ethers.getContractFactory(contractName, signer);
  const instance = await factory.deploy(...params, txParams);
  await instance.waitForDeployment();
  return instance;
};

const stringToNumber = (value) => {
  if (value && value.toString().startsWith("0x")) {
    return value;
  }
  let converted;
  try {
    converted = BigInt(value);
  } catch(err) {
    return value;
  }
  return converted <= BigInt(Number.MAX_SAFE_INTEGER) ? parseInt(converted) : converted;
};

const mixToArray = (mix) => {
  if (Array.isArray(mix)) {
    return mix;
  }
  const result = [];
  for (let i = 0;; i++) {
    const el = mix[i];
    if (el === undefined) {
      return result;
    }
    result.push(stringToNumber(el));
  }
};

// This is needed to access events from contracts touched by transaction.
const expectContractEvents = async (tx, contract, expectedEvents) => {
  const receipt = await tx;
  const txEvents = await contract.getPastEvents("allEvents", {
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });
  const events = txEvents.filter(event => event.transactionHash == tx.transactionHash);
  expect(events.length).to.equal(expectedEvents.length);
  events.forEach((event, index) => {
    expect(event.event).to.equal(expectedEvents[index][0]);
    const convertedEvents = expectedEvents[index].slice(1).map(stringToNumber);
    expect(mixToArray(event.returnValues)).to.eql(convertedEvents);
  });
};

const toBytes32 = (str) => {
  if (str.length > 32) throw new Error("String too long");
  return padRight(utf8ToHex(str), 64);
};

module.exports = {getCreateAddress, getContractAt, deploy, toBytes32,
  expectContractEvents, ZERO_ADDRESS, ZERO_BYTES32,};
