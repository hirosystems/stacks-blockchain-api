import { Readable } from 'stream';
import { BufferReader, readUInt32BE, readByte, readBuffer } from './binaryReader';

const enum SingleSigHashMode {
  P2PKH = 0x00,
  P2WPKH = 0x02,
}

const enum MultiSigHashMode {
  P2SH = 0x01,
  P2WSH = 0x03,
}

const enum TransactionPublicKeyEncoding {
  Compressed = 0x00,
  Uncompressed = 0x01,
}

interface TransactionSpendingConditionSingleSig {
  hashMode: SingleSigHashMode; // u8
  signer: Buffer; // 20 bytes, HASH160
  nonce: bigint; // u64
  feeRate: bigint; // u64
  keyEncoding: TransactionPublicKeyEncoding; // u8
  signature: Buffer; // 65 bytes
}

const enum TransactionAuthFieldID {
  PublicKeyCompressed = 0x00,
  PublicKeyUncompressed = 0x01,
  SignatureCompressed = 0x02,
  SignatureUncompressed = 0x03,
}

interface TransactionAuthFieldPublicKey {
  typeId: TransactionAuthFieldID.PublicKeyCompressed | TransactionAuthFieldID.PublicKeyUncompressed; // u8
  publicKey: Buffer; // 33 bytes
}

interface TransactionAuthFieldSignature {
  typeId: TransactionAuthFieldID.SignatureCompressed | TransactionAuthFieldID.SignatureUncompressed; // u8
  signature: Buffer; // 65 bytes
}

type TransactionAuthField = TransactionAuthFieldPublicKey | TransactionAuthFieldSignature;

interface TransactionSpendingConditionMultiSig {
  hashMode: MultiSigHashMode; // u8
  signer: Buffer; // 20 bytes, HASH160
  nonce: bigint; // u64
  feeRate: bigint; // u64
  authFields: TransactionAuthField[];
}

const enum TransactionAuthType {
  Standard = 0x04,
  Sponsored = 0x05
}

type TransactionSpendingCondition = TransactionSpendingConditionSingleSig | TransactionSpendingConditionMultiSig;

interface TransactionAuthStandard {
  typeId: TransactionAuthType.Standard; // u8
  originCondition: TransactionSpendingCondition;
}

interface TransactionAuthSponsored {
  typeId: TransactionAuthType.Sponsored; // u8
  originCondition: TransactionSpendingCondition;
  sponsorCondition: TransactionSpendingCondition;
}

const enum TransactionPostConditionMode {
  Allow = 0x01,
  Deny = 0x02
}

const enum TransactionVersion {
  Mainnet = 0x00,
  Testnet = 0x80,
}

const enum AssetInfoID {
  STX = 0,
  FungibleAsset = 1,
  NonfungibleAsset = 2,
}

const enum PostConditionPrincipalID {
  Origin = 0x01,
  Standard = 0x02,
  Contract = 0x03,
}

interface PostConditionPrincipalOrigin {
  typeId: PostConditionPrincipalID.Origin; // u8
}

interface PostConditionPrincipalStandard {
  typeId: PostConditionPrincipalID.Standard; // u8
  address: StacksAddress;
}

interface PostConditionPrincipalContract {
  typeId: PostConditionPrincipalID.Contract; // u8
  address: StacksAddress;
  contractName: string;
}

type PostConditionPrincipal = 
  | PostConditionPrincipalOrigin
  | PostConditionPrincipalStandard
  | PostConditionPrincipalContract;

const enum FungibleConditionCode {
  SentEq = 0x01,
  SentGt = 0x02,
  SentGe = 0x03,
  SentLt = 0x04,
  SentLe = 0x05,
}

const enum NonfungibleConditionCode {
  Sent = 0x10,
  NotSent = 0x11,
}

interface StacksAddress {
  version: number; // u8
  bytes: Buffer; // 20 bytes = HASH160
}

interface AssetInfo {
  contractAddress: StacksAddress;
  contractName: string;
  assetName: string;
}

interface TransactionPostConditionStx {
  assetInfoId: AssetInfoID.STX; // u8
  principal: PostConditionPrincipal;
  conditionCode: FungibleConditionCode; // u8
  amount: bigint; // u64
}

interface TransactionPostConditionFungible {
  assetInfoId: AssetInfoID.FungibleAsset; // u8
  principal: PostConditionPrincipal;
  asset: AssetInfo;
  conditionCode: FungibleConditionCode; // u8
  amount: bigint; // u64
}

// TODO: incomplete
interface TransactionPostConditionNonfungible {
  assetInfoId: AssetInfoID.NonfungibleAsset; // u8
  asset: AssetInfo;
  assetValue: any; // TODO: Value (Clarity value)
  conditionCode: NonfungibleConditionCode; // u8
}

type TransactionPostCondition = 
  | TransactionPostConditionStx 
  | TransactionPostConditionFungible 
  | TransactionPostConditionNonfungible;

