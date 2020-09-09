import fetch, { RequestInit } from 'node-fetch';
import {
    makeSTXTokenTransfer,
    makeContractDeploy,
    PostConditionMode,
    makeContractCall,
    ClarityValue,
    StacksTestnet,
    getAddressFromPrivateKey,
    sponsorTransaction,
    getAbi,
    estimateContractFunctionCall
} from '@blockstack/stacks-transactions';
import { ClarityAbi, getTypeString, encodeClarityValue, ClarityAbiFunction } from '../event-stream/contract-abi';
import * as BN from 'bn.js';
import * as fs from 'fs';
import { StacksCoreRpcClient, getCoreNodeEndpoint } from '../core-rpc/client';
import * as BigNum from 'bn.js';
import { assertNotNullish } from '../helpers';

const sender1 = {
    address: "STF9B75ADQAVXQHNEQ6KGHXTG7JP305J2GRWF3A2",
    privateKey: "ce109fee08860bb16337c76647dcbc02df0c06b455dd69bcf30af74d4eedd19301",
    nonce: 0
}
const sender2 = {
    address: "ST18MDW2PDTBSCR1ACXYRJP2JX70FWNM6YY2VX4SS",
    privateKey: "08c14a1eada0dd42b667b40f59f7c8dedb12113613448dc04980aea20b268ddb01",
    nonce: 0
}

const sender3 = {
    address: "ST1DTAEAKM02GKCT4NGKTVER8MTJJHYQ9NT27E677",
    privateKey: "fdab825d3a12ca73d24c0b446eda8639605025450a4bf6716a2627121c594d0a01",
    nonce: 0
}

const senders = [sender1, sender2, sender3]

const recipientAdd1 = "ST3KTZ45AQES4PNNHB2YGGJ4JXQQMRACRNZPQ19SP"
const recipientAdd2 = "ST17ZNMSQMDARSCZ85Z7BVJX6T20ZWDF3VX0ZP33K"
const recipientAdd3 = "ST3DR3THSKSWRH10SEDFFP3D90KZYG57J5N8M9KR9"
const recipientPk3 = "3af9b0b442389252c61db56233a2267cd242cc9f8a3284ae64808784c684c4ef01"

const contracts: string[] = []

const HOST = "host.docker.internal"
const PORT = 20443
const URL = `http://${HOST}:${PORT}`

const stacksNetwork = GetStacksTestnetNetwork();

async function start() {

    console.log("## START TEST TXS ##")
    await injectStxTransfer()
    await injectDeployContract()
    await injectContractFunctionCall()
}

async function injectStxTransfer() {

    console.log("## INJECTING STX TRANSFER ##")
    await transferStx(recipientAdd1, 1000, sender1.privateKey)
    await sleep(1000)
    await transferStx(recipientAdd2, 1000, sender1.privateKey)
    await sleep(1000)
    await transferStx(recipientAdd3, 1000, sender1.privateKey)
    await sleep(1000)

    await transferStx(recipientAdd1, 1000, sender2.privateKey)
    await sleep(1000)
    await transferStx(recipientAdd2, 1000, sender2.privateKey)
    await sleep(1000)
    await transferStx(recipientAdd3, 1000, sender2.privateKey)
    await sleep(1000)

    await transferStx(sender3.address, 6000, sender1.privateKey)
    await sleep(1000)
    await transferStx(sender3.address, 6000, sender2.privateKey)

}

async function injectDeployContract() {
    console.log("## INJECTING DEPLOY CONTRACTS ##")
    senders.forEach(async sender => {
        const response = await deployContract(sender.privateKey, "src/tests-rosetta-cli/contracts/hello-world.clar")
        await sleep(1000)
        console.log(response.contractId)
        contracts.push(response.contractId)
    })
}

async function injectContractFunctionCall() {
    console.log("## INJECTING CONTRACT CALL ##")
    contracts.forEach(async contract => {
        await sleep(1000)
        await callContractFunction(recipientPk3, contract, "say-hi")
    })

}

