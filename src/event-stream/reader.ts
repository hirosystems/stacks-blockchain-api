import {
  BurnchainOp,
  CoreNodeBlockMessage,
  CoreNodeEvent,
  CoreNodeEventType,
  CoreNodeMicroblockTxMessage,
  CoreNodeParsedTxMessage,
  CoreNodeTxMessage,
  FtMintEvent,
  isTxWithMicroblockInfo,
  NftMintEvent,
  SmartContractEvent,
  StxLockEvent,
  StxMintEvent,
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
  ClarityValueBuffer,
} from 'stacks-encoding-native-js';
import {
  DbMicroblockPartial,
  DbPox2DelegateStxEvent,
  DbPox2StackStxEvent,
} from '../datastore/common';
import { NotImplementedError } from '../errors';
import {
  getEnumDescription,
  I32_MAX,
  bufferToHexPrefixString,
  hexToBuffer,
  SubnetContractIdentifer,
  getChainIDNetwork,
  ChainID,
  BootContractAddress,
} from '../helpers';
import {
  TransactionVersion,
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
  stringAsciiCV,
  hexToCV,
} from '@stacks/transactions';
import { poxAddressToTuple } from '@stacks/stacking';
import { c32ToB58 } from 'c32check';
import { decodePox2PrintEvent } from './pox2-event-parsing';
import { Pox2ContractIdentifer, Pox2EventName } from '../pox-helpers';
import { principalCV } from '@stacks/transactions/dist/clarity/types/principalCV';
import { logger } from '../logger';

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

