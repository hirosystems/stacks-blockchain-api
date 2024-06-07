import {
  BurnchainOpDelegateStx,
  BurnchainOpRegisterAssetFt,
  BurnchainOpRegisterAssetNft,
  BurnchainOpStackStx,
  CoreNodeEvent,
  CoreNodeEventType,
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
  DbPoxSyntheticDelegateStxEvent,
  DbPoxSyntheticStackStxEvent,
} from '../datastore/common';
import { NotImplementedError } from '../errors';
import {
  getEnumDescription,
  I32_MAX,
  SubnetContractIdentifer,
  getChainIDNetwork,
  ChainID,
  BootContractAddress,
} from '../helpers';
import {
  TransactionVersion,
  uintCV,
  bufferCV,
  serializeCV,
  noneCV,
  someCV,
  OptionalCV,
  TupleCV,
  NoneCV,
  UIntCV,
  stringAsciiCV,
  hexToCV,
} from '@stacks/transactions';
import { poxAddressToTuple } from '@stacks/stacking';
import { c32ToB58 } from 'c32check';
import { decodePoxSyntheticPrintEvent } from './pox-event-parsing';
import { PoxContractIdentifiers, SyntheticPoxEventName } from '../pox-helpers';
import { principalCV } from '@stacks/transactions/dist/clarity/types/principalCV';
import { logger } from '../logger';
import { bufferToHex, hexToBuffer } from '@hirosystems/api-toolkit';
import { hexToBytes } from '@stacks/common';

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
  burnchainOp: BurnchainOpRegisterAssetNft | BurnchainOpRegisterAssetFt,
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
  const rawFnArgs = bufferToHex(Buffer.concat([fnLenBuffer, ...serializedClarityValues]));
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
  const rawFnArgs = bufferToHex(Buffer.concat([fnLenBuffer, ...serializedClarityValues]));
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
  const rawFnArgs = bufferToHex(Buffer.concat([fnLenBuffer, ...serializedClarityValues]));
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
  stxStacksPox2Event: DbPoxSyntheticStackStxEvent | undefined
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
  const rawFnArgs = bufferToHex(Buffer.concat([fnLenBuffer, ...serializedClarityValues]));
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

