import { asyncHandler } from '../../async-handler';
import { address as btcAddress } from 'bitcoinjs-lib';
import * as BN from 'bn.js';
import {
  NetworkIdentifier,
  RosettaAccountIdentifier,
  RosettaConstructionDeriveResponse,
  RosettaConstructionHashRequest,
  RosettaConstructionHashResponse,
  RosettaConstructionMetadataResponse,
  RosettaConstructionPreprocessResponse,
  RosettaMaxFeeAmount,
  RosettaOperation,
  RosettaOptions,
  RosettaPublicKey,
  RosettaConstructionSubmitResponse,
  RosettaConstructionMetadataRequest,
  RosettaConstructionPayloadResponse,
  RosettaConstructionCombineRequest,
  RosettaConstructionCombineResponse,
  RosettaAmount,
  RosettaCurrency,
  RosettaTransaction,
  RosettaError,
  RosettaConstructionParseResponse,
} from '@stacks/stacks-blockchain-api-types';
import {
  createMessageSignature,
  emptyMessageSignature,
  isSingleSig,
  makeSigHashPreSign,
  MessageSignature,
  BufferReader,
  deserializeTransaction,
  StacksTransaction,
  UnsignedTokenTransferOptions,
  makeUnsignedSTXTokenTransfer,
  TransactionSigner,
  AuthType,
  ChainID,
  makeUnsignedContractCall,
  UnsignedContractCallOptions,
  uintCV,
  tupleCV,
  bufferCV,
  standardPrincipalCV,
  noneCV,
  OptionalCV,
  someCV,
  AnchorMode,
} from '@stacks/transactions';
import { decodeBtcAddress } from '@stacks/stacking';
import * as express from 'express';
import { StacksCoreRpcClient } from '../../../core-rpc/client';
import { DataStore, DbBlock } from '../../../datastore/common';
import { FoundOrNot, hexToBuffer, isValidC32Address, has0xPrefix } from '../../../helpers';
import {
  RosettaConstants,
  RosettaErrors,
  RosettaErrorsTypes,
  RosettaOperationType,
} from '../../rosetta-constants';
import {
  bitcoinAddressToSTXAddress,
  getOperations,
  getOptionsFromOperations,
  getSigners,
  isDecimalsSupported,
  isSignedTransaction,
  isSymbolSupported,
  publicKeyToBitcoinAddress,
  rawTxToBaseTx,
  rawTxToStacksTransaction,
  getStacksNetwork,
  makePresignHash,
  verifySignature,
  parseTransactionMemo,
} from './../../../rosetta-helpers';
import { makeRosettaError, rosettaValidateRequest, ValidSchema } from './../../rosetta-validate';

