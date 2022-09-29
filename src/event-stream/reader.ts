import {
  CoreNodeBlockMessage,
  CoreNodeEvent,
  CoreNodeEventType,
  CoreNodeMicroblockTxMessage,
  CoreNodeParsedTxMessage,
  CoreNodeTxMessage,
  isTxWithMicroblockInfo,
  NftMintEvent,
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
import { DbMicroblockPartial } from '../datastore/common';
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
  stringAsciiCV,
  hexToCV,
} from '@stacks/transactions';
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
  txId: string
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

  const legacyClarityVals = [
    uintCV(lockAmount.value),
    tupleCV({
      hashbytes: bufferCV(hexToBuffer(stacker.address_hash_bytes)),
      version: bufferCV(Buffer.from([stacker.address_version])),
    }),
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
      contract_name: 'pox',
      function_name: 'stack-stx',
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

function createSubnetTransactionFromL1NftDeposit(
  chainId: ChainID,
  event: NftMintEvent,
  txId: string
): DecodedTxResult {
  const decRecipientAddress = decodeStacksAddress(event.nft_mint_event.recipient);
  const tokenName = event.nft_mint_event.asset_identifier.split('::')[1];
  const [contractAddress, contractName] = event.nft_mint_event.asset_identifier
    .split('::')[0]
    .split('.');
  const decContractAddress = decodeStacksAddress(contractAddress);
  const legacyClarityVals = [
    stringAsciiCV(tokenName),
    hexToCV(event.nft_mint_event.raw_value),
    principalCV(event.nft_mint_event.recipient),
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
          address_version: decRecipientAddress[0],
          address_hash_bytes: decRecipientAddress[1],
          address: event.nft_mint_event.recipient,
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
      address_version: decContractAddress[0],
      address_hash_bytes: decContractAddress[1],
      address: contractAddress,
      contract_name: contractName,
      function_name: 'nft-mint?',
      function_args: clarityFnArgs,
      function_args_buffer: rawFnArgs,
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
      const event = allEvents.find(event => event.txid === coreTx.txid);
      if (!event) {
        logger.warn(`Could not find event for process BTC tx: ${JSON.stringify(coreTx)}`);
        return null;
      }
      switch (event.type) {
        case CoreNodeEventType.StxTransferEvent:
          rawTx = createTransactionFromCoreBtcTxEvent(chainId, event, coreTx.txid);
          txSender = event.stx_transfer_event.sender;
          break;

        case CoreNodeEventType.StxLockEvent:
          rawTx = createTransactionFromCoreBtcStxLockEvent(
            chainId,
            event,
            blockData.burn_block_height,
            coreTx.raw_result,
            coreTx.txid
          );
          txSender = event.stx_lock_event.locked_address;
          break;

        case CoreNodeEventType.NftMintEvent:
          rawTx = createSubnetTransactionFromL1NftDeposit(chainId, event, coreTx.txid);
          txSender = event.nft_mint_event.recipient;
          break;

        default:
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
