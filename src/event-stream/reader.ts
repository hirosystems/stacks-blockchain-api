import {
  CoreNodeBlockMessage,
  CoreNodeEvent,
  CoreNodeEventType,
  CoreNodeMicroblockTxMessage,
  CoreNodeParsedTxMessage,
  CoreNodeTxMessage,
  isTxWithMicroblockInfo,
  SmartContractEvent,
  StxLockEvent,
  StxTransferEvent,
} from './core-node-message';
import {
  decodeClarityValue,
  decodeTransaction,
  decodeStacksAddress,
  ClarityTypeID,
  ClarityValuePrincipalStandard,
  ClarityValueResponse,
  ClarityValueTuple,
  ClarityValueUInt,
  AnchorModeID,
  DecodedTxResult,
  PostConditionModeID,
  PrincipalTypeID,
  TxPayloadTypeID,
  PostConditionAuthFlag,
  TxPublicKeyEncoding,
  TxSpendingConditionSingleSigHashMode,
  decodeClarityValueList,
} from 'stacks-encoding-native-js';
import {
  DbMicroblockPartial,
  DbPox2DelegateStxEvent,
  DbPox2StackStxEvent,
} from '../datastore/common';
import { NotImplementedError } from '../errors';
import {
  getEnumDescription,
  logger,
  logError,
  I32_MAX,
  bufferToHexPrefixString,
  hexToBuffer,
} from '../helpers';
import {
  TransactionVersion,
  ChainID,
  uintCV,
  tupleCV,
  bufferCV,
  serializeCV,
  noneCV,
  someCV,
  OptionalCV,
  TupleCV,
  BufferCV,
  SomeCV,
  NoneCV,
  UIntCV,
} from '@stacks/transactions';
import { poxAddressToTuple } from '@stacks/stacking';
import { c32ToB58 } from 'c32check';
import { decodePox2PrintEvent } from './pox2-event-parsing';
import { Pox2ContractIdentifer, Pox2EventName } from '../pox-helpers';
import { principalCV } from '@stacks/transactions/dist/clarity/types/principalCV';

export function getTxSenderAddress(tx: DecodedTxResult): string {
  const txSender = tx.auth.origin_condition.signer.address;
  return txSender;
}

export function getTxSponsorAddress(tx: DecodedTxResult): string | undefined {
  let sponsorAddress: string | undefined = undefined;
  if (tx.auth.type_id === PostConditionAuthFlag.Sponsored) {
    sponsorAddress = tx.auth.sponsor_condition.signer.address;
  }
  return sponsorAddress;
}

