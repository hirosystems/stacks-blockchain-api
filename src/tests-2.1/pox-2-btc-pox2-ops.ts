/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { decodeBtcAddress } from '@stacks/stacking';
import {
  AddressStxBalanceResponse,
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolderListResponse,
  BurnchainRewardsTotal,
} from '@stacks/stacks-blockchain-api-types';
import { AnchorMode, bufferCV, makeContractCall, tupleCV, uintCV } from '@stacks/transactions';
import { testnetKeys } from '../api/routes/debug';
import { CoreRpcPoxInfo } from '../core-rpc/client';
import { DbEventTypeId, DbStxLockEvent } from '../datastore/common';
import {
  getBitcoinAddressFromKey,
  privateToPublicKey,
  VerboseKeyOutput,
  generateBitcoinAccount,
  ECPair,
} from '../ec-helpers';
import { hexToBuffer, timeout } from '../helpers';
import {
  fetchGet,
  standByForPoxCycle,
  standByForTxSuccess,
  standByUntilBurnBlock,
  testEnv,
} from '../test-utils/test-helpers';
import * as btc from 'bitcoinjs-lib';
import { c32ToB58 } from 'c32check';

// MINER_SEED 9e446f6b0c6a96cf2190e54bcd5a8569c3e386f091605499464389b8d4e0bfc201
// stx: STEW4ZNT093ZHK4NEQKX8QJGM2Y7WWJ2FQQS5C19
// btc: miEJtNKa3ASpA19v5ZhvbKTEieYjLpzCYT
// pub_key: 035379aa40c02890d253cfa577964116eb5295570ae9f7287cbae5f2585f5b2c7c
// wif: cStMQXkK5yTFGP3KbNXYQ3sJf2qwQiKrZwR9QJnksp32eKzef1za

const BTC_MINER_ADDR = 'miEJtNKa3ASpA19v5ZhvbKTEieYjLpzCYT';
const BTC_MINER_WIF = 'cStMQXkK5yTFGP3KbNXYQ3sJf2qwQiKrZwR9QJnksp32eKzef1za';

function decodeLeaderBlockCommit(txOutScript: string) {
  // Total byte length w/ OP_RETURN and lead block commit message is 83 bytes
  if (txOutScript.length !== 166) {
    return null;
  }

  const opReturnHex = '6a';
  if (!txOutScript.startsWith(opReturnHex)) {
    return null;
  }
  const decompiled = btc.script.decompile(Buffer.from(txOutScript, 'hex'));
  if (decompiled?.length !== 2) {
    return null;
  }
  const scriptData = decompiled[1];
  if (!Buffer.isBuffer(scriptData)) {
    return null;
  }

  const magicBytes = [88, 50]; // X2
  const magicBytesKrypton = [105, 100]; // id
  if (
    (scriptData[0] !== magicBytes[0] || scriptData[1] !== magicBytes[1]) &&
    (scriptData[0] !== magicBytesKrypton[0] || scriptData[1] !== magicBytesKrypton[1])
  ) {
    return null;
  }

  const opLeaderBlockCommit = Buffer.from('[');
  const stxOp = scriptData.subarray(2, 3);
  if (stxOp[0] !== opLeaderBlockCommit[0]) {
    return null;
  }

  // header block hash of the Stacks anchored block
  const blockHash = scriptData.subarray(3, 35);
  const blockHashHex = blockHash.toString('hex');

  // the next value for the VRF seed
  const newSeed = scriptData.subarray(35, 67);
  const newSeedHex = newSeed.toString('hex');

  // the burn block height of this block's parent
  const parentBlock = scriptData.subarray(67, 71);
  const parentBlockInt = parentBlock.readUInt32BE(0);

  // the vtxindex for this block's parent's block commit
  const parentTxOffset = scriptData.subarray(71, 73);
  const parentTxOffsetInt = parentTxOffset.readUInt16BE(0);

  // the burn block height of the miner's VRF key registration
  const keyBlock = scriptData.subarray(73, 77);
  const keyBlockInt = keyBlock.readUInt32BE(0);

  // the vtxindex for this miner's VRF key registration
  const keyTxOffset = scriptData.subarray(77, 79);
  const keyTxOffsetInt = keyTxOffset.readUInt16BE(0);

  // the burn block height at which this leader block commit was created modulo BURN_COMMITMENT_WINDOW (=6).
  // That is, if the block commit is included in the intended burn block then this value should be equal to: (commit_burn_height - 1) % 6.
  // This field is used to link burn commitments from the same miner together even if a commitment was included in a late burn block.
  const burnParentModulus = scriptData.subarray(79, 80)[0];

  return {
    blockHash: blockHashHex,
    newSeed: newSeedHex,
    parentBlock: parentBlockInt,
    parentTxOffset: parentTxOffsetInt,
    keyBlock: keyBlockInt,
    keyTxOffset: keyTxOffsetInt,
    burnParentModulus,
  };
}

