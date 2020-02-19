import { BinaryReader } from './binaryReader';
import { readBlocks, Block } from './blockReader';
import { Transaction, readTransaction } from './txReader';
import { StacksMessageParsingError, NotImplementedError } from './errors';
import { getEnumDescription } from './helpers';

export enum StacksMessageTypeID {
  Handshake = 0,
  HandshakeAccept = 1,
  HandshakeReject = 2,
  GetNeighbors = 3,
  Neighbors = 4,
  GetBlocksInv = 5,
  BlocksInv = 6,
  GetBlocks = 7,
  Blocks = 8,
  GetMicroblocks = 9,
  Microblocks = 10,
  Transaction = 11,
  Nack = 12,
  Ping = 13,
  Pong = 14,
  Reserved = 255,
}

export interface StacksMessageBlocks {
  messageTypeId: StacksMessageTypeID.Blocks;
  blocks: Block[];
}

export function isStacksMessageBlocks(msg: StacksMessage): msg is StacksMessageBlocks {
  return msg.messageTypeId === StacksMessageTypeID.Blocks;
}

export interface StacksMessageTransaction {
  messageTypeId: StacksMessageTypeID.Transaction;
  transaction: Transaction;
}

export function isStacksMessageTransaction(msg: StacksMessage): msg is StacksMessageTransaction {
  return msg.messageTypeId === StacksMessageTypeID.Transaction;
}

type StacksMessage = StacksMessageBlocks | StacksMessageTransaction;

export async function* readMessages(stream: BinaryReader): AsyncGenerator<StacksMessage> {
  while (!stream.readableStream.destroyed) {
    const messageTypeId = await stream.readUInt8Enum(StacksMessageTypeID, n => {
      throw new StacksMessageParsingError(`unexpected Stacks message type ID ${n}`);
    });
    if (messageTypeId === StacksMessageTypeID.Blocks) {
      const blocks = await readBlocks(stream);
      const msg: StacksMessageBlocks = {
        messageTypeId: StacksMessageTypeID.Blocks,
        blocks: blocks,
      };
      yield msg;
    } else if (messageTypeId === StacksMessageTypeID.Transaction) {
      const tx = await readTransaction(stream);
      const msg: StacksMessageTransaction = {
        messageTypeId: StacksMessageTypeID.Transaction,
        transaction: tx,
      };
      yield msg;
    } else {
      throw new NotImplementedError(`stacks message type: ${getEnumDescription(StacksMessageTypeID, messageTypeId)}`);
    }
  }
}
