import {
  CoreNodeBlockMessage,
  CoreNodeMessageParsed,
  CoreNodeParsedTxMessage,
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
  createSingleSigSpendingCondition,
  createAddress,
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

export function parseMessageTransactions(msg: CoreNodeBlockMessage): CoreNodeMessageParsed {
  const parsedMessage: CoreNodeMessageParsed = {
    ...msg,
    parsed_transactions: new Array(msg.transactions.length),
  };
  for (let i = 0; i < msg.transactions.length; i++) {
    const coreTx = msg.transactions[i];
    try {
      const txBuffer = Buffer.from(coreTx.raw_tx.substring(2), 'hex');
      const bufferReader = BufferReader.fromBuffer(txBuffer);
      let txSender: string;
      let sponsorAddress = undefined;
      let rawTx: Transaction;
      try {
        rawTx = readTransaction(bufferReader);
        txSender = getTxSenderAddress(rawTx);
        sponsorAddress = getTxSponsorAddress(rawTx);
      } catch (error) {
        logError(
          `BTC transaction found. Recreating from event. TX: ${JSON.stringify(coreTx)}: ${error}`,
          error
        );
        const event = msg.events[i] as StxTransferEvent;
        txSender = event.stx_transfer_event.sender;
        const recipientAddress = createAddress(event.stx_transfer_event.recipient);
        rawTx = {
          version: TransactionVersion.Mainnet,
          chainId: ChainID.Mainnet,
          auth: {
            typeId: TransactionAuthTypeID.Standard,
            originCondition: {
              hashMode: SigHashMode.P2PKH,
              signer: Buffer.alloc(0),
              nonce: BigInt(0),
              feeRate: BigInt(0),
              keyEncoding: TransactionPublicKeyEncoding.Compressed,
              signature: Buffer.alloc(0),
            },
          },
          anchorMode: TransactionAnchorMode.Any,
          postConditionMode: TransactionPostConditionMode.Allow,
          postConditions: [],
          rawPostConditions: Buffer.from([TransactionPostConditionMode.Allow]),
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
      }
      const parsedTx: CoreNodeParsedTxMessage = {
        core_tx: coreTx,
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