async function disableAutoBtcMining() {
  const HALT_MINING_COMMENT = 'HALT_MINING';
  const altBtcAcc = generateBitcoinAccount({ network: 'regtest', addressFormat: 'p2pkh' });
  const fundStackerTxid: string = await testEnv.bitcoinRpcClient.sendtoaddress({
    comment: HALT_MINING_COMMENT,
    address: altBtcAcc.address,
    amount: 0.1,
    replaceable: false,
  });

  while (true) {
    const haltMiningTx = await testEnv.bitcoinRpcClient.gettransaction({
      txid: fundStackerTxid,
      verbose: true,
    });
    expect(haltMiningTx.comment).toBe(HALT_MINING_COMMENT);
    const confs: number = haltMiningTx.confirmations;
    if (confs === 0) {
      await timeout(100);
    } else {
      break;
    }
  }
}

async function startBtcMiningController() {
  const mineBlock = async () => {
    await testEnv.bitcoinRpcClient.generatetoaddress({ address: BTC_MINER_ADDR, nblocks: 1 });
  };
  const getStacksMiningTx = async () => {
    const txs: any[] = await testEnv.bitcoinRpcClient.listtransactions({});
    const zeroConfs = txs.filter(tx => tx.confirmations === 0);
    if (zeroConfs.length === 0) {
      return null;
    }
    const tx = await testEnv.bitcoinRpcClient.gettransaction({
      txid: zeroConfs[0].txid,
      verbose: true,
    });
    const voutCandidates = tx.decoded.vout.filter((v: any) => v.scriptPubKey?.type === 'nulldata');
    for (const vout of voutCandidates) {
      const blockCommit = decodeLeaderBlockCommit(vout.scriptPubKey.hex);
      if (blockCommit) {
        return blockCommit;
      }
    }
    return null;
  };
  while (true) {
    const miningTx = await getStacksMiningTx();
    if (miningTx) {
      await mineBlock();
    }
    await timeout(250);
  }
}

