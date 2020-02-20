import { BinaryReader, BufferReader } from './binaryReader';
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

export interface Preamble {
  /** u32 - software version */
  peerVersion: number;
  /** u32 - mainnet, testnet, etc */
  networkId: number;
  /** u32 - message sequence number -- pairs this message to a request */
  sequenceNumber: number;
  /** u64 - last-seen block height (at chain tip) */
  burnBlockHeight: bigint;
  /** 20 bytes - consensus hash at block_height */
  burnConsensusHash: Buffer;
  /** u64 - latest stable block height (e.g. chain tip minus 7) */
  burnStableBlockHeight: bigint;
  /** 20 bytes - consensus hash for burn_stable_block_height */
  burnStableConsensusHash: Buffer;
  /** u32 - RESERVED; pointer to additional data (should be all 0's if not used) */
  additionalData: number;
  /** 65 bytes - signature from the peer that sent this */
  signature: Buffer;
  /** u32 - length of the following payload, including relayers vector */
  payloadLength: number;
}

const CONSENSUS_HASH_ENCODED_SIZE = 20;
const MESSAGE_SIGNATURE_ENCODED_SIZE = 65;

export const PREAMBLE_ENCODED_SIZE =
  4 + // peer_version
  4 + // network_id
  4 + // sequence number
  8 + // burn_block_height
  CONSENSUS_HASH_ENCODED_SIZE + // burn_consensus_hash
  8 + // burn_stable_block_height
  CONSENSUS_HASH_ENCODED_SIZE + // burn_stable_consensus_hash
  4 + // additional_data
  MESSAGE_SIGNATURE_ENCODED_SIZE + // signature
  4; // payload_len

async function readPreamble(stream: BinaryReader): Promise<Preamble> {
  const cursor = await stream.readFixed(PREAMBLE_ENCODED_SIZE);
  const preamble: Preamble = {
    peerVersion: cursor.readUInt32BE(),
    networkId: cursor.readUInt32BE(),
    sequenceNumber: cursor.readUInt32BE(),
    burnBlockHeight: cursor.readBigUInt64BE(),
    burnConsensusHash: cursor.readBuffer(CONSENSUS_HASH_ENCODED_SIZE),
    burnStableBlockHeight: cursor.readBigUInt64BE(),
    burnStableConsensusHash: cursor.readBuffer(CONSENSUS_HASH_ENCODED_SIZE),
    additionalData: cursor.readUInt32BE(),
    signature: cursor.readBuffer(MESSAGE_SIGNATURE_ENCODED_SIZE),
    payloadLength: cursor.readUInt32BE(),
  };
  return preamble;
}

const RELAY_DATA_ENCODED_SIZE = 107;
function readRelayers(reader: BufferReader): Buffer {
  const length = reader.readUInt32BE();
  let relayersData: Buffer;
  if (length === 0) {
    relayersData = Buffer.alloc(0);
  } else {
    relayersData = reader.readBuffer(length * RELAY_DATA_ENCODED_SIZE);
  }
  return relayersData;
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
    const preamble = await readPreamble(stream);
    const reader = await stream.readFixed(preamble.payloadLength);
    // ignore relayer data
    readRelayers(reader);
    const messageTypeId = reader.readUInt8Enum(StacksMessageTypeID, n => {
      throw new StacksMessageParsingError(`unexpected Stacks message type ID ${n}`);
    });
    if (messageTypeId === StacksMessageTypeID.Blocks) {
      const blocks = readBlocks(reader);
      const msg: StacksMessageBlocks = {
        messageTypeId: StacksMessageTypeID.Blocks,
        blocks: blocks,
      };
      yield msg;
    } else if (messageTypeId === StacksMessageTypeID.Transaction) {
      const tx = readTransaction(reader);
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