async function callContractFunction(senderPk: string, contractId: string, functionName: string, ...functionArgs: string[]) {

    const [contractAddr, contractName] = contractId.split('.');

    const contractAbi: ClarityAbi = await getAbi(contractAddr, contractName, stacksNetwork)
    const abiFunction = contractAbi.functions.find(fn => fn.name === functionName);
    if (abiFunction === undefined) {
        throw new Error(`Contract ${contractId} ABI does not have function "${functionName}"`);
    }
    const clarityValueArgs: ClarityValue[] = new Array(abiFunction.args.length);
    for (let i = 0; i < clarityValueArgs.length; i++) {
        const abiArg = abiFunction.args[i];
        const stringArg = assertNotNullish(functionArgs[i]);
        const clarityVal = encodeClarityValue(abiArg.type, stringArg);
        clarityValueArgs[i] = clarityVal;
    }

    const contractCallTx = await makeContractCall({
        contractAddress: contractAddr,
        contractName: contractName,
        functionName: functionName,
        functionArgs: clarityValueArgs,
        senderKey: senderPk,
        network: stacksNetwork,
        postConditionMode: PostConditionMode.Allow,
        sponsored: false,
    });
    await sleep(1000)
    const fee = await estimateContractFunctionCall(contractCallTx, stacksNetwork)
    contractCallTx.setFee(fee)

    let serialized: Buffer = contractCallTx.serialize();

    const { txId } = await sendCoreTx(serialized);

}

async function deployContract(senderPk: string, sourceFile: string) {

    const contractName = `test-contract-${uniqueId()}`;
    const senderAddress = getAddressFromPrivateKey(senderPk, stacksNetwork.version);
    const source = fs.readFileSync(sourceFile).toString();
    const normalized_contract_source = (source as string)
        .replace(/\r/g, '')
        .replace(/\t/g, ' ');

    const contractDeployTx = await makeContractDeploy({
        contractName: contractName,
        codeBody: normalized_contract_source,
        senderKey: senderPk,
        network: stacksNetwork,
        postConditionMode: PostConditionMode.Allow,
        sponsored: false,
    });

    await sleep(1000)
    const contractId = senderAddress + '.' + contractName;

    const feeRateReq = await fetch(stacksNetwork.getTransferFeeEstimateApiUrl())
    const feeRateResult = await feeRateReq.text()
    const txBytes = new BN(contractDeployTx.serialize().byteLength);
    const feeRate = new BN(feeRateResult);
    const fee = feeRate.mul(txBytes);
    contractDeployTx.setFee(fee)
    const { txId } = await sendCoreTx(contractDeployTx.serialize());

    return { txId, contractId }

}
async function transferStx(recipientAddr: string, amount: number, senderPk: string,) {

    const transferTx = await makeSTXTokenTransfer({
        recipient: recipientAddr,
        amount: new BN(amount),
        senderKey: senderPk,
        network: stacksNetwork,
        memo: "test-transaction",
        sponsored: false,
    });
    await sleep(1000)
    let serialized: Buffer = transferTx.serialize();

    const { txId } = await sendCoreTx(serialized);

    return txId;
}

async function sendCoreTx(serializedTx: Buffer): Promise<{ txId: string }> {

    try {
        const submitResult = await new StacksCoreRpcClient({
            host: HOST,
            port: PORT
        }).sendTransaction(serializedTx);
        return submitResult;
    } catch (error) {
        console.error(error)
    }
    return Promise.resolve({ txId: "" })
}

export function GetStacksTestnetNetwork() {
    const stacksNetwork = new StacksTestnet();
    stacksNetwork.coreApiUrl = getCoreNodeEndpoint({
        host: `http://${HOST}`,
        port: PORT
    });
    return stacksNetwork;
}

function uniqueId() {
    return Math.random().toString(16).slice(-4);
}

function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

start().then(() => {
    console.log("## TEST FINISHED ##")
}).catch((error) => {
    console.error(error)
})