async function createPox2StackStx() {
  const poxInfo = await testEnv.client.getPox();
  const stxAmount = BigInt(poxInfo.min_amount_ustx * 1.2);
  const stxCycleCount = 1;
  const stackerAddr = 'STEW4ZNT093ZHK4NEQKX8QJGM2Y7WWJ2FQQS5C19';

  const utxos: any[] = await testEnv.bitcoinRpcClient.listunspent({});
  const utxo = utxos[0];
  const utxoRawTx = await testEnv.bitcoinRpcClient.getrawtransaction({ txid: utxo.txid });
  const btcAccount = ECPair.fromWIF(BTC_MINER_WIF, btc.networks.regtest);
  const feeAmount = 0.0001;
  const sats = 100000000;

  // PreStxOp: this operation prepares the Stacks blockchain node to validate the subsequent StackStxOp or TransferStxOp.
  // 0      2  3
  // |------|--|
  //  magic  op
  const preStxOpPayload = Buffer.concat([
    Buffer.from('id'), // magic: 'id' ascii encoded (for krypton)
    Buffer.from('p'), // op: 'p' ascii encoded
  ]);
  const outAmount1 = Math.round((utxo.amount - feeAmount) * sats);
  const preStxOpTxHex = new btc.Psbt({ network: btc.networks.regtest })
    .setVersion(1)
    .addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: Buffer.from(utxoRawTx, 'hex'),
    })
    .addOutput({
      script: btc.payments.embed({ data: [preStxOpPayload] }).output!,
      value: 0,
    })
    // Then, the second Bitcoin output must be Stacker address that will be used in a StackStxOp.
    // This address must be a standard address type parseable by the stacks-blockchain node.
    .addOutput({
      address: BTC_MINER_ADDR,
      value: outAmount1,
    })
    .signInput(0, btcAccount)
    .finalizeAllInputs()
    .extractTransaction(false)
    .toHex();
  const preOpTxId: string = await testEnv.bitcoinRpcClient.sendrawtransaction({
    hexstring: preStxOpTxHex,
  });

  // StackStxOp: this operation executes the stack-stx operation.
  // 0      2  3                             19        20
  // |------|--|-----------------------------|---------|
  //  magic  op         uSTX to lock (u128)     cycles (u8)
  const stackOpTxPayload = Buffer.concat([
    Buffer.from('id'), // magic: 'id' ascii encoded (for krypton)
    Buffer.from('x'), // op: 'x' ascii encoded,
    Buffer.from(stxAmount.toString(16).padStart(32, '0'), 'hex'), // uSTX to lock (u128)
    Buffer.from([stxCycleCount]), // cycles (u8)
  ]);
  const stackOpTxHex = new btc.Psbt({ network: btc.networks.regtest })
    .setVersion(1)
    .addInput({ hash: preOpTxId, index: 1, nonWitnessUtxo: Buffer.from(preStxOpTxHex, 'hex') })
    // The first input to the Bitcoin operation must consume a UTXO that is the second output of a PreStxOp.
    // This validates that the StackStxOp was signed by the appropriate Stacker address.
    .addOutput({
      script: btc.payments.embed({ data: [stackOpTxPayload] }).output!,
      value: 0,
    })
    // The second Bitcoin output will be used as the reward address for any stacking rewards.
    .addOutput({
      address: c32ToB58(stackerAddr),
      value: Math.round(outAmount1 - feeAmount * sats),
    })
    .signInput(0, btcAccount)
    .finalizeAllInputs()
    .extractTransaction(false)
    .toHex();
  const stackOpTxId: string = await testEnv.bitcoinRpcClient.sendrawtransaction({
    hexstring: stackOpTxHex,
  });

  while (true) {
    const preOpTxResult = await testEnv.bitcoinRpcClient.gettransaction({
      txid: preOpTxId,
      verbose: true,
    });
    console.log(`__PRE-OP`, preOpTxResult);
    const stackOpTxResult = await testEnv.bitcoinRpcClient.gettransaction({
      txid: stackOpTxId,
      verbose: true,
    });
    console.log(`__STACK-OP`, stackOpTxResult);
    await timeout(350);
  }
}