export function createRosettaConstructionRouter(db: DataStore, chainId: ChainID): express.Router {
  const router = express.Router();
  router.use(express.json());

  //construction/derive endpoint
  router.post(
    '/derive',
    asyncHandler(async (req, res) => {
      const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
      if (!valid.valid) {
        //TODO have to fix this and make error generic
        if (valid.error?.includes('should be equal to one of the allowed values')) {
          res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidCurveType]);
        }
        res.status(400).json(makeRosettaError(valid));
        return;
      }

      const publicKey: RosettaPublicKey = req.body.public_key;
      const network: NetworkIdentifier = req.body.network_identifier;

      if (has0xPrefix(publicKey.hex_bytes)) {
        publicKey.hex_bytes = publicKey.hex_bytes.replace('0x', '');
      }

      try {
        const btcAddress = publicKeyToBitcoinAddress(publicKey.hex_bytes, network.network);
        if (btcAddress === undefined) {
          res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidPublicKey]);
          return;
        }
        const stxAddress = bitcoinAddressToSTXAddress(btcAddress);

        const accountIdentifier: RosettaAccountIdentifier = {
          address: stxAddress,
        };
        const response: RosettaConstructionDeriveResponse = {
          account_identifier: accountIdentifier,
        };
        res.json(response);
      } catch (e) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidPublicKey]);
      }
    })
  );

  //construction/preprocess endpoint
  router.post(
    '/preprocess',
    asyncHandler(async (req, res) => {
      const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
      if (!valid.valid) {
        res.status(400).json(makeRosettaError(valid));
        return;
      }

      const operations: RosettaOperation[] = req.body.operations;

      // Max operations should be 3 for one transaction
      if (operations.length > 3) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        return;
      }

      if (!isSymbolSupported(req.body.operations)) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidCurrencySymbol]);
        return;
      }

      if (!isDecimalsSupported(req.body.operations)) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidCurrencyDecimals]);
        return;
      }

      const options = getOptionsFromOperations(req.body.operations);
      if (options == null) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        return;
      }

      if (req.body.metadata) {
        if (req.body.metadata.gas_limit) {
          options.gas_limit = req.body.metadata.gas_limit;
        }

        if (req.body.metadata.gas_price) {
          options.gas_price = req.body.metadata.gas_price;
        }

        if (req.body.suggested_fee_multiplier) {
          options.suggested_fee_multiplier = req.body.suggested_fee_multiplier;
        }
      }

      if (req.body.max_fee) {
        const max_fee: RosettaMaxFeeAmount = req.body.max_fee[0];
        if (
          max_fee.currency.symbol === RosettaConstants.symbol &&
          max_fee.currency.decimals === RosettaConstants.decimals
        ) {
          options.max_fee = max_fee.value;
        } else {
          res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidFee]);
          return;
        }
      }

      let transaction: StacksTransaction;
      switch (options.type) {
        case RosettaOperationType.TokenTransfer:
          // dummy transaction to calculate size
          const dummyTokenTransferTx: UnsignedTokenTransferOptions = {
            recipient: options.token_transfer_recipient_address as string,
            amount: new BN(options.amount as string),
            // We don't know the fee yet but need a placeholder
            fee: new BN(0),
            // placeholder public key
            publicKey: '000000000000000000000000000000000000000000000000000000000000000000',
            network: getStacksNetwork(),
            // We don't know the non yet but need a placeholder
            nonce: new BN(0),
            memo: req.body.metadata?.memo,
            anchorMode: AnchorMode.Any,
          };

          transaction = await makeUnsignedSTXTokenTransfer(dummyTokenTransferTx);
          break;
        case RosettaOperationType.StackStx: {
          if (!options.number_of_cycles) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }

          if (!options.pox_addr) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }
          // dummy transaction to calculate size
          const poxAddress = options.pox_addr;
          const { hashMode, data } = decodeBtcAddress(poxAddress);
          const hashModeBuffer = bufferCV(new BN(hashMode, 10).toArrayLike(Buffer));
          const hashbytes = bufferCV(data);
          const poxAddressCV = tupleCV({
            hashbytes,
            version: hashModeBuffer,
          });
          if (!options.amount) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }
          const dummyStackingTx: UnsignedContractCallOptions = {
            contractAddress: 'ST000000000000000000002AMW42H',
            contractName: 'pox',
            functionName: 'stack-stx',
            publicKey: '000000000000000000000000000000000000000000000000000000000000000000',
            functionArgs: [
              uintCV(options.amount),
              poxAddressCV,
              uintCV(0),
              uintCV(options.number_of_cycles),
            ],
            validateWithAbi: false,
            network: getStacksNetwork(),
            fee: new BN(0),
            nonce: new BN(0),
            anchorMode: AnchorMode.Any,
          };
          transaction = await makeUnsignedContractCall(dummyStackingTx);
          break;
        }
        case RosettaOperationType.DelegateStx: {
          // dummy transaction to calculate size
          if (!options.amount) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }
          if (!options.delegate_to) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }

          let optionalPoxAddressCV: OptionalCV = noneCV();
          if (options.pox_addr) {
            const dummyPoxAddress = options.pox_addr;
            const { hashMode, data } = decodeBtcAddress(dummyPoxAddress);
            const hashModeBuffer = bufferCV(new BN(hashMode, 10).toArrayLike(Buffer));
            const hashbytes = bufferCV(data);
            optionalPoxAddressCV = someCV(
              tupleCV({
                hashbytes,
                version: hashModeBuffer,
              })
            );
          }

          const dummyStackingTx: UnsignedContractCallOptions = {
            contractAddress: 'ST000000000000000000002AMW42H',
            contractName: 'pox',
            functionName: 'delegate-stx',
            publicKey: '000000000000000000000000000000000000000000000000000000000000000000',
            functionArgs: [
              uintCV(options.amount),
              standardPrincipalCV(options.delegate_to),
              noneCV(),
              optionalPoxAddressCV,
            ],
            validateWithAbi: false,
            network: getStacksNetwork(),
            fee: new BN(0),
            nonce: new BN(0),
            anchorMode: AnchorMode.Any,
          };
          transaction = await makeUnsignedContractCall(dummyStackingTx);
          break;
        }
        default:
          res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
          return;
      }

      const unsignedTransaction = transaction.serialize();

      options.size = unsignedTransaction.length;

      if (req.body.metadata?.memo) {
        options.memo = req.body.metadata?.memo;
      }

      const rosettaPreprocessResponse: RosettaConstructionPreprocessResponse = {
        options,
        required_public_keys: [
          {
            address: options.sender_address as string,
          },
        ],
      };
      res.json(rosettaPreprocessResponse);
    })
  );

  //construction/metadata endpoint
  router.post(
    '/metadata',
    asyncHandler(async (req, res) => {
      const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
      if (!valid.valid) {
        res.status(400).json(makeRosettaError(valid));
        return;
      }

      const request: RosettaConstructionMetadataRequest = req.body;
      const options: RosettaOptions = req.body.options;

      if (options?.sender_address && !isValidC32Address(options.sender_address)) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidSender]);
        return;
      }
      if (options?.symbol !== RosettaConstants.symbol) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidCurrencySymbol]);
        return;
      }

      if (!options?.fee && options?.size === undefined) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.missingTransactionSize]);
        return;
      }

      let response = {} as RosettaConstructionMetadataResponse;
      switch (options.type) {
        case RosettaOperationType.TokenTransfer:
          const recipientAddress = options.token_transfer_recipient_address;
          if (options?.decimals !== RosettaConstants.decimals) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidCurrencyDecimals]);
            return;
          }

          if (recipientAddress == null || !isValidC32Address(recipientAddress)) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidRecipient]);
            return;
          }
          break;
        case RosettaOperationType.StackStx: {
          // Getting stacking info
          const poxInfo = await new StacksCoreRpcClient().getPox();
          const coreInfo = await new StacksCoreRpcClient().getInfo();
          const contractInfo = poxInfo.contract_id.split('.');
          options.contract_address = contractInfo[0];
          options.contract_name = contractInfo[1];
          options.burn_block_height = coreInfo.burn_block_height;
          break;
        }
        case RosettaOperationType.DelegateStx: {
          // delegate stacking
          const poxInfo = await new StacksCoreRpcClient().getPox();
          const contractInfo = poxInfo.contract_id.split('.');
          options.contract_address = contractInfo[0];
          options.contract_name = contractInfo[1];
          break;
        }
        default:
          res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidTransactionType]);
          return;
      }

      if (typeof options.sender_address === 'undefined') {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.missingSenderAddress]);
        return;
      }
      const stxAddress = options.sender_address;

      // Getting nonce info
      const accountInfo = await new StacksCoreRpcClient().getAccount(stxAddress);
      const nonce = accountInfo.nonce;

      let recentBlockHash = undefined;
      const blockQuery: FoundOrNot<DbBlock> = await db.getCurrentBlock();
      if (blockQuery.found) {
        recentBlockHash = blockQuery.result.block_hash;
      }

      response = {
        metadata: {
          ...req.body.options,
          account_sequence: nonce,
          recent_block_hash: recentBlockHash,
        },
      };

      // Getting fee info if not operation fee was given in /preprocess
      const feeInfo = await new StacksCoreRpcClient().getEstimatedTransferFee();
      if (feeInfo === undefined || feeInfo === '0') {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidFee]);
        return;
      }

      if (!options.size) {
        res.status(400).json(RosettaErrorsTypes.missingTransactionSize);
        return;
      }
      const feeValue = (BigInt(feeInfo) * BigInt(options.size)).toString();
      const currency: RosettaCurrency = {
        symbol: RosettaConstants.symbol,
        decimals: RosettaConstants.decimals,
      };

      const fee: RosettaAmount = {
        value: feeValue,
        currency,
      };

      response.suggested_fee = [fee];

      res.json(response);
    })
  );

  //construction/hash endpoint
  router.post(
    '/hash',
    asyncHandler(async (req, res) => {
      const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
      if (!valid.valid) {
        res.status(400).json(makeRosettaError(valid));
        return;
      }

      const request: RosettaConstructionHashRequest = req.body;

      if (!has0xPrefix(request.signed_transaction)) {
        request.signed_transaction = '0x' + request.signed_transaction;
      }

      let buffer: Buffer;
      try {
        buffer = hexToBuffer(request.signed_transaction);
      } catch (error) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidTransactionString]);
        return;
      }

      const transaction = deserializeTransaction(BufferReader.fromBuffer(buffer));
      const hash = transaction.txid();

      if (!transaction.auth.spendingCondition) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.transactionNotSigned]);
        return;
      }
      if (isSingleSig(transaction.auth.spendingCondition)) {
        /**Single signature Transaction has an empty signature, so the transaction is not signed */
        if (
          !transaction.auth.spendingCondition.signature.data ||
          emptyMessageSignature().data === transaction.auth.spendingCondition.signature.data
        ) {
          res.status(400).json(RosettaErrors[RosettaErrorsTypes.transactionNotSigned]);
          return;
        }
      } else {
        /**Multi-signature transaction does not have signature fields thus the transaction not signed */
        if (transaction.auth.spendingCondition.fields.length === 0) {
          res.status(400).json(RosettaErrors[RosettaErrorsTypes.transactionNotSigned]);
          return;
        }
      }

      const hashResponse: RosettaConstructionHashResponse = {
        transaction_identifier: {
          hash: '0x' + hash,
        },
      };
      res.status(200).json(hashResponse);
    })
  );

  //construction/parse endpoint
  router.post(
    '/parse',
    asyncHandler(async (req, res) => {
      const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
      if (!valid.valid) {
        res.status(400).json(makeRosettaError(valid));
        return;
      }
      let inputTx = req.body.transaction;
      const signed = req.body.signed;

      if (!has0xPrefix(inputTx)) {
        inputTx = '0x' + inputTx;
      }

      const transaction = rawTxToStacksTransaction(inputTx);
      const checkSigned = isSignedTransaction(transaction);
      if (signed != checkSigned) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidParams]);
        return;
      }
      try {
        const baseTx = rawTxToBaseTx(inputTx);
        const operations = await getOperations(baseTx, db);
        const txMemo = parseTransactionMemo(baseTx);
        let response: RosettaConstructionParseResponse;
        if (signed) {
          response = {
            operations: operations,
            account_identifier_signers: getSigners(transaction),
          };
        } else {
          response = {
            operations: operations,
          };
        }
        if (txMemo) {
          response.metadata = {
            memo: txMemo,
          };
        }
        res.json(response);
      } catch (error) {
        console.error(error);
      }
    })
  );

  //construction/submit endpoint
  router.post(
    '/submit',
    asyncHandler(async (req, res) => {
      const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
      if (!valid.valid) {
        res.status(400).json(makeRosettaError(valid));
        return;
      }
      let transaction = req.body.signed_transaction;
      let buffer: Buffer;

      if (!has0xPrefix(transaction)) {
        transaction = '0x' + transaction;
      }

      try {
        buffer = hexToBuffer(transaction);
      } catch (error) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidTransactionString]);
        return;
      }
      try {
        const submitResult = await new StacksCoreRpcClient().sendTransaction(buffer);
        const response: RosettaConstructionSubmitResponse = {
          transaction_identifier: {
            hash: submitResult.txId,
          },
        };
        res.status(200).json(response);
      } catch (e: any) {
        const err: RosettaError = {
          ...RosettaErrors[RosettaErrorsTypes.invalidTransactionString],
          details: { message: e.message },
        };
        res.status(400).json(err);
      }
    })
  );

  //construction/payloads endpoint
  router.post(
    '/payloads',
    asyncHandler(async (req, res) => {
      const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
      if (!valid.valid) {
        res.status(400).json(makeRosettaError(valid));
        return;
      }

      const options = getOptionsFromOperations(req.body.operations);
      if (options == null) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        return;
      }

      const amount = options.amount;
      if (!amount) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidAmount]);
        return;
      }

      if (!options.fee || typeof options.fee !== 'string') {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidFees]);
        return;
      }
      const fee: string = options.fee;

      const publicKeys: RosettaPublicKey[] = req.body.public_keys;
      if (!publicKeys) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.emptyPublicKey]);
        return;
      }

      const senderAddress = options.sender_address;
      if (!senderAddress) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidSender]);
        return;
      }

      if (!('metadata' in req.body) || !('account_sequence' in req.body.metadata)) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.missingNonce]);
        return;
      }

      const nonce = new BN(req.body.metadata.account_sequence);

      if (publicKeys.length !== 1) {
        //TODO support multi-sig in the future.
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.needOnePublicKey]);
        return;
      }

      if (publicKeys[0].curve_type !== 'secp256k1') {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidCurveType]);
        return;
      }

      if (has0xPrefix(publicKeys[0].hex_bytes)) {
        publicKeys[0].hex_bytes = publicKeys[0].hex_bytes.slice(2);
      }

      let transaction: StacksTransaction;
      switch (options.type) {
        case RosettaOperationType.TokenTransfer: {
          const recipientAddress = options.token_transfer_recipient_address;
          if (!recipientAddress) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidRecipient]);
            return;
          }
          // signel signature
          const tokenTransferOptions: UnsignedTokenTransferOptions = {
            recipient: recipientAddress,
            amount: new BN(amount),
            fee: new BN(fee),
            publicKey: publicKeys[0].hex_bytes,
            network: getStacksNetwork(),
            nonce: nonce,
            memo: req.body.metadata?.memo,
            anchorMode: AnchorMode.Any,
          };

          transaction = await makeUnsignedSTXTokenTransfer(tokenTransferOptions);

          break;
        }
        case RosettaOperationType.StackStx: {
          if (!options.pox_addr) {
            res.status(400).json(RosettaErrorsTypes.invalidOperation);
            return;
          }
          const poxBTCAddress = options.pox_addr;
          const { hashMode, data } = decodeBtcAddress(poxBTCAddress);
          const hashModeBuffer = bufferCV(new BN(hashMode, 10).toArrayLike(Buffer));
          const hashbytes = bufferCV(data);
          const poxAddressCV = tupleCV({
            hashbytes,
            version: hashModeBuffer,
          });
          if (!options.amount) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }
          if (!req.body.metadata.contract_address) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.missingContractAddress]);
            return;
          }
          if (!req.body.metadata.contract_name) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.missingContractName]);
            return;
          }
          if (!req.body.metadata.burn_block_height) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }
          if (!options.number_of_cycles) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }
          const stackingTx: UnsignedContractCallOptions = {
            contractAddress: req.body.metadata.contract_address,
            contractName: req.body.metadata.contract_name,
            functionName: 'stack-stx',
            publicKey: publicKeys[0].hex_bytes,
            functionArgs: [
              uintCV(options.amount),
              poxAddressCV,
              uintCV(req.body.metadata.burn_block_height),
              uintCV(options.number_of_cycles),
            ],
            fee: new BN(options.fee),
            nonce: nonce,
            validateWithAbi: false,
            network: getStacksNetwork(),
            anchorMode: AnchorMode.Any,
          };
          transaction = await makeUnsignedContractCall(stackingTx);
          break;
        }
        case RosettaOperationType.DelegateStx: {
          let poxAddressCV: OptionalCV = noneCV();

          if (options.pox_addr) {
            const poxBTCAddress = options.pox_addr;
            const { hashMode, data } = decodeBtcAddress(poxBTCAddress);
            const hashModeBuffer = bufferCV(new BN(hashMode, 10).toArrayLike(Buffer));
            const hashbytes = bufferCV(data);
            poxAddressCV = someCV(
              tupleCV({
                hashbytes,
                version: hashModeBuffer,
              })
            );
          }
          if (!options.amount) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }
          if (!req.body.metadata.contract_address) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.missingContractAddress]);
            return;
          }
          if (!req.body.metadata.contract_name) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.missingContractName]);
            return;
          }

          let expire_burn_block_heightCV: OptionalCV = noneCV();
          if (req.body.metadata.burn_block_height) {
            const burn_block_height = req.body.metadata.burn_block_height;
            if (typeof burn_block_height !== 'number' || typeof burn_block_height !== 'string')
              expire_burn_block_heightCV = someCV(uintCV(burn_block_height));
          }
          if (!options.delegate_to) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }
          const stackingTx: UnsignedContractCallOptions = {
            contractAddress: req.body.metadata.contract_address,
            contractName: req.body.metadata.contract_name,
            functionName: 'delegate-stx',
            publicKey: publicKeys[0].hex_bytes,
            functionArgs: [
              uintCV(options.amount),
              standardPrincipalCV(options.delegate_to),
              expire_burn_block_heightCV,
              poxAddressCV,
            ],
            fee: new BN(options.fee),
            nonce: nonce,
            validateWithAbi: false,
            network: getStacksNetwork(),
            anchorMode: AnchorMode.Any,
          };
          transaction = await makeUnsignedContractCall(stackingTx);
          break;
        }
        default:
          res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
          return;
      }

      const unsignedTransaction = transaction.serialize();

      const signer = new TransactionSigner(transaction);

      const prehash = makeSigHashPreSign(signer.sigHash, AuthType.Standard, new BN(fee), nonce);
      const accountIdentifier: RosettaAccountIdentifier = {
        address: senderAddress,
      };
      const response: RosettaConstructionPayloadResponse = {
        unsigned_transaction: '0x' + unsignedTransaction.toString('hex'),
        payloads: [
          {
            address: senderAddress,
            account_identifier: accountIdentifier,
            hex_bytes: prehash,
            signature_type: 'ecdsa_recovery',
          },
        ],
      };
      res.json(response);
    })
  );

  //construction/combine endpoint
  router.post(
    '/combine',
    asyncHandler(async (req, res) => {
      const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
      if (!valid.valid) {
        res.status(400).json(makeRosettaError(valid));
        return;
      }
      const combineRequest: RosettaConstructionCombineRequest = req.body;
      const signatures = combineRequest.signatures;

      if (!has0xPrefix(combineRequest.unsigned_transaction)) {
        combineRequest.unsigned_transaction = '0x' + combineRequest.unsigned_transaction;
      }

      if (signatures.length === 0) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.noSignatures]);
        return;
      }

      let unsigned_transaction_buffer: Buffer;
      let transaction: StacksTransaction;

      try {
        unsigned_transaction_buffer = hexToBuffer(combineRequest.unsigned_transaction);
        transaction = deserializeTransaction(BufferReader.fromBuffer(unsigned_transaction_buffer));
      } catch (e) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidTransactionString]);
        return;
      }

      if (signatures.length !== 1) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.needOnlyOneSignature]);
        return;
      }

      if (signatures[0].public_key.curve_type !== 'secp256k1') {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidCurveType]);
        return;
      }
      const preSignHash = makePresignHash(transaction);
      if (!preSignHash) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidTransactionString]);
        return;
      }

      let newSignature: MessageSignature;

      try {
        /**
         * the elliptic library produces signatures that aren't in an "allowed" format
         * it preapend v (i.e 01) while it should append it at the end, to incorporate that rotate
         * the signature to match the elipcitc library
         * Discussion here: https://github.com/coinbase/rosetta-sdk-go/issues/201
         */
        const hash = signatures[0].hex_bytes.slice(128) + signatures[0].hex_bytes.slice(0, -2);
        newSignature = createMessageSignature(hash);
      } catch (error) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidSignature]);
        return;
      }

      if (has0xPrefix(signatures[0].public_key.hex_bytes)) {
        signatures[0].public_key.hex_bytes = signatures[0].public_key.hex_bytes.slice(2);
      }

      if (
        !verifySignature(
          signatures[0].signing_payload.hex_bytes,
          signatures[0].public_key.hex_bytes,
          newSignature
        )
      ) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.signatureNotVerified]);
        return;
      }

      if (transaction.auth.spendingCondition && isSingleSig(transaction.auth.spendingCondition)) {
        transaction.auth.spendingCondition.signature = newSignature;
      } else {
        //support multi-sig
      }

      const serializedTx = transaction.serialize().toString('hex');

      const combineResponse: RosettaConstructionCombineResponse = {
        signed_transaction: '0x' + serializedTx,
      };

      res.status(200).json(combineResponse);
    })
  );

  return router;
}
