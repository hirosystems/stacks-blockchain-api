import { BinaryReader } from "./binaryReader";
import { readBlocks, Block, StacksMessageBlocks } from "./blockReader";

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
  Reserved = 255
}

type StacksMessage = StacksMessageBlocks;

export async function* readMessages(stream: BinaryReader): AsyncGenerator<StacksMessage> {
  while (!stream.stream.destroyed) {
    const messageTypeId: StacksMessageTypeID = await stream.readUInt8();
    if (messageTypeId === StacksMessageTypeID.Blocks) {
      const blocks = await readBlocks(stream);
      const msg: StacksMessageBlocks = {
        messageTypeId: StacksMessageTypeID.Blocks,
        blocks: blocks,
      };
      yield msg;
    } else {
      throw new Error(`Not implemented - StacksMessageID ${messageTypeId}`);
    }
  }
}
