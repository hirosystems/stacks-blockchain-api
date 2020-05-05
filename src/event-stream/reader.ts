import { Readable } from 'stream';
import {
  CoreNodeMessage,
  CoreNodeMessageParsed,
  CoreNodeParsedTxMessage,
} from './core-node-message';
import { readTransaction, TransactionPayloadTypeID, RecipientPrincipalTypeId } from '../p2p/tx';
import { BufferReader } from '../binary-reader';
import { NotImplementedError } from '../errors';
import { getEnumDescription } from '../helpers';
import { addressFromHashMode, addressToString } from '@blockstack/stacks-transactions';
import { c32address } from 'c32check';

export function parseMessageTransactions(msg: CoreNodeMessage): CoreNodeMessageParsed {
  const parsedMessage: CoreNodeMessageParsed = {
    ...msg,
    parsed_transactions: new Array(msg.transactions.length),
  };
  for (let i = 0; i < msg.transactions.length; i++) {
    const coreTx = msg.transactions[i];
    try {
      const txBuffer = Buffer.from(coreTx.raw_tx.substring(2), 'hex');
      const bufferReader = BufferReader.fromBuffer(txBuffer);
      const rawTx = readTransaction(bufferReader);
      const txSender = addressToString(
        addressFromHashMode(
          rawTx.auth.originCondition.hashMode as number,
          rawTx.version as number,
          rawTx.auth.originCondition.signer.toString('hex')
        )
      );
      const parsedTx: CoreNodeParsedTxMessage = {
        core_tx: coreTx,
        raw_tx: rawTx,
        block_hash: msg.block_hash,
        block_height: msg.block_height,
        burn_block_time: msg.burn_block_time,
        sender_address: txSender,
      };
      parsedMessage.parsed_transactions[i] = parsedTx;
      const payload = rawTx.payload;
      switch (payload.typeId) {
        case TransactionPayloadTypeID.Coinbase: {
          break;
        }
        case TransactionPayloadTypeID.SmartContract: {
          console.log(`Smart contract deployed: ${parsedTx.sender_address}.${payload.name}`);
          break;
        }
        case TransactionPayloadTypeID.ContractCall: {
          const address = c32address(
            payload.address.version,
            payload.address.bytes.toString('hex')
          );
          console.log(`Contract call: ${address}.${payload.contractName}.${payload.functionName}`);
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
          console.log(
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
      console.error(`error parsing message transaction ${coreTx}: ${error}`);
      console.error(error);
      throw error;
    }
  }
  return parsedMessage;
}
