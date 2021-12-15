import {
  CoreNodeBlockMessage,
  CoreNodeEvent,
  CoreNodeEventType,
  CoreNodeMicroblockTxMessage,
  CoreNodeParsedTxMessage,
  CoreNodeTxMessage,
  isTxWithMicroblockInfo,
  StxLockEvent,
  StxTransferEvent,
} from './core-node-message';
import {
  readTransaction,
  TransactionPayloadTypeID,
  RecipientPrincipalTypeId,
  Transaction,
  TransactionAuthTypeID,
  SigHashMode,
  TransactionPublicKeyEncoding,
  TransactionAnchorMode,
  TransactionPostConditionMode,
} from '../p2p/tx';
import { DbMicroblockPartial } from '../datastore/common';
import { NotImplementedError } from '../errors';
import { getEnumDescription, logger, logError, I32_MAX } from '../helpers';
import {
  TransactionVersion,
  addressFromVersionHash,
  addressHashModeToVersion,
  addressToString,
  AddressHashMode,
  BufferReader,
  ChainID,
  createAddress,
  deserializeCV,
  ClarityValue,
  uintCV,
  tupleCV,
  bufferCV,
  serializeCV,
  ResponseOkCV,
  TupleCV,
  UIntCV,
  StandardPrincipalCV,
} from '@stacks/transactions';
import { c32address } from 'c32check';

export function getTxSenderAddress(tx: Transaction): string {
  const txSender = getAddressFromPublicKeyHash(
    tx.auth.originCondition.signer,
    tx.auth.originCondition.hashMode as number,
    tx.version
  );
  return txSender;
}

export function getTxSponsorAddress(tx: Transaction): string | undefined {
  let sponsorAddress: string | undefined = undefined;
  if (tx.auth.typeId === TransactionAuthTypeID.Sponsored) {
    sponsorAddress = getAddressFromPublicKeyHash(
      tx.auth.sponsorCondition.signer,
      tx.auth.sponsorCondition.hashMode as number,
      tx.version
    );
  }
  return sponsorAddress;
}

function getAddressFromPublicKeyHash(
  publicKeyHash: Buffer,
  hashMode: AddressHashMode,
  transactionVersion: TransactionVersion
): string {
  const addrVer = addressHashModeToVersion(hashMode, transactionVersion);
  if (publicKeyHash.length !== 20) {
    throw new Error('expected 20-byte pubkeyhash');
  }
  const addr = addressFromVersionHash(addrVer, publicKeyHash.toString('hex'));
  const addrString = addressToString(addr);
  return addrString;
}

function createTransactionFromCoreBtcStxLockEvent(
  chainId: ChainID,
  event: StxLockEvent,
  burnBlockHeight: number,
  txResult: string
): Transaction {
  const resultCv: ResponseOkCV = deserializeCV(Buffer.from(txResult.substr(2), 'hex'));
  const resultTuple = resultCv.value as TupleCV;
  const lockAmount = resultTuple.data['lock-amount'] as UIntCV;
  const stacker = resultTuple.data['stacker'] as StandardPrincipalCV;
  const unlockBurnHeight = Number((resultTuple.data['unlock-burn-height'] as UIntCV).value);

  // Number of cycles: floor((unlock-burn-height - burn-height) / reward-cycle-length)
  const rewardCycleLength = chainId === ChainID.Mainnet ? 2100 : 50;
  const lockPeriod = Math.floor((unlockBurnHeight - burnBlockHeight) / rewardCycleLength);
  const senderAddress = createAddress(event.stx_lock_event.locked_address);
  const poxAddress = createAddress(
    chainId === ChainID.Mainnet ? 'SP000000000000000000002Q6VF78' : 'ST000000000000000000002AMW42H'
  );

  const clarityFnArgs: ClarityValue[] = [
    lockAmount,
    tupleCV({
      hashbytes: bufferCV(Buffer.from(stacker.address.hash160, 'hex')),
      version: bufferCV(Buffer.from([stacker.address.version])),
    }),
    uintCV(burnBlockHeight), // start-burn-height
    uintCV(lockPeriod), // lock-period
  ];
  const fnLenBuffer = Buffer.alloc(4);
  fnLenBuffer.writeUInt32BE(clarityFnArgs.length);
  const rawFnArgs = Buffer.concat([fnLenBuffer, ...clarityFnArgs.map(c => serializeCV(c))]);

  const tx: Transaction = {
    version: chainId === ChainID.Mainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet,
    chainId: chainId,
    auth: {
      typeId: TransactionAuthTypeID.Standard,
      originCondition: {
        hashMode: SigHashMode.P2PKH,
        signer: Buffer.from(senderAddress.hash160, 'hex'),
        nonce: BigInt(0),
        feeRate: BigInt(0),
        keyEncoding: TransactionPublicKeyEncoding.Compressed,
        signature: Buffer.alloc(0),
      },
    },
    anchorMode: TransactionAnchorMode.Any,
    postConditionMode: TransactionPostConditionMode.Allow,
    postConditions: [],
    rawPostConditions: Buffer.from([TransactionPostConditionMode.Allow, 0, 0, 0, 0]),
    payload: {
      typeId: TransactionPayloadTypeID.ContractCall,
      address: {
        version: poxAddress.version,
        bytes: Buffer.from(poxAddress.hash160, 'hex'),
      },
      contractName: 'pox',
      functionName: 'stack-stx',
      functionArgs: clarityFnArgs,
      rawFunctionArgs: rawFnArgs,
    },
  };
  return tx;
}

