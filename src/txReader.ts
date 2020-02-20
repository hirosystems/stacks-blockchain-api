import { BufferReader } from './binaryReader';
import { getEnumDescription } from './helpers';
import { StacksMessageParsingError, NotImplementedError } from './errors';

enum SigHashMode {
  /** SingleSigHashMode */
  P2PKH = 0x00,
  /** SingleSigHashMode */
  P2WPKH = 0x02,
  /** MultiSigHashMode */
  P2SH = 0x01,
  /** MultiSigHashMode */
  P2WSH = 0x03,
}

enum TransactionPublicKeyEncoding {
  Compressed = 0x00,
  Uncompressed = 0x01,
}

interface TransactionSpendingConditionSingleSig {
  hashMode: SigHashMode.P2PKH | SigHashMode.P2WPKH; // u8
  signer: Buffer; // 20 bytes, HASH160
  nonce: bigint; // u64
  feeRate: bigint; // u64
  keyEncoding: TransactionPublicKeyEncoding; // u8
  signature: Buffer; // 65 bytes
}

enum TransactionAuthFieldTypeID {
  PublicKeyCompressed = 0x00,
  PublicKeyUncompressed = 0x01,
  SignatureCompressed = 0x02,
  SignatureUncompressed = 0x03,
}

interface TransactionAuthFieldPublicKey {
  typeId: TransactionAuthFieldTypeID.PublicKeyCompressed | TransactionAuthFieldTypeID.PublicKeyUncompressed; // u8
  publicKey: Buffer; // 33 bytes
}

interface TransactionAuthFieldSignature {
  typeId: TransactionAuthFieldTypeID.SignatureCompressed | TransactionAuthFieldTypeID.SignatureUncompressed; // u8
  signature: Buffer; // 65 bytes
}

type TransactionAuthField = TransactionAuthFieldPublicKey | TransactionAuthFieldSignature;

interface TransactionSpendingConditionMultiSig {
  hashMode: SigHashMode.P2SH | SigHashMode.P2WSH; // u8
  signer: Buffer; // 20 bytes, HASH160
  nonce: bigint; // u64
  feeRate: bigint; // u64
  authFields: TransactionAuthField[];
}

enum TransactionAuthTypeID {
  Standard = 0x04,
  Sponsored = 0x05,
}

type TransactionSpendingCondition = TransactionSpendingConditionSingleSig | TransactionSpendingConditionMultiSig;

interface TransactionAuthStandard {
  typeId: TransactionAuthTypeID.Standard; // u8
  originCondition: TransactionSpendingCondition;
}

interface TransactionAuthSponsored {
  typeId: TransactionAuthTypeID.Sponsored; // u8
  originCondition: TransactionSpendingCondition;
  sponsorCondition: TransactionSpendingCondition;
}

enum TransactionPostConditionMode {
  Allow = 0x01,
  Deny = 0x02,
}

enum TransactionVersion {
  Mainnet = 0x00,
  Testnet = 0x80,
}

enum AssetInfoTypeID {
  STX = 0,
  FungibleAsset = 1,
  NonfungibleAsset = 2,
}

enum PostConditionPrincipalTypeID {
  Origin = 0x01,
  Standard = 0x02,
  Contract = 0x03,
}

interface PostConditionPrincipalOrigin {
  typeId: PostConditionPrincipalTypeID.Origin; // u8
}

interface PostConditionPrincipalStandard {
  typeId: PostConditionPrincipalTypeID.Standard; // u8
  address: StacksAddress;
}

interface PostConditionPrincipalContract {
  typeId: PostConditionPrincipalTypeID.Contract; // u8
  address: StacksAddress;
  contractName: string;
}

type PostConditionPrincipal =
  | PostConditionPrincipalOrigin
  | PostConditionPrincipalStandard
  | PostConditionPrincipalContract;

enum FungibleConditionCode {
  SentEq = 0x01,
  SentGt = 0x02,
  SentGe = 0x03,
  SentLt = 0x04,
  SentLe = 0x05,
}

enum NonfungibleConditionCode {
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
  assetInfoId: AssetInfoTypeID.STX; // u8
  principal: PostConditionPrincipal;
  conditionCode: FungibleConditionCode; // u8
  amount: bigint; // u64
}

interface TransactionPostConditionFungible {
  assetInfoId: AssetInfoTypeID.FungibleAsset; // u8
  principal: PostConditionPrincipal;
  asset: AssetInfo;
  conditionCode: FungibleConditionCode; // u8
  amount: bigint; // u64
}

// TODO: incomplete
interface TransactionPostConditionNonfungible {
  assetInfoId: AssetInfoTypeID.NonfungibleAsset; // u8
  asset: AssetInfo;
  assetValue: ClarityValue;
  conditionCode: NonfungibleConditionCode; // u8
}

// TODO: placeholder, needs clarity-js / stacks-transactions-js
interface ClarityValue {
  value: Buffer; // wrong
}