async function getSpendableBtcAccount() {
  const btcPrivateKey = '9e446f6b0c6a96cf2190e54bcd5a8569c3e386f091605499464389b8d4e0bfc2';
  const btcAddr = getBitcoinAddressFromKey({
    privateKey: btcPrivateKey,
    network: 'testnet',
    addressFormat: 'p2pkh',
  });
  expect(btcAddr).toBe('miEJtNKa3ASpA19v5ZhvbKTEieYjLpzCYT');
  const btcPubKey = privateToPublicKey(btcPrivateKey).toString('hex');
  expect(btcPubKey).toBe('035379aa40c02890d253cfa577964116eb5295570ae9f7287cbae5f2585f5b2c7c');

  const decodedBtcAddr = decodeBtcAddress(btcAddr);
  expect({
    data: Buffer.from(decodedBtcAddr.data).toString('hex'),
    version: decodedBtcAddr.version,
  }).toEqual({ data: '1dc27eba0247f8cc9575e7d45e50a0bc7e72427d', version: 0 });

  // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
  const btcRegtestAccount = getBitcoinAddressFromKey({
    privateKey: btcPrivateKey,
    network: 'regtest',
    addressFormat: 'p2pkh',
    verbose: true,
  });
  expect(btcRegtestAccount.address).toBe('miEJtNKa3ASpA19v5ZhvbKTEieYjLpzCYT');
  expect(btcRegtestAccount.wif).toBe('cStMQXkK5yTFGP3KbNXYQ3sJf2qwQiKrZwR9QJnksp32eKzef1za');

  // await testEnv.bitcoinRpcClient.importprivkey({
  //   privkey: btcRegtestAccount.wif,
  //   label: btcRegtestAccount.address,
  //   rescan: false,
  // });
  const btcWalletAddrs: Record<
    string,
    unknown
  > = await testEnv.bitcoinRpcClient.getaddressesbylabel({
    // label: btcRegtestAccount.address,
    label: '',
  });

  const expectedAddrs = {
    P2PKH: getBitcoinAddressFromKey({
      privateKey: btcPrivateKey,
      network: 'regtest',
      addressFormat: 'p2pkh',
    }),
    P2SH_P2WPKH: getBitcoinAddressFromKey({
      privateKey: btcPrivateKey,
      network: 'regtest',
      addressFormat: 'p2sh-p2wpkh',
    }),
    P2WPKH: getBitcoinAddressFromKey({
      privateKey: btcPrivateKey,
      network: 'regtest',
      addressFormat: 'p2wpkh',
    }),
  };

  expect(Object.keys(btcWalletAddrs)).toEqual(expect.arrayContaining(Object.values(expectedAddrs)));
  expect(Object.keys(btcWalletAddrs)).toContain(btcRegtestAccount.address);

  const balances = await testEnv.bitcoinRpcClient.getbalances();
  console.log(balances);

  // const ff = await testEnv.bitcoinRpcClient.generatetoaddress({ address: btcAddr, nblocks: 1 });
  // console.log(ff);

  const altBtcAcc = generateBitcoinAccount({ network: 'regtest', addressFormat: 'p2pkh' });
  // const STACKER_WALLET = 'stacker';
  // const altWallet = await testEnv.bitcoinRpcClient.createwallet({ wallet_name: STACKER_WALLET });
  // console.log(altWallet);

  // const altWalletImport = await testEnv.bitcoinRpcClient.importprivkey(
  //   { privkey: altBtcAcc.wif, label: altBtcAcc.address, rescan: false },
  //   STACKER_WALLET
  // );
  // console.log(altWalletImport);

  // const altWalletAddrs = await testEnv.bitcoinRpcClient.getaddressesbylabel(
  //   { label: altBtcAcc.address },
  //   STACKER_WALLET
  // );
  // console.log(altWalletAddrs);

  // Send a special tx telling the mining script to stop and allow manual mining
  const HALT_MINING_COMMENT = 'HALT_MINING';
  // const ff3 = await testEnv.bitcoinRpcClient.settxfee({ amount: DEFAULT_TX_FEE });
  // console.log(ff3);

  const fundStackerTxid: string = await testEnv.bitcoinRpcClient.sendtoaddress({
    comment: HALT_MINING_COMMENT,
    address: altBtcAcc.address,
    amount: 3.14,
  });
  console.log(fundStackerTxid);

  const g1 = await testEnv.bitcoinRpcClient.gettransaction({
    txid: fundStackerTxid,
    verbose: true,
  });
  console.log(g1);

  while (true) {
    const listTxResult: any[] = await testEnv.bitcoinRpcClient.listtransactions({
      include_watchonly: true,
    });
    console.log(listTxResult);
    const found1 = listTxResult.find(tx => 'comment' in tx);
    console.log(found1);
    const found2 = listTxResult.filter(tx => tx.txid === fundStackerTxid);
    console.log(found2);
    await timeout(100);
  }
  await timeout(10000000);
}

