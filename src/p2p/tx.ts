import { BufferReader } from '../binary-reader';
import { getEnumDescription } from '../helpers';
import { StacksMessageParsingError, NotImplementedError } from '../errors';
import { ClarityValue } from '@blockstack/stacks-transactions/src';
import { BufferReader as stacksTxBufferReader } from '@blockstack/stacks-transactions/src/utils';

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

enum TransactionAnchorMode {
  /** must be included in a StacksBlock */
  OnChainOnly = 1,
  /** must be included in a StacksMicroBlock */
  OffChainOnly = 2,
  /** either */
  Any = 3,
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

interface TransactionPostConditionNonfungible {
  assetInfoId: AssetInfoTypeID.NonfungibleAsset; // u8
  principal: PostConditionPrincipal;
  asset: AssetInfo;
  assetValue: ClarityValue;
  conditionCode: NonfungibleConditionCode; // u8
}

type TransactionPostCondition =
  | TransactionPostConditionStx
  | TransactionPostConditionFungible
  | TransactionPostConditionNonfungible;

export enum TransactionPayloadTypeID {
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

interface TransactionPayloadContractCall {
  typeId: TransactionPayloadTypeID.ContractCall;
  address: StacksAddress;
  contractName: string;
  functionName: string;
  functionArgs: ClarityValue[];
}

interface TransactionPayloadSmartContract {
  typeId: TransactionPayloadTypeID.SmartContract;
  name: string;
  codeBody: string;
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
  anchorMode: TransactionAnchorMode; // u8
  postConditionMode: TransactionPostConditionMode; // u8
  postConditions: TransactionPostCondition[];
  rawPostConditions?: Buffer;
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

  const anchorMode = reader.readUInt8Enum(TransactionAnchorMode, n => {
    throw new StacksMessageParsingError(`unexpected tx post condition anchor mode: ${n}`);
  });

  const postConditionIndexStart = reader.readOffset;

  const postConditionMode = reader.readUInt8Enum(TransactionPostConditionMode, n => {
    throw new StacksMessageParsingError(`unexpected tx post condition mode: ${n}`);
  });

  const postConditions = readTransactionPostConditions(reader);

  let rawPostConditions: Buffer | undefined;
  if (postConditions.length > 0) {
    rawPostConditions = Buffer.alloc(reader.readOffset - postConditionIndexStart);
    reader.internalBuffer.copy(rawPostConditions, 0, postConditionIndexStart, reader.readOffset);
  }

  const txPayload = readTransactionPayload(reader);

  const tx: Transaction = {
    version: version,
    chainId: chainId,
    auth: auth,
    anchorMode: anchorMode,
    postConditionMode: postConditionMode,
    postConditions: postConditions,
    rawPostConditions: rawPostConditions,
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
      address: readStacksAddress(reader),
      amount: reader.readBigInt64BE(),
      memo: reader.readBuffer(34),
    };
    return payload;
  } else if (txPayloadType === TransactionPayloadTypeID.SmartContract) {
    const payload: TransactionPayloadSmartContract = {
      typeId: txPayloadType,
      name: readContractName(reader),
      codeBody: readString(reader),
    };
    return payload;
  } else if (txPayloadType === TransactionPayloadTypeID.ContractCall) {
    const payload: TransactionPayloadContractCall = {
      typeId: txPayloadType,
      address: readStacksAddress(reader),
      contractName: readContractName(reader),
      functionName: readClarityName(reader),
      functionArgs: readClarityValueArray(reader),
    };
    return payload;
  } else {
    throw new NotImplementedError(`tx payload type: ${getEnumDescription(TransactionPayloadTypeID, txPayloadType)}`);
  }
}

function readClarityValue(reader: BufferReader): ClarityValue {
  const remainingBuffer = reader.internalBuffer.slice(reader.readOffset);
  const bufferReader = new stacksTxBufferReader(remainingBuffer);
  const clarityVal = ClarityValue.deserialize(bufferReader);
  return clarityVal;
}

function readClarityValueArray(reader: BufferReader): ClarityValue[] {
  const valueCount = reader.readUInt32BE();
  const values = new Array<ClarityValue>(valueCount);
  const remainingBuffer = reader.internalBuffer.slice(reader.readOffset);
  const bufferReader = new stacksTxBufferReader(remainingBuffer);
  for (let i = 0; i < valueCount; i++) {
    const clarityVal = ClarityValue.deserialize(bufferReader);
    values[i] = clarityVal;
  }
  return values;
}

function readString(reader: BufferReader): string {
  const length = reader.readUInt32BE();
  const str = reader.readString(length, 'ascii');
  return str;
}

function readContractName(reader: BufferReader): string {
  const length = reader.readUInt8();
  const name = reader.readString(length, 'ascii');
  return name;
}

function readClarityName(reader: BufferReader): string {
  const length = reader.readUInt8();
  const name = reader.readString(length, 'ascii');
  return name;
}

function readStacksAddress(reader: BufferReader): StacksAddress {
  const address: StacksAddress = {
    version: reader.readUInt8(),
    bytes: reader.readBuffer(20),
  };
  return address;
}

function readAssetInfo(reader: BufferReader): AssetInfo {
  const assetInfo: AssetInfo = {
    contractAddress: readStacksAddress(reader),
    contractName: readContractName(reader),
    assetName: readClarityName(reader),
  };
  return assetInfo;
}

function readTransactionPostConditions(reader: BufferReader): TransactionPostCondition[] {
  const conditionCount = reader.readUInt32BE();
  const conditions = new Array<TransactionPostCondition>(conditionCount);
  for (let i = 0; i < conditionCount; i++) {
    const typeId = reader.readUInt8Enum(AssetInfoTypeID, n => {
      throw new StacksMessageParsingError(`unexpected tx asset info type: ${n}`);
    });
    const principal = readTransactionPostConditionPrincipal(reader);
    if (typeId === AssetInfoTypeID.STX) {
      const condition: TransactionPostConditionStx = {
        assetInfoId: typeId,
        principal: principal,
        conditionCode: reader.readUInt8Enum(FungibleConditionCode, n => {
          throw new StacksMessageParsingError(`unexpected condition code: ${n}`);
        }),
        amount: reader.readBigInt64BE(),
      };
      conditions[i] = condition;
    } else if (typeId === AssetInfoTypeID.FungibleAsset) {
      const condition: TransactionPostConditionFungible = {
        assetInfoId: typeId,
        principal: principal,
        asset: readAssetInfo(reader),
        conditionCode: reader.readUInt8Enum(FungibleConditionCode, n => {
          throw new StacksMessageParsingError(`unexpected condition code: ${n}`);
        }),
        amount: reader.readBigUInt64BE(),
      };
      conditions[i] = condition;
    } else if (typeId === AssetInfoTypeID.NonfungibleAsset) {
      const condition: TransactionPostConditionNonfungible = {
        assetInfoId: typeId,
        principal: principal,
        asset: readAssetInfo(reader),
        assetValue: readClarityValue(reader),
        conditionCode: reader.readUInt8Enum(NonfungibleConditionCode, n => {
          throw new StacksMessageParsingError(`unexpected nonfungible condition code: ${n}`);
        }),
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
      address: readStacksAddress(reader),
    };
    return principal;
  } else if (typeId === PostConditionPrincipalTypeID.Contract) {
    const address = readStacksAddress(reader);
    const contractName = readContractName(reader);
    const principal: PostConditionPrincipalContract = {
      typeId: typeId,
      address: address,
      contractName: contractName,
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