function createTransactionFromCoreBtcStxLockEventPox4(
  chainId: ChainID,
  burnOpData: BurnchainOpStackStx,
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
  const senderAddress = decodeStacksAddress(burnOpData.stack_stx.sender.address);
  const poxAddressString =
    getChainIDNetwork(chainId) === 'mainnet'
      ? BootContractAddress.mainnet
      : BootContractAddress.testnet;
  const poxAddress = decodeStacksAddress(poxAddressString);
  const contractName = 'pox-4';

  const legacyClarityVals = [
    uintCV(burnOpData.stack_stx.stacked_ustx), // (amount-ustx uint)
    poxAddressToTuple(burnOpData.stack_stx.reward_addr), // (pox-addr (tuple (version (buff 1)) (hashbytes (buff 32))))
    uintCV(burnOpData.stack_stx.burn_block_height), // (start-burn-ht uint)
    uintCV(burnOpData.stack_stx.num_cycles), // (lock-period uint)
    noneCV(), // (signer-sig (optional (buff 65)))
    bufferCV(hexToBytes(burnOpData.stack_stx.signer_key)), // (signer-key (buff 33))
    uintCV(burnOpData.stack_stx.max_amount), // (max-amount uint)
    uintCV(burnOpData.stack_stx.auth_id), // (auth-id uint)
  ];
  const fnLenBuffer = Buffer.alloc(4);
  fnLenBuffer.writeUInt32BE(legacyClarityVals.length);
  const serializedClarityValues = legacyClarityVals.map(c => serializeCV(c));
  const rawFnArgs = bufferToHex(Buffer.concat([fnLenBuffer, ...serializedClarityValues]));
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
          address: burnOpData.stack_stx.sender.address,
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

function createTransactionFromCoreBtcDelegateStxEventPox4(
  chainId: ChainID,
  contractEvent: SmartContractEvent,
  decodedEvent: DbPoxSyntheticDelegateStxEvent,
  burnOpData: BurnchainOpDelegateStx,
  txResult: string,
  txId: string
): DecodedTxResult {
  const resultCv = decodeClarityValue<ClarityValueResponse>(txResult);
  if (resultCv.type_id !== ClarityTypeID.ResponseOk) {
    throw new Error(`Unexpected tx result Clarity type ID: ${resultCv.type_id}`);
  }
  const senderAddress = decodeStacksAddress(burnOpData.delegate_stx.sender.address);
  const poxContractAddressString =
    getChainIDNetwork(chainId) === 'mainnet'
      ? BootContractAddress.mainnet
      : BootContractAddress.testnet;
  const poxContractAddress = decodeStacksAddress(poxContractAddressString);
  const contractName = contractEvent.contract_event.contract_identifier?.split('.')?.[1] ?? 'pox';

  const legacyClarityVals = [
    uintCV(burnOpData.delegate_stx.delegated_ustx), // amount-ustx
    principalCV(burnOpData.delegate_stx.delegate_to.address), // delegate-to
    someCV(uintCV(burnOpData.delegate_stx.until_burn_height)), // until-burn-ht
    someCV(poxAddressToTuple(burnOpData.delegate_stx.reward_addr[1])), // pox-addr
  ];
  const fnLenBuffer = Buffer.alloc(4);
  fnLenBuffer.writeUInt32BE(legacyClarityVals.length);
  const serializedClarityValues = legacyClarityVals.map(c => serializeCV(c));
  const rawFnArgs = bufferToHex(Buffer.concat([fnLenBuffer, ...serializedClarityValues]));
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
  decodedEvent: DbPoxSyntheticDelegateStxEvent,
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
      ? BootContractAddress.mainnet
      : BootContractAddress.testnet;
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
  const rawFnArgs = bufferToHex(Buffer.concat([fnLenBuffer, ...serializedClarityValues]));
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
  block_time: number;
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

      // pox-2, pox-3, and pox-4 compatible events
      const poxEvent = events
        .filter(
          (e): e is SmartContractEvent =>
            e.type === CoreNodeEventType.ContractEvent && isPoxPrintEvent(e)
        )
        .map(e => {
          const network = getChainIDNetwork(chainId);
          const decodedEvent = decodePoxSyntheticPrintEvent(e.contract_event.raw_value, network);
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
      } else if (
        coreTx.burnchain_op &&
        'stack_stx' in coreTx.burnchain_op &&
        coreTx.burnchain_op.stack_stx.signer_key
      ) {
        // This is a pox-4 stack-stx burnchain op
        const burnOpData = coreTx.burnchain_op.stack_stx;
        rawTx = createTransactionFromCoreBtcStxLockEventPox4(
          chainId,
          coreTx.burnchain_op,
          coreTx.raw_result,
          coreTx.txid
        );
        txSender = burnOpData.sender.address;
      } else if (stxLockEvent) {
        const stxStacksPoxEvent =
          poxEvent?.decodedEvent.name === SyntheticPoxEventName.StackStx
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
      } else if (
        poxEvent &&
        poxEvent.decodedEvent.name === SyntheticPoxEventName.DelegateStx &&
        poxEvent.contractEvent.contract_event.contract_identifier?.split('.')?.[1] === 'pox-4' &&
        coreTx.burnchain_op &&
        'delegate_stx' in coreTx.burnchain_op
      ) {
        rawTx = createTransactionFromCoreBtcDelegateStxEventPox4(
          chainId,
          poxEvent.contractEvent,
          poxEvent.decodedEvent,
          coreTx.burnchain_op,
          coreTx.raw_result,
          coreTx.txid
        );
        txSender = coreTx.burnchain_op.delegate_stx.sender.address;
      } else if (poxEvent && poxEvent.decodedEvent.name === SyntheticPoxEventName.DelegateStx) {
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
        'register_asset' in coreTx.burnchain_op &&
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
      block_time: blockData.block_time,
      index_block_hash: blockData.index_block_hash,
      parent_index_block_hash: blockData.parent_index_block_hash,
      parent_block_hash: blockData.parent_block_hash,
      parent_burn_block_hash: blockData.parent_burn_block_hash,
      parent_burn_block_time: blockData.parent_burn_block_timestamp,
      block_height: blockData.block_height,
      burn_block_height: blockData.burn_block_height,
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
      case TxPayloadTypeID.NakamotoCoinbase: {
        if (payload.recipient?.type_id === PrincipalTypeID.Standard) {
          logger.debug(
            `NakamotoCoinbase to alt recipient, standard principal: ${payload.recipient.address}, vrf=${payload.vrf_proof}`
          );
        } else if (payload.recipient?.type_id === PrincipalTypeID.Contract) {
          logger.debug(
            `NakamotoCoinbase to alt recipient, contract principal: ${payload.recipient.address}.${payload.recipient.contract_name}, vrf=${payload.vrf_proof}`
          );
        } else {
          logger.debug(`NakamotoCoinbase (no alt recipient), vrf=${payload.vrf_proof}`);
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
      case TxPayloadTypeID.TenureChange: {
        logger.debug(
          `Tenure change: cause=${payload.cause}, prev_tenure_blocks=${payload.previous_tenure_blocks}, prev_tenure_block=${payload.previous_tenure_end},`
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
  return PoxContractIdentifiers.includes(event.contract_event.contract_identifier);
}

interface CoreNodeBlockEventCounts {
  microblocks: number;
  tx_total: number;
  txs: {
    token_transfer: number;
    smart_contract: number;
    contract_call: number;
    poison_microblock: number;
    coinbase: number;
    coinbase_to_alt_recipient: number;
    versioned_smart_contract: number;
    tenure_change: number;
    nakamoto_coinbase: number;
  };
  event_total: number;
  events: {
    contract_event: number;
    stx_transfer_event: number;
    stx_mint_event: number;
    stx_burn_event: number;
    stx_lock_event: number;
    nft_transfer_event: number;
    nft_mint_event: number;
    nft_burn_event: number;
    ft_transfer_event: number;
    ft_mint_event: number;
    ft_burn_event: number;
  };
  miner_rewards: number;
}

export function newCoreNoreBlockEventCounts(): CoreNodeBlockEventCounts {
  return {
    microblocks: 0,
    tx_total: 0,
    txs: {
      token_transfer: 0,
      smart_contract: 0,
      contract_call: 0,
      poison_microblock: 0,
      coinbase: 0,
      coinbase_to_alt_recipient: 0,
      versioned_smart_contract: 0,
      tenure_change: 0,
      nakamoto_coinbase: 0,
    },
    event_total: 0,
    events: {
      contract_event: 0,
      stx_transfer_event: 0,
      stx_mint_event: 0,
      stx_burn_event: 0,
      stx_lock_event: 0,
      nft_transfer_event: 0,
      nft_mint_event: 0,
      nft_burn_event: 0,
      ft_transfer_event: 0,
      ft_mint_event: 0,
      ft_burn_event: 0,
    },
    miner_rewards: 0,
  };
}