function createTransactionFromCoreBtcStxLockEvent(
  chainId: ChainID,
  event: StxLockEvent,
  burnBlockHeight: number,
  txResult: string,
  txId: string,
  stxStacksPox2Event: DbPox2StackStxEvent | undefined
): DecodedTxResult {
  const resultCv = decodeClarityValue<
    ClarityValueResponse<
      ClarityValueTuple<{
        'lock-amount': ClarityValueUInt;
        'unlock-burn-height': ClarityValueUInt;
        stacker: ClarityValuePrincipalStandard;
      }>
    >
  >(txResult);
  if (resultCv.type_id !== ClarityTypeID.ResponseOk) {
    throw new Error(`Unexpected tx result Clarity type ID: ${resultCv.type_id}`);
  }
  const resultTuple = resultCv.value;
  const lockAmount = resultTuple.data['lock-amount'];
  const stacker = resultTuple.data['stacker'];
  const unlockBurnHeight = Number(resultTuple.data['unlock-burn-height'].value);

  // Number of cycles: floor((unlock-burn-height - burn-height) / reward-cycle-length)
  const rewardCycleLength = chainId === ChainID.Mainnet ? 2100 : 50;
  const lockPeriod = Math.floor((unlockBurnHeight - burnBlockHeight) / rewardCycleLength);
  const senderAddress = decodeStacksAddress(event.stx_lock_event.locked_address);
  const poxAddressString =
    chainId === ChainID.Mainnet ? 'SP000000000000000000002Q6VF78' : 'ST000000000000000000002AMW42H';
  const poxAddress = decodeStacksAddress(poxAddressString);

  const contractName = event.stx_lock_event.contract_identifier?.split('.')?.[1] ?? 'pox';

  // If a pox-2 event is available then use its pox_addr, otherwise fallback to the stacker address
  const poxAddrArg = stxStacksPox2Event?.pox_addr
    ? poxAddressToTuple(stxStacksPox2Event.pox_addr)
    : poxAddressToTuple(c32ToB58(stacker.address));

  const legacyClarityVals = [
    uintCV(lockAmount.value), // amount-ustx
    poxAddrArg, // pox-addr
    uintCV(burnBlockHeight), // start-burn-height
    uintCV(lockPeriod), // lock-period
  ];
  const fnLenBuffer = Buffer.alloc(4);
  fnLenBuffer.writeUInt32BE(legacyClarityVals.length);
  const serializedClarityValues = legacyClarityVals.map(c => serializeCV(c));
  const rawFnArgs = bufferToHexPrefixString(
    Buffer.concat([fnLenBuffer, ...serializedClarityValues])
  );
  const clarityFnArgs = decodeClarityValueList(rawFnArgs);

  const tx: DecodedTxResult = {
    tx_id: txId,
    version: chainId === ChainID.Mainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet,
    chain_id: chainId,
    auth: {
      type_id: PostConditionAuthFlag.Standard,
      origin_condition: {
        hash_mode: TxSpendingConditionSingleSigHashMode.P2PKH,
        signer: {
          address_version: senderAddress[0],
          address_hash_bytes: senderAddress[1],
          address: event.stx_lock_event.locked_address,
        },
        nonce: '0',
        tx_fee: '0',
        key_encoding: TxPublicKeyEncoding.Compressed,
        signature: '0x',
      },
    },
    anchor_mode: AnchorModeID.Any,
    post_condition_mode: PostConditionModeID.Allow,
    post_conditions: [],
    post_conditions_buffer: '0x0100000000',
    payload: {
      type_id: TxPayloadTypeID.ContractCall,
      address: poxAddressString,
      address_version: poxAddress[0],
      address_hash_bytes: poxAddress[1],
      contract_name: contractName,
      function_name: 'stack-stx',
      function_args: clarityFnArgs,
      function_args_buffer: rawFnArgs,
    },
  };
  return tx;
}

/*
;; Delegate to `delegate-to` the ability to stack from a given address.
;;  This method _does not_ lock the funds, rather, it allows the delegate
;;  to issue the stacking lock.
;; The caller specifies:
;;   * amount-ustx: the total amount of ustx the delegate may be allowed to lock
;;   * until-burn-ht: an optional burn height at which this delegation expiration
;;   * pox-addr: an optional address to which any rewards *must* be sent
(define-public (delegate-stx (amount-ustx uint)
                             (delegate-to principal)
                             (until-burn-ht (optional uint))
                             (pox-addr (optional { version: (buff 1),
                                                   hashbytes: (buff 32) })))
*/
function createTransactionFromCoreBtcDelegateStxEvent(
  chainId: ChainID,
  contractEvent: SmartContractEvent,
  decodedEvent: DbPox2DelegateStxEvent,
  txResult: string,
  txId: string
): DecodedTxResult {
  const resultCv = decodeClarityValue<ClarityValueResponse>(txResult);
  if (resultCv.type_id !== ClarityTypeID.ResponseOk) {
    throw new Error(`Unexpected tx result Clarity type ID: ${resultCv.type_id}`);
  }

  const senderAddress = decodeStacksAddress(decodedEvent.stacker);
  const poxContractAddressString =
    chainId === ChainID.Mainnet ? 'SP000000000000000000002Q6VF78' : 'ST000000000000000000002AMW42H';
  const poxContractAddress = decodeStacksAddress(poxContractAddressString);
  const contractName = contractEvent.contract_event.contract_identifier?.split('.')?.[1] ?? 'pox';

  let poxAddr: NoneCV | OptionalCV<TupleCV> = noneCV();
  if (decodedEvent.pox_addr) {
    poxAddr = someCV(poxAddressToTuple(decodedEvent.pox_addr));
  }

  let untilBurnHeight: NoneCV | OptionalCV<UIntCV> = noneCV();
  if (decodedEvent.data.unlock_burn_height) {
    untilBurnHeight = someCV(uintCV(decodedEvent.data.unlock_burn_height));
  }

  const legacyClarityVals = [
    uintCV(decodedEvent.data.amount_ustx), // amount-ustx
    principalCV(decodedEvent.data.delegate_to), // delegate-to
    untilBurnHeight, // until-burn-ht
    poxAddr, // pox-addr
  ];
  const fnLenBuffer = Buffer.alloc(4);
  fnLenBuffer.writeUInt32BE(legacyClarityVals.length);
  const serializedClarityValues = legacyClarityVals.map(c => serializeCV(c));
  const rawFnArgs = bufferToHexPrefixString(
    Buffer.concat([fnLenBuffer, ...serializedClarityValues])
  );
  const clarityFnArgs = decodeClarityValueList(rawFnArgs);

  const tx: DecodedTxResult = {
    tx_id: txId,
    version: chainId === ChainID.Mainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet,
    chain_id: chainId,
    auth: {
      type_id: PostConditionAuthFlag.Standard,
      origin_condition: {
        hash_mode: TxSpendingConditionSingleSigHashMode.P2PKH,
        signer: {
          address_version: senderAddress[0],
          address_hash_bytes: senderAddress[1],
          address: decodedEvent.stacker,
        },
        nonce: '0',
        tx_fee: '0',
        key_encoding: TxPublicKeyEncoding.Compressed,
        signature: '0x',
      },
    },
    anchor_mode: AnchorModeID.Any,
    post_condition_mode: PostConditionModeID.Allow,
    post_conditions: [],
    post_conditions_buffer: '0x0100000000',
    payload: {
      type_id: TxPayloadTypeID.ContractCall,
      address: poxContractAddressString,
      address_version: poxContractAddress[0],
      address_hash_bytes: poxContractAddress[1],
      contract_name: contractName,
      function_name: 'delegate-stx',
      function_args: clarityFnArgs,
      function_args_buffer: rawFnArgs,
    },
  };
  return tx;
}