type TransactionPostCondition =
  | TransactionPostConditionStx
  | TransactionPostConditionFungible
  | TransactionPostConditionNonfungible;

enum TransactionPayloadTypeID {
  TokenTransfer = 0,
  SmartContract = 1,
  ContractCall = 2,
  PoisonMicroblock = 3,
  Coinbase = 4,
}

interface TransactionPayloadTokenTransfer {
  typeId: TransactionPayloadTypeID.TokenTransfer;
  address: StacksAddress;
  amount: bigint; // u64
  memo: Buffer; // 34 bytes
}

interface TransactionPayloadCoinbase {
  typeId: TransactionPayloadTypeID.Coinbase;
  payload: Buffer; // 32 bytes
}

// TODO: incomplete
interface TransactionPayloadContractCall {
  typeId: TransactionPayloadTypeID.ContractCall;
}

// TODO: incomplete
interface TransactionPayloadSmartContract {
  typeId: TransactionPayloadTypeID.SmartContract;
}

// TODO: incomplete
interface TransactionPayloadPoisonMicroblock {
  typeId: TransactionPayloadTypeID.PoisonMicroblock;
}

type TransactionPayload =
  | TransactionPayloadTokenTransfer
  | TransactionPayloadCoinbase
  | TransactionPayloadContractCall
  | TransactionPayloadSmartContract
  | TransactionPayloadPoisonMicroblock;

export interface Transaction {
  version: TransactionVersion; // u8
  chainId: number; // u32
  auth: TransactionAuthStandard | TransactionAuthSponsored;
  anchorMode: TransactionPostConditionMode; // u8
  postConditionMode: TransactionPostConditionMode; // u8
  postConditions: TransactionPostCondition[];
  payload: TransactionPayload;
}

export function readTransaction(reader: BufferReader): Transaction {
  const version = reader.readUInt8Enum(TransactionVersion, n => {
    throw new StacksMessageParsingError(`unexpected transactions version: ${n}`);
  });
  const chainId = reader.readUInt32BE();
  const authType = reader.readUInt8Enum(TransactionAuthTypeID, n => {
    throw new StacksMessageParsingError(`unexpected transaction auth type: ${n}`);
  });

  let auth: TransactionAuthStandard | TransactionAuthSponsored;
  if (authType === TransactionAuthTypeID.Standard) {
    const originCondition = readTransactionSpendingCondition(reader);
    const txAuth: TransactionAuthStandard = {
      typeId: authType,
      originCondition: originCondition,
    };
    auth = txAuth;
  } else if (authType === TransactionAuthTypeID.Sponsored) {
    const originCondition = readTransactionSpendingCondition(reader);
    const sponsorCondition = readTransactionSpendingCondition(reader);
    const txAuth: TransactionAuthSponsored = {
      typeId: authType,
      originCondition: originCondition,
      sponsorCondition: sponsorCondition,
    };
    auth = txAuth;
  } else {
    throw new NotImplementedError(`tx auth type: ${getEnumDescription(TransactionAuthTypeID, authType)}`);
  }

  const anchorMode = reader.readUInt8Enum(TransactionPostConditionMode, n => {
    throw new StacksMessageParsingError(`unexpected tx post condition anchor mode: ${n}`);
  });

  const postConditionMode = reader.readUInt8Enum(TransactionPostConditionMode, n => {
    throw new StacksMessageParsingError(`unexpected tx post condition mode: ${n}`);
  });

  const postConditions = readTransactionPostConditions(reader);

  const txPayload = readTransactionPayload(reader);

  const tx: Transaction = {
    version: version,
    chainId: chainId,
    auth: auth,
    anchorMode: anchorMode,
    postConditionMode: postConditionMode,
    postConditions: postConditions,
    payload: txPayload,
  };
  return tx;
}

export function readTransactions(reader: BufferReader): Transaction[] {
  const txCount = reader.readUInt32BE();
  const txs = new Array<Transaction>(txCount);
  for (let i = 0; i < txCount; i++) {
    const tx = readTransaction(reader);
    txs[i] = tx;
  }
  return txs;
}

function readTransactionPayload(reader: BufferReader): TransactionPayload {
  const txPayloadType = reader.readUInt8Enum(TransactionPayloadTypeID, n => {
    throw new StacksMessageParsingError(`unexpected tx payload type: ${n}`);
  });
  if (txPayloadType === TransactionPayloadTypeID.Coinbase) {
    const payload: TransactionPayloadCoinbase = {
      typeId: txPayloadType,
      payload: reader.readBuffer(32),
    };
    return payload;
  } else if (txPayloadType === TransactionPayloadTypeID.TokenTransfer) {
    const payload: TransactionPayloadTokenTransfer = {
      typeId: txPayloadType,
      address: {
        version: reader.readUInt8(),
        bytes: reader.readBuffer(20),
      },
      amount: reader.readBigInt64BE(),
      memo: reader.readBuffer(34),
    };
    return payload;
  } else {
    throw new NotImplementedError(`tx payload type: ${getEnumDescription(TransactionPayloadTypeID, txPayloadType)}`);
  }
}

