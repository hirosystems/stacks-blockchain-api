import { BufferReader } from '@stacks/transactions';

/*
const blockHeaderSize =
  1 + // version number
  16 + // proof score
  80 + // VRF proof
  32 + // parent block hash
  32 + // parent microblock hash
  2 + // parent microblock sequence number
  32 + // transaction merkle root
  32 + // state merkle root
  20; // microblock public key hash
*/

export interface BlockHeader {
  /** Version number to describe how to validate the block. */
  version: number;
  /** How much work has gone into this chain so far. */
  workScore: {
    /** Number of burn tokens destroyed. */
    burn: bigint;
    /** In Stacks, "work" == the length of the fork. */
    work: bigint;
  };
  /** RFC-compliant VRF. Must match the burn commitment transaction on the burn chain (in particular, it must hash to its VRF seed). */
  vrfProof: {
    /** Compressed Ed25519 point. */
    gamma: Buffer;
    /** Ed25519 scalar - unsigned integer */
    c: Buffer;
    /** Ed25519 scalar - unsigned integer */
    s: Buffer;
  };
  /** The SHA512/256 hash of the last anchored block that precedes this block in the fork to which this block is to be appended. */
  parentBlockHash: Buffer;
  /** The SHA512/256 hash of the last streamed block that precedes this block in the fork to which this block is to be appended. */
  parentMicroblockHash: Buffer;
  /** The sequence number of the parent microblock to which this anchored block is attached. */
  parentMicroblockSequence: number;
  /** The SHA512/256 root hash of a binary Merkle tree calculated over the sequence of transactions in this block. */
  txMerkleRootHash: Buffer;
  /** The SHA512/256 root hash of a MARF index over the state of the blockchain. */
  stateMerkleRootHash: Buffer;
  /** The Hash160 of a compressed public key whose private key will be used to sign microblocks during the peer's tenure. */
  microblockPubkeyHash: Buffer;
}

export function readBlockHeader(reader: BufferReader): BlockHeader {
  const header: BlockHeader = {
    version: reader.readUInt8(),
    workScore: {
      burn: reader.readBigUInt64BE(),
      work: reader.readBigUInt64BE(),
    },
    vrfProof: {
      gamma: reader.readBuffer(32),
      c: reader.readBuffer(16),
      s: reader.readBuffer(32),
    },
    parentBlockHash: reader.readBuffer(32),
    parentMicroblockHash: reader.readBuffer(32),
    parentMicroblockSequence: reader.readUInt16BE(),
    txMerkleRootHash: reader.readBuffer(32),
    stateMerkleRootHash: reader.readBuffer(32),
    microblockPubkeyHash: reader.readBuffer(20),
  };
  return header;
}
