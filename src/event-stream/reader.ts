import {
  CoreNodeBlockMessage,
  CoreNodeEventType,
  CoreNodeMessageParsed,
  CoreNodeParsedTxMessage,
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
import { NotImplementedError } from '../errors';
import { getEnumDescription, logger, logError } from '../helpers';
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
  let sponsorAddress: string | undefined;
  if (tx.auth.typeId === TransactionAuthTypeID.Sponsored) {
    sponsorAddress = getAddressFromPublicKeyHash(
      tx.auth.sponsorCondition.signer,
      tx.auth.sponsorCondition.hashMode as number,
      tx.version
    );
  }
  return sponsorAddress;
}

export function getAddressFromPublicKeyHash(
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

export function createTransactionFromCoreBtcStxLockEvent(
  chainId: ChainID,
  event: StxLockEvent,
  burnBlockHeight: number,
  txResult: string
): Transaction {
  const resultCv = deserializeCV(Buffer.from(txResult.substr(2), 'hex')) as ResponseOkCV;
  const resultTuple = resultCv.value as TupleCV;
  const lockAmount = resultTuple.data['lock-amount'] as UIntCV;
  const stacker = resultTuple.data['stacker'] as StandardPrincipalCV;
  const unlockBurnHeight = (resultTuple.data['unlock-burn-height'] as UIntCV).value.toNumber();

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

export function createTransactionFromCoreBtcTxEvent(
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

export function parseMessageTransactions(
  chainId: ChainID,
  msg: CoreNodeBlockMessage
): CoreNodeMessageParsed {
  const parsedMessage: CoreNodeMessageParsed = {
    ...msg,
    parsed_transactions: new Array(msg.transactions.length),
  };
  for (let i = 0; i < msg.transactions.length; i++) {
    const coreTx = msg.transactions[i];
    try {
      const txBuffer = Buffer.from(coreTx.raw_tx.substring(2), 'hex');
      let rawTx: Transaction;
      let txSender: string;
      let sponsorAddress: string | undefined;
      if (coreTx.raw_tx === '0x00') {
        const event = msg.events.find(event => event.txid === coreTx.txid);
        if (!event) {
          logger.warn(`Could not find txid for process BTC tx: ${JSON.stringify(msg)}`);
          continue;
        }
        if (event.type === CoreNodeEventType.StxTransferEvent) {
          rawTx = createTransactionFromCoreBtcTxEvent(chainId, event);
          txSender = event.stx_transfer_event.sender;
        } else if (event.type === CoreNodeEventType.StxLockEvent) {
          rawTx = createTransactionFromCoreBtcStxLockEvent(
            chainId,
            event,
            msg.burn_block_height,
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
        block_hash: msg.block_hash,
        index_block_hash: msg.index_block_hash,
        block_height: msg.block_height,
        burn_block_time: msg.burn_block_time,
        sender_address: txSender,
        sponsor_address: sponsorAddress,
      };
      parsedMessage.parsed_transactions[i] = parsedTx;
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
          const address = c32address(
            payload.address.version,
            payload.address.bytes.toString('hex')
          );
          logger.verbose(
            `Contract call: ${address}.${payload.contractName}.${payload.functionName}`
          );
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
    } catch (error) {
      logError(`error parsing message transaction ${JSON.stringify(coreTx)}: ${error}`, error);
      throw error;
    }
  }
  return parsedMessage;
}