function createTransactionFromCoreBtcTxEvent(
  chainId: ChainID,
  event: StxTransferEvent
): Transaction {
  const recipientAddress = createAddress(event.stx_transfer_event.recipient);
  const senderAddress = createAddress(event.stx_transfer_event.sender);
  const tx: Transaction = {
    version: chainId === ChainID.Mainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet,
    chainId: chainId,
    auth: {
      typeId: TransactionAuthTypeID.Standard,
      originCondition: {
        hashMode: SigHashMode.P2PKH,
        signer: Buffer.from(senderAddress.hash160, 'hex'),
        nonce: BigInt(0),
        feeRate: BigInt(0),
        keyEncoding: TransactionPublicKeyEncoding.Compressed,
        signature: Buffer.alloc(0),
      },
    },
    anchorMode: TransactionAnchorMode.Any,
    postConditionMode: TransactionPostConditionMode.Allow,
    postConditions: [],
    rawPostConditions: Buffer.from([TransactionPostConditionMode.Allow, 0, 0, 0, 0]),
    payload: {
      typeId: TransactionPayloadTypeID.TokenTransfer,
      recipient: {
        typeId: RecipientPrincipalTypeId.Address,
        address: {
          version: recipientAddress.version,
          bytes: Buffer.from(recipientAddress.hash160, 'hex'),
        },
      },
      amount: BigInt(event.stx_transfer_event.amount),
      memo: Buffer.alloc(0),
    },
  };
  return tx;
}

export interface CoreNodeMsgBlockData {
  block_hash: string;
  index_block_hash: string;
  parent_index_block_hash: string;
  parent_block_hash: string;
  parent_burn_block_timestamp: number;
  parent_burn_block_height: number;
  parent_burn_block_hash: string;
  block_height: number;
  burn_block_time: number;
  burn_block_height: number;
}

export function parseMicroblocksFromTxs(args: {
  parentIndexBlockHash: string;
  txs: CoreNodeTxMessage[];
  parentBurnBlock: {
    hash: string;
    time: number;
    height: number;
  };
}): DbMicroblockPartial[] {
  const microblockMap = new Map<string, DbMicroblockPartial>();
  args.txs.forEach(tx => {
    if (isTxWithMicroblockInfo(tx) && !microblockMap.has(tx.microblock_hash)) {
      const dbMbPartial: DbMicroblockPartial = {
        microblock_hash: tx.microblock_hash,
        microblock_sequence: tx.microblock_sequence,
        microblock_parent_hash: tx.microblock_parent_hash,
        parent_index_block_hash: args.parentIndexBlockHash,
        parent_burn_block_height: args.parentBurnBlock.height,
        parent_burn_block_hash: args.parentBurnBlock.hash,
        parent_burn_block_time: args.parentBurnBlock.time,
      };
      microblockMap.set(tx.microblock_hash, dbMbPartial);
    }
  });
  const dbMicroblocks = [...microblockMap.values()].sort(
    (a, b) => a.microblock_sequence - b.microblock_sequence
  );
  return dbMicroblocks;
}