const enum TransactionPayloadID {
  TokenTransfer = 0,
  SmartContract = 1,
  ContractCall = 2,
  PoisonMicroblock = 3,
  Coinbase = 4,
}

interface TransactionPayloadTokenTransfer {
  typeId: TransactionPayloadID.TokenTransfer;
  address: StacksAddress;
  amount: bigint; // u64
  memo: Buffer; // 34 bytes
}

interface TransactionPayloadCoinbase {
  typeId: TransactionPayloadID.Coinbase;
  payload: Buffer; // 32 bytes
}

// TODO: incomplete
interface TransactionPayloadContractCall {
  typeId: TransactionPayloadID.ContractCall;
}

// TODO: incomplete
interface TransactionPayloadSmartContract {
  typeId: TransactionPayloadID.SmartContract;
}

// TODO: incomplete
interface TransactionPayloadPoisonMicroblock {
  typeId: TransactionPayloadID.PoisonMicroblock;
}

type TransactionPayload = 
  | TransactionPayloadTokenTransfer 
  | TransactionPayloadCoinbase 
  | TransactionPayloadContractCall
  | TransactionPayloadSmartContract 
  | TransactionPayloadPoisonMicroblock;

interface Transaction {
  version: TransactionVersion; // u8
  chainId: number; // u32
  auth: TransactionAuthStandard | TransactionAuthSponsored;
  anchorMode: TransactionPostConditionMode; // u8
  postConditionMode: TransactionPostConditionMode; // u8
  postConditions: TransactionPostCondition[];
  payload: TransactionPayload;
}

export async function readTransactions(stream: Readable): Promise<Transaction[]> {
  const txCount = await readUInt32BE(stream);
  const txs = new Array<Transaction>(txCount);
  for (let i = 0; i < txCount; i++) {
    const version = await readByte(stream);
    const chainId = await readUInt32BE(stream);
    const authType: TransactionAuthType = await readByte(stream);

    let auth: TransactionAuthStandard | TransactionAuthSponsored;
    if (authType === TransactionAuthType.Standard) {
      const originCondition = await readTransactionSpendingCondition(stream);
      const txAuth: TransactionAuthStandard = {
        typeId: authType,
        originCondition: originCondition,
      };
      auth = txAuth;
    } else if (authType === TransactionAuthType.Sponsored) {
      const originCondition = await readTransactionSpendingCondition(stream);
      const sponsorCondition = await readTransactionSpendingCondition(stream);
      const txAuth: TransactionAuthSponsored = {
        typeId: authType,
        originCondition: originCondition,
        sponsorCondition: sponsorCondition,
      };
      auth = txAuth;
    } else {
      throw new Error(`Unexpected tx auth type: ${authType}`);
    }

    const anchorMode: TransactionPostConditionMode = await readByte(stream);
    if (anchorMode !== TransactionPostConditionMode.Allow 
      && anchorMode !== TransactionPostConditionMode.Deny) {
      throw new Error(`Unexpected tx post condition anchor mode: ${anchorMode}`);
    }

    const postConditionMode: TransactionPostConditionMode = await readByte(stream);
    if (postConditionMode !== TransactionPostConditionMode.Allow
      && postConditionMode !== TransactionPostConditionMode.Deny) {
      throw new Error(`Unexpected tx post condition mode: ${postConditionMode}`);
    }

    const postConditions = await readTransactionPostConditions(stream);

    const txPayload = await readTransactionPayload(stream);

    const tx: Transaction = {
      version: version,
      chainId: chainId,
      auth: auth,
      anchorMode: anchorMode,
      postConditionMode: postConditionMode,
      postConditions: postConditions,
      payload: txPayload,
    };
    txs[i] = tx;
    console.log('here');
  }
  return txs;
}

async function readTransactionPayload(stream: Readable): Promise<TransactionPayload> {
  const txPayloadType: TransactionPayloadID = await readByte(stream);
  if (txPayloadType === TransactionPayloadID.Coinbase) {
    const payload: TransactionPayloadCoinbase = {
      typeId: txPayloadType,
      payload: await readBuffer(stream, 32),
    };
    return payload;
  } else if (txPayloadType === TransactionPayloadID.TokenTransfer) {
    const cursor = await BufferReader.fromStream(stream, 63);
    const payload: TransactionPayloadTokenTransfer = {
      typeId: txPayloadType,
      address: {
        version: cursor.readUInt8(),
        bytes: cursor.readBuffer(20),
      },
      amount: cursor.readBigInt64BE(),
      memo: cursor.readBuffer(34),
    };
    return payload;
  } else if (txPayloadType === TransactionPayloadID.PoisonMicroblock) {
    throw new Error('not yet implemented');
  } else if (txPayloadType === TransactionPayloadID.SmartContract) {
    throw new Error('not yet implemented');
  } else if (txPayloadType === TransactionPayloadID.ContractCall) {
    throw new Error('not yet implemented');
  } else {
    throw new Error(`Unexpected tx payload type: ${txPayloadType}`);
  }
}