function readTransactionPostConditions(reader: BufferReader): TransactionPostCondition[] {
  const conditionCount = reader.readUInt32BE();
  const conditions = new Array<TransactionPostCondition>(conditionCount);
  for (let i = 0; i < conditionCount; i++) {
    const typeId = reader.readUInt8Enum(AssetInfoTypeID, n => {
      throw new StacksMessageParsingError(`unexpected tx asset info type: ${n}`);
    });
    if (typeId === AssetInfoTypeID.STX) {
      const principal = readTransactionPostConditionPrincipal(reader);
      const conditionCode: FungibleConditionCode = reader.readUInt8();
      const condition: TransactionPostConditionStx = {
        assetInfoId: typeId,
        principal: principal,
        conditionCode: conditionCode,
        amount: reader.readBigInt64BE(),
      };
      conditions[i] = condition;
    } else {
      throw new NotImplementedError(`tx asset info type ${getEnumDescription(AssetInfoTypeID, typeId)}`);
    }
  }
  return conditions;
}

function readTransactionPostConditionPrincipal(reader: BufferReader): PostConditionPrincipal {
  const typeId = reader.readUInt8Enum(PostConditionPrincipalTypeID, n => {
    throw new StacksMessageParsingError(`unexpected tx post condition principal type: ${n}`);
  });
  if (typeId === PostConditionPrincipalTypeID.Origin) {
    const principal: PostConditionPrincipalOrigin = {
      typeId: typeId,
    };
    return principal;
  } else if (typeId === PostConditionPrincipalTypeID.Standard) {
    const principal: PostConditionPrincipalStandard = {
      typeId: typeId,
      address: {
        version: reader.readUInt8(),
        bytes: reader.readBuffer(20),
      },
    };
    return principal;
  } else if (typeId === PostConditionPrincipalTypeID.Contract) {
    const address: StacksAddress = {
      version: reader.readUInt8(),
      bytes: reader.readBuffer(20),
    };
    const contractNameLen = reader.readUInt8();
    const contractNameBuff = reader.readBuffer(contractNameLen);
    const principal: PostConditionPrincipalContract = {
      typeId: typeId,
      address: address,
      contractName: contractNameBuff.toString('ascii'),
    };
    return principal;
  } else {
    throw new NotImplementedError(
      `tx post condition principal type: ${getEnumDescription(PostConditionPrincipalTypeID, typeId)}`
    );
  }
}

function readTransactionSpendingCondition(reader: BufferReader): TransactionSpendingCondition {
  const conditionType = reader.readUInt8Enum(SigHashMode, n => {
    throw new StacksMessageParsingError(`unexpected tx spend condition hash mode: ${n}`);
  });
  if (conditionType === SigHashMode.P2PKH || conditionType === SigHashMode.P2WPKH) {
    const condition: TransactionSpendingConditionSingleSig = {
      hashMode: conditionType,
      signer: reader.readBuffer(20),
      nonce: reader.readBigUInt64BE(),
      feeRate: reader.readBigUInt64BE(),
      keyEncoding: reader.readUInt8(),
      signature: reader.readBuffer(65),
    };
    return condition;
  } else if (conditionType === SigHashMode.P2SH || conditionType === SigHashMode.P2WSH) {
    const condition: TransactionSpendingConditionMultiSig = {
      hashMode: conditionType,
      signer: reader.readBuffer(20),
      nonce: reader.readBigUInt64BE(),
      feeRate: reader.readBigUInt64BE(),
      authFields: new Array<TransactionAuthField>(reader.readUInt32BE()),
    };
    for (let i = 0; i < condition.authFields.length; i++) {
      const authType = reader.readUInt8Enum(TransactionAuthFieldTypeID, n => {
        throw new StacksMessageParsingError(`unexpected tx auth field type: ${n}`);
      });
      if (
        authType === TransactionAuthFieldTypeID.PublicKeyCompressed ||
        authType === TransactionAuthFieldTypeID.PublicKeyUncompressed
      ) {
        const authFieldPubkey: TransactionAuthFieldPublicKey = {
          typeId: authType,
          publicKey: reader.readBuffer(33),
        };
        condition.authFields[i] = authFieldPubkey;
      } else if (
        authType === TransactionAuthFieldTypeID.SignatureCompressed ||
        authType === TransactionAuthFieldTypeID.SignatureUncompressed
      ) {
        const authFieldSig: TransactionAuthFieldSignature = {
          typeId: authType,
          signature: reader.readBuffer(65),
        };
        condition.authFields[i] = authFieldSig;
      } else {
        throw new NotImplementedError(
          `tx auth field type: ${getEnumDescription(TransactionAuthFieldTypeID, authType)}`
        );
      }
    }
    return condition;
  } else {
    throw new NotImplementedError(`tx spend condition hash mode: ${getEnumDescription(SigHashMode, conditionType)}`);
  }
}