function createSubnetTransactionFromL1RegisterAsset(
  chainId: ChainID,
  burnchainOp: BurnchainOp,
  subnetEvent: SmartContractEvent,
  txId: string
): DecodedTxResult {
  if (
    burnchainOp.register_asset.asset_type !== 'ft' &&
    burnchainOp.register_asset.asset_type !== 'nft'
  ) {
    throw new Error(
      `Unexpected L1 register asset type: ${JSON.stringify(burnchainOp.register_asset)}`
    );
  }

  const [contractAddress, contractName] = subnetEvent.contract_event.contract_identifier
    .split('::')[0]
    .split('.');
  const decContractAddress = decodeStacksAddress(contractAddress);

  const decodedLogEvent = decodeClarityValue<
    ClarityValueTuple<{
      'burnchain-txid': ClarityValueBuffer;
    }>
  >(subnetEvent.contract_event.raw_value);

  // (define-public (register-asset-contract
  //   (asset-type (string-ascii 3))
  //   (l1-contract principal)
  //   (l2-contract principal)
  //   (burnchain-txid (buff 32))
  const fnName = 'register-asset-contract';
  const legacyClarityVals = [
    stringAsciiCV(burnchainOp.register_asset.asset_type),
    principalCV(burnchainOp.register_asset.l1_contract_id),
    principalCV(burnchainOp.register_asset.l2_contract_id),
    bufferCV(hexToBuffer(decodedLogEvent.data['burnchain-txid'].buffer)),
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
    version:
      getChainIDNetwork(chainId) === 'mainnet'
        ? TransactionVersion.Mainnet
        : TransactionVersion.Testnet,
    chain_id: chainId,
    auth: {
      type_id: PostConditionAuthFlag.Standard,
      origin_condition: {
        hash_mode: TxSpendingConditionSingleSigHashMode.P2PKH,
        signer: {
          address_version: decContractAddress[0],
          address_hash_bytes: decContractAddress[1],
          address: contractAddress,
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
      function_name: fnName,
      function_args: clarityFnArgs,
      function_args_buffer: rawFnArgs,
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
  const [contractAddress, contractName] = event.nft_mint_event.asset_identifier
    .split('::')[0]
    .split('.');
  const decContractAddress = decodeStacksAddress(contractAddress);
  const legacyClarityVals = [
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
    version:
      getChainIDNetwork(chainId) === 'mainnet'
        ? TransactionVersion.Mainnet
        : TransactionVersion.Testnet,
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
      function_name: 'deposit-from-burnchain',
      function_args: clarityFnArgs,
      function_args_buffer: rawFnArgs,
    },
  };
  return tx;
}

function createSubnetTransactionFromL1FtDeposit(
  chainId: ChainID,
  event: FtMintEvent,
  txId: string
): DecodedTxResult {
  const decRecipientAddress = decodeStacksAddress(event.ft_mint_event.recipient);
  const [contractAddress, contractName] = event.ft_mint_event.asset_identifier
    .split('::')[0]
    .split('.');
  const decContractAddress = decodeStacksAddress(contractAddress);
  const legacyClarityVals = [
    uintCV(event.ft_mint_event.amount),
    principalCV(event.ft_mint_event.recipient),
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
    version:
      getChainIDNetwork(chainId) === 'mainnet'
        ? TransactionVersion.Mainnet
        : TransactionVersion.Testnet,
    chain_id: chainId,
    auth: {
      type_id: PostConditionAuthFlag.Standard,
      origin_condition: {
        hash_mode: TxSpendingConditionSingleSigHashMode.P2PKH,
        signer: {
          address_version: decRecipientAddress[0],
          address_hash_bytes: decRecipientAddress[1],
          address: event.ft_mint_event.recipient,
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
      function_name: 'deposit-from-burnchain',
      function_args: clarityFnArgs,
      function_args_buffer: rawFnArgs,
    },
  };
  return tx;
}

function createSubnetTransactionFromL1StxDeposit(
  chainId: ChainID,
  event: StxMintEvent,
  txId: string
): DecodedTxResult {
  const recipientAddress = decodeStacksAddress(event.stx_mint_event.recipient);
  const bootAddressString =
    getChainIDNetwork(chainId) === 'mainnet'
      ? 'SP000000000000000000002Q6VF78'
      : 'ST000000000000000000002AMW42H';
  const bootAddress = decodeStacksAddress(bootAddressString);

  const tx: DecodedTxResult = {
    tx_id: txId,
    version:
      getChainIDNetwork(chainId) === 'mainnet'
        ? TransactionVersion.Mainnet
        : TransactionVersion.Testnet,
    chain_id: chainId,
    auth: {
      type_id: PostConditionAuthFlag.Standard,
      origin_condition: {
        hash_mode: TxSpendingConditionSingleSigHashMode.P2PKH,
        signer: {
          address_version: bootAddress[0],
          address_hash_bytes: bootAddress[1],
          address: bootAddressString,
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
        address: event.stx_mint_event.recipient,
      },
      amount: BigInt(event.stx_mint_event.amount).toString(),
      memo_hex: '0x',
    },
  };
  return tx;
}

function createTransactionFromCoreBtcStxLockEvent(
  chainId: ChainID,
  event: StxLockEvent,
  burnBlockHeight: number,
  txResult: string,
  txId: string,
  /** also pox-3 compatible */
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
  const rewardCycleLength = getChainIDNetwork(chainId) === 'mainnet' ? 2100 : 50;
  const lockPeriod = Math.floor((unlockBurnHeight - burnBlockHeight) / rewardCycleLength);
  const senderAddress = decodeStacksAddress(event.stx_lock_event.locked_address);
  const poxAddressString =
    getChainIDNetwork(chainId) === 'mainnet'
      ? BootContractAddress.mainnet
      : BootContractAddress.testnet;
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
    version:
      getChainIDNetwork(chainId) === 'mainnet'
        ? TransactionVersion.Mainnet
        : TransactionVersion.Testnet,
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
    getChainIDNetwork(chainId) === 'mainnet'
      ? 'SP000000000000000000002Q6VF78'
      : 'ST000000000000000000002AMW42H';
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
    version:
      getChainIDNetwork(chainId) === 'mainnet'
        ? TransactionVersion.Mainnet
        : TransactionVersion.Testnet,
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
    version:
      getChainIDNetwork(chainId) === 'mainnet'
        ? TransactionVersion.Mainnet
        : TransactionVersion.Testnet,
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
      const nftMintEvent = events.find(
        (e): e is NftMintEvent => e.type === CoreNodeEventType.NftMintEvent
      );
      const ftMintEvent = events.find(
        (e): e is FtMintEvent => e.type === CoreNodeEventType.FtMintEvent
      );
      const stxMintEvent = events.find(
        (e): e is StxMintEvent => e.type === CoreNodeEventType.StxMintEvent
      );

      // pox-2 and pox-3 compatible events
      const poxEvent = events
        .filter(
          (e): e is SmartContractEvent =>
            e.type === CoreNodeEventType.ContractEvent && isPoxPrintEvent(e)
        )
        .map(e => {
          const network = getChainIDNetwork(chainId);
          const decodedEvent = decodePox2PrintEvent(e.contract_event.raw_value, network);
          if (decodedEvent) {
            return {
              contractEvent: e,
              decodedEvent,
            };
          }
        })
        .find(e => !!e);

      const subnetEvents = events.filter(
        (e): e is SmartContractEvent =>
          e.type === CoreNodeEventType.ContractEvent &&
          e.contract_event.topic === 'print' &&
          (e.contract_event.contract_identifier === SubnetContractIdentifer.mainnet ||
            e.contract_event.contract_identifier === SubnetContractIdentifer.testnet)
      );

      if (stxTransferEvent) {
        rawTx = createTransactionFromCoreBtcTxEvent(chainId, stxTransferEvent, coreTx.txid);
        txSender = stxTransferEvent.stx_transfer_event.sender;
      } else if (stxLockEvent) {
        const stxStacksPoxEvent =
          poxEvent?.decodedEvent.name === Pox2EventName.StackStx
            ? poxEvent.decodedEvent
            : undefined;
        rawTx = createTransactionFromCoreBtcStxLockEvent(
          chainId,
          stxLockEvent,
          blockData.burn_block_height,
          coreTx.raw_result,
          coreTx.txid,
          stxStacksPoxEvent
        );
        txSender = stxLockEvent.stx_lock_event.locked_address;
      } else if (poxEvent && poxEvent.decodedEvent.name === Pox2EventName.DelegateStx) {
        rawTx = createTransactionFromCoreBtcDelegateStxEvent(
          chainId,
          poxEvent.contractEvent,
          poxEvent.decodedEvent,
          coreTx.raw_result,
          coreTx.txid
        );
        txSender = poxEvent.decodedEvent.stacker;
      } else if (nftMintEvent) {
        rawTx = createSubnetTransactionFromL1NftDeposit(chainId, nftMintEvent, coreTx.txid);
        txSender = nftMintEvent.nft_mint_event.recipient;
      } else if (ftMintEvent) {
        rawTx = createSubnetTransactionFromL1FtDeposit(chainId, ftMintEvent, coreTx.txid);
        txSender = ftMintEvent.ft_mint_event.recipient;
      } else if (stxMintEvent) {
        rawTx = createSubnetTransactionFromL1StxDeposit(chainId, stxMintEvent, coreTx.txid);
        txSender = getTxSenderAddress(rawTx);
      } else if (
        subnetEvents.length > 0 &&
        coreTx.burnchain_op &&
        coreTx.burnchain_op.register_asset
      ) {
        rawTx = createSubnetTransactionFromL1RegisterAsset(
          chainId,
          coreTx.burnchain_op,
          subnetEvents[0],
          coreTx.txid
        );
        txSender = getTxSenderAddress(rawTx);
      } else {
        logger.error(
          `BTC transaction found, but no STX transfer event available to recreate transaction. TX: ${JSON.stringify(
            coreTx
          )}, event: ${JSON.stringify(events)}`
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
          logger.debug(
            `Coinbase to alt recipient, standard principal: ${payload.recipient.address}`
          );
        } else {
          logger.debug(
            `Coinbase to alt recipient, contract principal: ${payload.recipient.address}.${payload.recipient.contract_name}`
          );
        }
        break;
      }
      case TxPayloadTypeID.SmartContract: {
        logger.debug(
          `Smart contract deployed: ${parsedTx.sender_address}.${payload.contract_name}`
        );
        break;
      }
      case TxPayloadTypeID.ContractCall: {
        logger.debug(
          `Contract call: ${payload.address}.${payload.contract_name}.${payload.function_name}`
        );
        break;
      }
      case TxPayloadTypeID.TokenTransfer: {
        let recipientPrincipal = payload.recipient.address;
        if (payload.recipient.type_id === PrincipalTypeID.Contract) {
          recipientPrincipal += '.' + payload.recipient.contract_name;
        }
        logger.debug(
          `Token transfer: ${payload.amount} from ${parsedTx.sender_address} to ${recipientPrincipal}`
        );
        break;
      }
      case TxPayloadTypeID.PoisonMicroblock: {
        logger.debug(
          `Poison microblock: header1 ${payload.microblock_header_1}), header2: ${payload.microblock_header_2}`
        );
        break;
      }
      case TxPayloadTypeID.VersionedSmartContract: {
        logger.debug(
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
    logger.error(error, `error parsing message transaction ${JSON.stringify(coreTx)}`);
    throw error;
  }
}

export function isPoxPrintEvent(event: SmartContractEvent): boolean {
  if (event.contract_event.topic !== 'print') return false;

  const [address, name] = event.contract_event.contract_identifier.split('.');
  return (
    (address == BootContractAddress.mainnet || address == BootContractAddress.testnet) &&
    name.startsWith('pox')
  );
}