/*
async function broadcastStackSTXThroughBitcoin(
  bitcoinRpcClient: RPCClient,
  orchestrator: DevnetNetworkOrchestrator,
  bitcoinRpcUrl: string,
  bitcoinRpcUsername: string,
  bitcoinRpcPassword: string,
  indexedBitcoinWallet: Account,
  amountToStacks: number,
  cycles: number
) {
  // Steps:
  // - Retrieve a UTXO
  // - Craft and broadcast a `PreOp` transaction where:
  //    - Output 1 is a PreOp signal
  //    - Output 2 is a legacy address that will be converted to the Stacks Address
  // - Craft and broadcast the actual Stacks Op transaction where
  //    - Input 1 is the Output 2 of the `PreOp` transaction
  //    - Output 1 the actual Op OP_RETURN
  let secretKey = new bitcore.PrivateKey(
    indexedBitcoinWallet.secretKey.slice(0, 64),
    bitcore.Networks.testnet
  );

  console.log(indexedBitcoinWallet.btcAddress);
  let basicAuthorization =
    "Basic " + btoa(`${bitcoinRpcUsername}:${bitcoinRpcPassword}`);
    console.log(`---> ${bitcoinRpcUrl}`);
  let response = await fetch(bitcoinRpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuthorization,
    },
    body: JSON.stringify({
      id: 0,
      method: `listunspent`,
      params: [1, 9999999, [indexedBitcoinWallet.btcAddress]],
    }),
  });
  let json = await response.json();
  // let unspentOutputs = json.result;
  let unspentOutputs = await bitcoinRpcClient.listunspent()

  let typicalSize = 600;
  let txFee = 10 * typicalSize;
  let totalRequired = txFee;
  let selectedUtxosIndices: number[] = [];
  let cumulatedAmount = 0;
  let i = 0;

  for (let utxo of unspentOutputs) {
    cumulatedAmount += utxo.amount * 100_000_000;
    selectedUtxosIndices.push(i);
    if (cumulatedAmount >= totalRequired) {
      break;
    }
    i++;
  }
  if (cumulatedAmount < totalRequired) {
    return {
      message: "Funding unsufficient",
      unspentOutputs: unspentOutputs,
      statusCode: 404,
    };
  }

  selectedUtxosIndices.reverse();
  let preTransaction = new Transaction();
  preTransaction.setVersion(1);
  let selectedUnspentOutput: any[] = [];
  for (let index of selectedUtxosIndices) {
    let unspentOutput = unspentOutputs[index];

    unspentOutputs.splice(index, 1);
    let input = Input.fromObject({
      prevTxId: unspentOutput.txid,
      script: Script.empty(),
      outputIndex: unspentOutput.vout,
      output: new Output({
        satoshis: parseInt(unspentOutput.amount),
        script: Buffer.from(unspentOutput.scriptPubKey, "hex"),
      }),
    });
    preTransaction.addInput(new Input.PublicKeyHash(input));
    selectedUnspentOutput.push(unspentOutput);
  }

  //  Wire format:
  //  0      2  3
  //  |------|--|
  //    magic  op
  let magicBytes = asciiToBytes("id");
  let opCodeByte = asciiToBytes("p");
  let messageBytes = concatBytes(magicBytes, opCodeByte);
  console.log(`${messageBytes}`);
  let unwrapOutput = new Output({
    satoshis: 0,
    script: new Script()
    .add(Opcode.map.OP_RETURN)
    .add(Opcode.map.OP_PUSHDATA1)
    .add(Buffer.from(messageBytes))
  });
  preTransaction.outputs.push(unwrapOutput);

  let principal = principalCV(indexedBitcoinWallet.stxAddress);
  console.log(principal.address.hash160)
  let changeOutput = new Output({
    satoshis: cumulatedAmount - txFee,
    script: new Script()
      .add(Opcode.map.OP_DUP)
      .add(Opcode.map.OP_HASH160)
      .add(Buffer.from(principal.address.hash160, "hex"))
      .add(Opcode.map.OP_EQUALVERIFY)
      .add(Opcode.map.OP_CHECKSIG),
  });
  preTransaction.outputs.push(changeOutput);

  preTransaction.sign(secretKey, Signature.SIGHASH_ALL, "ecdsa");
  let preTx = preTransaction.serialize(true);

  console.log(`${preTx}`)

  response = await fetch(bitcoinRpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuthorization,
    },
    body: JSON.stringify({
      id: 0,
      method: `sendrawtransaction`,
      params: [preTx],
    }),
  });
  json = await response.json();
  let preTxid = json.result;

  console.log(`PreOp: ${preTxid}`);

  // let chainUpdate = await orchestrator.waitForNextBitcoinBlock();
  // chainUpdate.new_blocks[0].transactions;

  let transaction = new Transaction();
  transaction.setVersion(1);

  let input = Input.fromObject({
    prevTxId: preTxid,
    script: Script.empty(),
    outputIndex: 1,
    output: changeOutput,
  });
  transaction.addInput(new Input.PublicKeyHash(input));
  //  Wire format:
  //  0      2  3                             19        20
  //  |------|--|-----------------------------|---------|
  //    magic op       uSTX to lock (u128)     cycles (u8)
  opCodeByte = asciiToBytes("x");
  let amountBytes = bigIntToBytes(intToBigInt(amountToStacks, false));
  let cyclesBytes = intToBytes(cycles, false, 1);
  messageBytes = concatBytes(magicBytes, opCodeByte, amountBytes, cyclesBytes);
  unwrapOutput = new Output({
    satoshis: 0,
    script: new Script()
    .add(Opcode.map.OP_RETURN)
    .add(Opcode.map.OP_PUSHDATA1)
    .add(Buffer.from(messageBytes))
  });
  transaction.outputs.push(unwrapOutput);
  changeOutput = new Output({
    satoshis: cumulatedAmount - txFee - txFee,
    script: new Script()
      .add(Opcode.map.OP_DUP)
      .add(Opcode.map.OP_HASH160)
      .add(Buffer.from(principal.address.hash160, "hex"))
      .add(Opcode.map.OP_EQUALVERIFY)
      .add(Opcode.map.OP_CHECKSIG),
  });
  transaction.outputs.push(changeOutput);

  transaction.sign(secretKey, Signature.SIGHASH_ALL, "ecdsa");
  let tx = transaction.serialize(true);
  response = await fetch(bitcoinRpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuthorization,
    },
    body: JSON.stringify({
      id: 0,
      method: `sendrawtransaction`,
      params: [tx],
    }),
  });
  json = await response.json();
  console.log(json);
  let txid = json.result;
  console.log(txid);
};
*/