function createTransactionFromCoreBtcTxEvent(
  chainId: ChainID,
  event: StxTransferEvent,
  txId: string
): DecodedTxResult {
  const recipientAddress = decodeStacksAddress(event.stx_transfer_event.recipient);
  const senderAddress = decodeStacksAddress(event.stx_transfer_event.sender);
  const tx: DecodedTxResult = {
    tx_id: txId,
    version: chainId === ChainID.Mainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet,
    chain_id: chainId,
    auth: {
      type_id: PostConditionAuthFlag.Standard,
      origin_condition: {
        hash_mode: TxSpendingConditionSingleSigHashMode.P2PKH,
        signer: {
          address_version: senderAddress[0],
          address_hash_bytes: senderAddress[1],
          address: event.stx_transfer_event.sender,
        },
        nonce: '0',
        tx_fee: '0',
        key_encoding: TxPublicKeyEncoding.Compressed,
        signature: '0x',
      },
    },
    anchor_mode: AnchorModeID.Any,
    post_condition_mode: PostConditionModeID.Allow,
    post_conditions: [],
    post_conditions_buffer: '0x0100000000',
    payload: {
      type_id: TxPayloadTypeID.TokenTransfer,
      recipient: {
        type_id: PrincipalTypeID.Standard,
        address_version: recipientAddress[0],
        address_hash_bytes: recipientAddress[1],
        address: event.stx_transfer_event.recipient,
      },
      amount: BigInt(event.stx_transfer_event.amount).toString(),
      memo_hex: '0x',
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
    let rawTx: DecodedTxResult;
    let txSender: string;
    let sponsorAddress: string | undefined = undefined;
    if (coreTx.raw_tx === '0x00') {
      const events = allEvents.filter(event => event.txid === coreTx.txid);
      if (events.length === 0) {
        logger.warn(`Could not find event for process BTC tx: ${JSON.stringify(coreTx)}`);
        return null;
      }
      const stxTransferEvent = events.find(
        (e): e is StxTransferEvent => e.type === CoreNodeEventType.StxTransferEvent
      );
      const stxLockEvent = events.find(
        (e): e is StxLockEvent => e.type === CoreNodeEventType.StxLockEvent
      );

      const pox2Event = events
        .filter(
          (e): e is SmartContractEvent =>
            e.type === CoreNodeEventType.ContractEvent &&
            e.contract_event.topic === 'print' &&
            (e.contract_event.contract_identifier === Pox2ContractIdentifer.mainnet ||
              e.contract_event.contract_identifier === Pox2ContractIdentifer.testnet)
        )
        .map(e => {
          const network = chainId === ChainID.Mainnet ? 'mainnet' : 'testnet';
          const decodedEvent = decodePox2PrintEvent(e.contract_event.raw_value, network);
          if (decodedEvent) {
            return {
              contractEvent: e,
              decodedEvent,
            };
          }
        })
        .find(e => !!e);

      if (stxTransferEvent) {
        rawTx = createTransactionFromCoreBtcTxEvent(chainId, stxTransferEvent, coreTx.txid);
        txSender = stxTransferEvent.stx_transfer_event.sender;
      } else if (stxLockEvent) {
        const stxStacksPox2Event =
          pox2Event?.decodedEvent.name === Pox2EventName.StackStx
            ? pox2Event.decodedEvent
            : undefined;
        rawTx = createTransactionFromCoreBtcStxLockEvent(
          chainId,
          stxLockEvent,
          blockData.burn_block_height,
          coreTx.raw_result,
          coreTx.txid,
          stxStacksPox2Event
        );
        txSender = stxLockEvent.stx_lock_event.locked_address;
      } else if (pox2Event && pox2Event.decodedEvent.name === Pox2EventName.DelegateStx) {
        rawTx = createTransactionFromCoreBtcDelegateStxEvent(
          chainId,
          pox2Event.contractEvent,
          pox2Event.decodedEvent,
          coreTx.raw_result,
          coreTx.txid
        );
        txSender = pox2Event.decodedEvent.stacker;
      } else {
        logError(
          `BTC transaction found, but no STX transfer event available to recreate transaction. TX: ${JSON.stringify(
            coreTx
          )}`
        );
        throw new Error('Unable to generate transaction from BTC tx');
      }
    } else {
      rawTx = decodeTransaction(coreTx.raw_tx.substring(2));
      txSender = getTxSenderAddress(rawTx);
      sponsorAddress = getTxSponsorAddress(rawTx);
    }
    const parsedTx: CoreNodeParsedTxMessage = {
      core_tx: coreTx,
      nonce: Number(rawTx.auth.origin_condition.nonce),
      raw_tx: coreTx.raw_tx,
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
    switch (payload.type_id) {
      case TxPayloadTypeID.Coinbase: {
        break;
      }
      case TxPayloadTypeID.CoinbaseToAltRecipient: {
        if (payload.recipient.type_id === PrincipalTypeID.Standard) {
          logger.verbose(
            `Coinbase to alt recipient, standard principal: ${payload.recipient.address}`
          );
        } else {
          logger.verbose(
            `Coinbase to alt recipient, contract principal: ${payload.recipient.address}.${payload.recipient.contract_name}`
          );
        }
        break;
      }
      case TxPayloadTypeID.SmartContract: {
        logger.verbose(
          `Smart contract deployed: ${parsedTx.sender_address}.${payload.contract_name}`
        );
        break;
      }
      case TxPayloadTypeID.ContractCall: {
        logger.verbose(
          `Contract call: ${payload.address}.${payload.contract_name}.${payload.function_name}`
        );
        break;
      }
      case TxPayloadTypeID.TokenTransfer: {
        let recipientPrincipal = payload.recipient.address;
        if (payload.recipient.type_id === PrincipalTypeID.Contract) {
          recipientPrincipal += '.' + payload.recipient.contract_name;
        }
        logger.verbose(
          `Token transfer: ${payload.amount} from ${parsedTx.sender_address} to ${recipientPrincipal}`
        );
        break;
      }
      case TxPayloadTypeID.PoisonMicroblock: {
        logger.verbose(
          `Poison microblock: header1 ${payload.microblock_header_1}), header2: ${payload.microblock_header_2}`
        );
        break;
      }
      case TxPayloadTypeID.VersionedSmartContract: {
        logger.verbose(
          `Versioned smart contract deployed: Clarity version ${payload.clarity_version}, ${parsedTx.sender_address}.${payload.contract_name}`
        );
        break;
      }
      default: {
        throw new NotImplementedError(
          `extracting data for tx type: ${getEnumDescription(
            TxPayloadTypeID,
            rawTx.payload.type_id
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
