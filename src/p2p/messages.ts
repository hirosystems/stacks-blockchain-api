import { Block } from './block';
import { Transaction } from './tx';
import { BufferReader } from '@stacks/transactions';

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