export function parseMessageTransaction(
  chainId: ChainID,
  coreTx: CoreNodeTxMessage,
  blockData: CoreNodeMsgBlockData,
  allEvents: CoreNodeEvent[]
): CoreNodeParsedTxMessage | null {
  try {
    const txBuffer = Buffer.from(coreTx.raw_tx.substring(2), 'hex');
    let rawTx: Transaction;
    let txSender: string;
    let sponsorAddress: string | undefined = undefined;
    if (coreTx.raw_tx === '0x00') {
      const event = allEvents.find(event => event.txid === coreTx.txid);
      if (!event) {
        logger.warn(`Could not find event for process BTC tx: ${JSON.stringify(coreTx)}`);
        return null;
      }
      if (event.type === CoreNodeEventType.StxTransferEvent) {
        rawTx = createTransactionFromCoreBtcTxEvent(chainId, event);
        txSender = event.stx_transfer_event.sender;
      } else if (event.type === CoreNodeEventType.StxLockEvent) {
        rawTx = createTransactionFromCoreBtcStxLockEvent(
          chainId,
          event,
          blockData.burn_block_height,
          coreTx.raw_result
        );
        txSender = event.stx_lock_event.locked_address;
      } else {
        logError(
          `BTC transaction found, but no STX transfer event available to recreate transaction. TX: ${JSON.stringify(
            coreTx
          )}`
        );
        throw new Error('Unable to generate transaction from BTC tx');
      }
    } else {
      const bufferReader = BufferReader.fromBuffer(txBuffer);
      rawTx = readTransaction(bufferReader);
      txSender = getTxSenderAddress(rawTx);
      sponsorAddress = getTxSponsorAddress(rawTx);
    }
    const parsedTx: CoreNodeParsedTxMessage = {
      core_tx: coreTx,
      nonce: Number(rawTx.auth.originCondition.nonce),
      raw_tx: txBuffer,
      parsed_tx: rawTx,
      block_hash: blockData.block_hash,
      index_block_hash: blockData.index_block_hash,
      parent_index_block_hash: blockData.parent_index_block_hash,
      parent_block_hash: blockData.parent_block_hash,
      parent_burn_block_hash: blockData.parent_burn_block_hash,
      parent_burn_block_time: blockData.parent_burn_block_timestamp,
      block_height: blockData.block_height,
      burn_block_time: blockData.burn_block_time,
      microblock_sequence: coreTx.microblock_sequence ?? I32_MAX,
      microblock_hash: coreTx.microblock_hash ?? '',
      sender_address: txSender,
      sponsor_address: sponsorAddress,
    };
    const payload = rawTx.payload;
    switch (payload.typeId) {
      case TransactionPayloadTypeID.Coinbase: {
        break;
      }
      case TransactionPayloadTypeID.SmartContract: {
        logger.verbose(`Smart contract deployed: ${parsedTx.sender_address}.${payload.name}`);
        break;
      }
      case TransactionPayloadTypeID.ContractCall: {
        const address = c32address(payload.address.version, payload.address.bytes.toString('hex'));
        logger.verbose(`Contract call: ${address}.${payload.contractName}.${payload.functionName}`);
        break;
      }
      case TransactionPayloadTypeID.TokenTransfer: {
        let recipientPrincipal = c32address(
          payload.recipient.address.version,
          payload.recipient.address.bytes.toString('hex')
        );
        if (payload.recipient.typeId === RecipientPrincipalTypeId.Contract) {
          recipientPrincipal += '.' + payload.recipient.contractName;
        }
        logger.verbose(
          `Token transfer: ${payload.amount} from ${parsedTx.sender_address} to ${recipientPrincipal}`
        );
        break;
      }
      default: {
        throw new NotImplementedError(
          `extracting data for tx type: ${getEnumDescription(
            TransactionPayloadTypeID,
            rawTx.payload.typeId
          )}`
        );
      }
    }
    return parsedTx;
  } catch (error) {
    logError(`error parsing message transaction ${JSON.stringify(coreTx)}: ${error}`, error);
    throw error;
  }
}