async function readTransactionPostConditions(stream: Readable): Promise<TransactionPostCondition[]> {
  const conditionCount = await readUInt32BE(stream);
  const conditions = new Array<TransactionPostCondition>(conditionCount);
  for (let i = 0; i < conditionCount; i++) {
    const typeId: AssetInfoID = await readByte(stream);
    if (typeId === AssetInfoID.STX) {
      const principal = await readTransactionPostConditionPrincipal(stream);
      const cursor = await BufferReader.fromStream(stream, 9);
      const conditionCode: FungibleConditionCode = cursor.readUInt8();
      const condition: TransactionPostConditionStx = {
        assetInfoId: typeId,
        principal: principal,
        conditionCode: conditionCode,
        amount: cursor.readBigInt64BE(),
      };
      conditions[i] = condition;
    } else if (typeId === AssetInfoID.FungibleAsset) {
      throw new Error('not yet implemented');
    } else if (typeId === AssetInfoID.NonfungibleAsset) {
      throw new Error('not yet implemented');
    } else {
      throw new Error(`Unexpected tx type ID: ${typeId}`);
    }
  }
  return conditions;
}

async function readTransactionPostConditionPrincipal(stream: Readable): Promise<PostConditionPrincipal> {
  const typeId: PostConditionPrincipalID = await readByte(stream);
  if (typeId === PostConditionPrincipalID.Origin) {
    const principal: PostConditionPrincipalOrigin = {
      typeId: typeId
    };
    return principal;
  } else if (typeId === PostConditionPrincipalID.Standard) {
    const cursor = await BufferReader.fromStream(stream, 21);
    const principal: PostConditionPrincipalStandard = {
      typeId: typeId,
      address: {
        version: cursor.readUInt8(),
        bytes: cursor.readBuffer(20),
      },
    };
    return principal;
  } else if (typeId === PostConditionPrincipalID.Contract) {
    const cursor = await BufferReader.fromStream(stream, 22);
    const address: StacksAddress = {
      version: cursor.readUInt8(),
      bytes: cursor.readBuffer(20),
    }
    const contractNameLen = cursor.readUInt8();
    const contractNameBuff = await readBuffer(stream, contractNameLen);
    const principal: PostConditionPrincipalContract = {
      typeId: typeId,
      address: address,
      contractName: contractNameBuff.toString('ascii'),
    };
    return principal;
  } else {
    throw new Error(`Unexpected tx post condition principal type ID: ${typeId}`);
  }
}

async function readTransactionSpendingCondition(stream: Readable): Promise<TransactionSpendingCondition> {
  const conditionType = await readByte(stream);
  if (conditionType === SingleSigHashMode.P2PKH || conditionType === SingleSigHashMode.P2WPKH) {
    const cursor = await BufferReader.fromStream(stream, 102);
    const condition: TransactionSpendingConditionSingleSig = {
      hashMode: conditionType,
      signer: cursor.readBuffer(20),
      nonce: cursor.readBigUInt64BE(),
      feeRate: cursor.readBigUInt64BE(),
      keyEncoding: cursor.readUInt8(),
      signature: cursor.readBuffer(65),
    };
    return condition;
  } else if (conditionType === MultiSigHashMode.P2SH || conditionType === MultiSigHashMode.P2WSH) {
    const cursor = await BufferReader.fromStream(stream, 40);
    const condition: TransactionSpendingConditionMultiSig = {
      hashMode: conditionType,
      signer: cursor.readBuffer(20),
      nonce: cursor.readBigUInt64BE(),
      feeRate: cursor.readBigUInt64BE(),
      authFields: new Array<TransactionAuthField>(cursor.readUInt32BE()),
    };
    for (let i = 0; i < condition.authFields.length; i++) {
      const authType: TransactionAuthFieldID = await readByte(stream);
      if (authType === TransactionAuthFieldID.PublicKeyCompressed 
        || authType === TransactionAuthFieldID.PublicKeyUncompressed) {
        const authFieldPubkey: TransactionAuthFieldPublicKey = {
          typeId: authType,
          publicKey: await readBuffer(stream, 33),
        };
        condition.authFields[i] = authFieldPubkey;
      } else if (authType === TransactionAuthFieldID.SignatureCompressed 
        || authType === TransactionAuthFieldID.SignatureUncompressed) {
        const authFieldSig: TransactionAuthFieldSignature = {
          typeId: authType,
          signature: await readBuffer(stream, 65),
        }
        condition.authFields[i] = authFieldSig;
      } else {
        throw new Error(`Unexpected tx auth field ID type: ${authType}`);
      }
    }
    return condition;
  } else {
    throw new Error(`Unexpected tx spend condition hash mode: ${conditionType}`);
  }
}