describe('PoX-2 - Stack using Bitcoin-chain ops', () => {
  describe('PoX-2 - Stack-stx using Bitcoin op', () => {
    const account = testnetKeys[1];
    let poxInfo: CoreRpcPoxInfo;
    let burnBlockHeight: number;
    let cycleBlockLength: number;
    let contractAddress: string;
    let contractName: string;
    let ustxAmount: bigint;
    const cycleCount = 1;

    beforeAll(async () => {
      poxInfo = await testEnv.client.getPox();
      burnBlockHeight = poxInfo.current_burnchain_block_height as number;

      ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      cycleBlockLength = cycleCount * poxInfo.reward_cycle_length;

      [contractAddress, contractName] = poxInfo.contract_id.split('.');
      expect(contractName).toBe('pox-2');
    });

    test('Send Stack-stx Bitcoin tx', async () => {
      await createPox2StackStx();
      await timeout(10000000);
      console.log('here');
    });

    test('Get spendable Bitcoin account', async () => {
      console.log('here 1');
      // await getSpendableBtcAccount();
      await disableAutoBtcMining();
      console.log('here 2');
    });

    test('Start custom Bitcoin mining controller', async () => {
      const startInfo = await testEnv.client.getInfo();
      await startBtcMiningController();
      while (true) {
        const curInfo = await testEnv.client.getInfo();
        if (curInfo.stacks_tip_height > startInfo.stacks_tip_height) {
          break;
        }
        await timeout(100);
      }
    });

    test('Fund Bitcoin account for Stacking', async () => {
      console.log('here 3');
      await timeout(100000);
    });
  });
});
