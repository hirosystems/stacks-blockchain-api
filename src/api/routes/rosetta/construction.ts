import { StacksMainnet, StacksTestnet } from '@stacks/network';
import { decodeBtcAddress, poxAddressToTuple, StackingClient } from '@stacks/stacking';
import {
  NetworkIdentifier,
  RosettaAccountIdentifier,
  RosettaAmount,
  RosettaConstructionCombineRequest,
  RosettaConstructionCombineResponse,
  RosettaConstructionDeriveResponse,
  RosettaConstructionHashRequest,
  RosettaConstructionHashResponse,
  RosettaConstructionMetadataRequest,
  RosettaConstructionMetadataResponse,
  RosettaConstructionParseResponse,
  RosettaConstructionPayloadResponse,
  RosettaConstructionPreprocessResponse,
  RosettaConstructionSubmitResponse,
  RosettaCurrency,
  RosettaError,
  RosettaMaxFeeAmount,
  RosettaOperation,
  RosettaOptions,
  RosettaPublicKey,
} from '@stacks/stacks-blockchain-api-types';
import {
  AnchorMode,
  AuthType,
  bufferCV,
  BytesReader,
  createMessageSignature,
  deserializeTransaction,
  emptyMessageSignature,
  isSingleSig,
  makeSigHashPreSign,
  makeUnsignedContractCall,
  makeUnsignedSTXTokenTransfer,
  MessageSignature,
  noneCV,
  OptionalCV,
  someCV,
  StacksTransaction,
  standardPrincipalCV,
  TransactionSigner,
  tupleCV,
  uintCV,
  UnsignedContractCallOptions,
  UnsignedTokenTransferOptions,
} from '@stacks/transactions';
import * as express from 'express';
import { bitcoinToStacksAddress } from 'stacks-encoding-native-js';
import { getCoreNodeEndpoint, StacksCoreRpcClient } from '../../../core-rpc/client';
import { DbBlock } from '../../../datastore/common';
import { PgStore } from '../../../datastore/pg-store';
import {
  BigIntMath,
  ChainID,
  doesThrow,
  FoundOrNot,
  getChainIDNetwork,
  isValidC32Address,
} from '../../../helpers';
import { asyncHandler } from '../../async-handler';
import {
  RosettaConstants,
  RosettaErrors,
  RosettaErrorsTypes,
  RosettaOperationType,
} from '../../rosetta-constants';
import {
  getOperations,
  getOptionsFromOperations,
  getSigners,
  getStacksNetwork,
  isDecimalsSupported,
  isSignedTransaction,
  isSymbolSupported,
  makePresignHash,
  parseTransactionMemo,
  publicKeyToBitcoinAddress,
  rawTxToBaseTx,
  rawTxToStacksTransaction,
  verifySignature,
} from '../../../rosetta/rosetta-helpers';
import { makeRosettaError, rosettaValidateRequest, ValidSchema } from './../../rosetta-validate';
import { has0xPrefix, hexToBuffer } from '@hirosystems/api-toolkit';

export function createRosettaConstructionRouter(db: PgStore, chainId: ChainID): express.Router {
  const router = express.Router();
  router.use(express.json());

  const stackingOpts = { url: `http://${getCoreNodeEndpoint()}` };
  const stackingRpc = new StackingClient(
    '', // anonymous
    getChainIDNetwork(chainId) == 'mainnet'
      ? new StacksMainnet(stackingOpts)
      : new StacksTestnet(stackingOpts)
  );

  //construction/derive endpoint
  router.post(
    '/derive',
    asyncHandler(async (req, res) => {
      const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
      if (!valid.valid) {
        //TODO have to fix this and make error generic
        if (valid.error?.includes('should be equal to one of the allowed values')) {
          res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidCurveType]);
          return;
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
        const stxAddress = bitcoinToStacksAddress(btcAddress);

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
    makeValidationMiddleware(chainId),
    asyncHandler(async (req, res) => {
      const operations: RosettaOperation[] = req.body.operations;

      // Max operations should be 3 for one transaction
      if (operations.length > 3) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        return;
      }

      if (!isSymbolSupported(operations)) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidCurrencySymbol]);
        return;
      }

      if (!isDecimalsSupported(operations)) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidCurrencyDecimals]);
        return;
      }

      const options = getOptionsFromOperations(operations);
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
          // todo: should this only be done if we have `metadata`?
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
      switch (options.type as RosettaOperationType) {
        case RosettaOperationType.TokenTransfer:
          // dummy transaction to calculate size
          const dummyTokenTransferTx: UnsignedTokenTransferOptions = {
            recipient: options.token_transfer_recipient_address as string,
            amount: BigInt(options.amount as string),
            fee: 0, // placeholder
            publicKey: '000000000000000000000000000000000000000000000000000000000000000000', // placeholder
            network: getStacksNetwork(),
            nonce: 0, // placeholder
            memo: req.body.metadata?.memo,
            anchorMode: AnchorMode.Any,
          };

          transaction = await makeUnsignedSTXTokenTransfer(dummyTokenTransferTx);
          break;
        case RosettaOperationType.StackStx: {
          const poxAddr = options.pox_addr;
          if (!options.number_of_cycles || !poxAddr) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }

          if (doesThrow(() => decodeBtcAddress(poxAddr))) {
            // todo: add error type specifically for this?
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }

          if (!options.amount) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }
          // dummy transaction to calculate size
          const dummyStackingTx: UnsignedContractCallOptions = {
            publicKey: '000000000000000000000000000000000000000000000000000000000000000000',
            contractAddress: 'ST000000000000000000002AMW42H',
            contractName: 'pox',
            functionName: 'stack-stx',
            functionArgs: [
              uintCV(options.amount),
              poxAddressToTuple(poxAddr),
              uintCV(0),
              uintCV(options.number_of_cycles),
            ],
            validateWithAbi: false,
            network: getStacksNetwork(),
            fee: 0,
            nonce: 0,
            anchorMode: AnchorMode.Any,
          };
          transaction = await makeUnsignedContractCall(dummyStackingTx);
          break;
        }
        case RosettaOperationType.DelegateStx: {
          if (!options.amount) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }
          if (!options.delegate_to) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
            return;
          }

          const poxAddrOptionalCV = options.pox_addr
            ? someCV(poxAddressToTuple(options.pox_addr))
            : noneCV();

          // dummy transaction to calculate size
          const dummyDelegateStxTx: UnsignedContractCallOptions = {
            publicKey: '000000000000000000000000000000000000000000000000000000000000000000',
            contractAddress: 'ST000000000000000000002AMW42H',
            contractName: 'pox',
            functionName: 'delegate-stx',
            functionArgs: [
              uintCV(options.amount),
              standardPrincipalCV(options.delegate_to),
              noneCV(),
              poxAddrOptionalCV,
            ],
            validateWithAbi: false,
            network: getStacksNetwork(),
            fee: 0,
            nonce: 0,
            anchorMode: AnchorMode.Any,
          };
          transaction = await makeUnsignedContractCall(dummyDelegateStxTx);
          break;
        }
        default:
          res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
          return;
      }

      options.size = transaction.serialize().byteLength;
      options.memo = req.body.metadata?.memo;

      const rosettaPreprocessResponse: RosettaConstructionPreprocessResponse = {
        options,
        required_public_keys: [{ address: options.sender_address as string }],
      };
      res.json(rosettaPreprocessResponse);
    })
  );

  //construction/metadata endpoint
  router.post(
    '/metadata',
    makeValidationMiddleware(chainId),
    asyncHandler(async (req, res) => {
      const request: RosettaConstructionMetadataRequest = req.body;
      const options: RosettaOptions = request.options;

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
      switch (options.type as RosettaOperationType) {
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
          // Getting PoX info
          const poxInfo = await stackingRpc.getPoxInfo();
          const poxOperationInfo = await stackingRpc.getPoxOperationInfo();
          // todo: update stacks.js once released to use the latest stacking contract
          const contract = await stackingRpc.getStackingContract(poxOperationInfo);
          const [contractAddress, contractName] = contract.split('.');

          let burnBlockHeight = poxInfo.current_burnchain_block_height;
          // In Stacks 2.1, the burn block height is included in `/v2/pox` so we can skip the extra network request
          burnBlockHeight ??= (await new StacksCoreRpcClient().getInfo()).burn_block_height;

          options.contract_address = contractAddress;
          options.contract_name = contractName;
          options.burn_block_height = burnBlockHeight;
          break;
        }
        case RosettaOperationType.DelegateStx: {
          // Delegate stacking
          const contract = await stackingRpc.getStackingContract();
          const [contractAddress, contractName] = contract.split('.');
          options.contract_address = contractAddress;
          options.contract_name = contractName;
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

      let recentBlockHash = undefined;
      const blockQuery: FoundOrNot<DbBlock> = await db.getCurrentBlock();
      if (blockQuery.found) {
        recentBlockHash = blockQuery.result.block_hash;
      }

      response = {
        metadata: {
          ...options,
          account_sequence: accountInfo.nonce,
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
      const feeValue = Math.round(Number(feeInfo) * Number(options.size) * 1.5).toString();
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
  router.post('/hash', makeValidationMiddleware(chainId), (req, res) => {
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

    const transaction = deserializeTransaction(new BytesReader(buffer));
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
  });

  //construction/parse endpoint
  router.post(
    '/parse',
    makeValidationMiddleware(chainId),
    asyncHandler(async (req, res) => {
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
        const operations = await getOperations(baseTx, db, chainId);
        const txMemo = parseTransactionMemo(baseTx.token_transfer_memo);
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
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.unknownError]);
      }
    })
  );

  //construction/submit endpoint
  router.post(
    '/submit',
    makeValidationMiddleware(chainId),
    asyncHandler(async (req, res) => {
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
    makeValidationMiddleware(chainId),
    asyncHandler(async (req, res) => {
      const options = getOptionsFromOperations(req.body.operations);
      if (options == null) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        return;
      }

      if (!options.amount) {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidAmount]);
        return;
      }

      if (!options.fee || typeof options.fee !== 'string') {
        res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidFees]);
        return;
      }

      const txFee = BigIntMath.abs(BigInt(options.fee));

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

      const nonce = BigInt(req.body.metadata.account_sequence);

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
      switch (options.type as RosettaOperationType) {
        case RosettaOperationType.TokenTransfer: {
          const recipientAddress = options.token_transfer_recipient_address;
          if (!recipientAddress) {
            res.status(400).json(RosettaErrors[RosettaErrorsTypes.invalidRecipient]);
            return;
          }
          // signel signature
          const tokenTransferOptions: UnsignedTokenTransferOptions = {
            recipient: recipientAddress,
            amount: BigInt(options.amount),
            fee: txFee,
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
          const { version: hashMode, data } = decodeBtcAddress(poxBTCAddress);
          const hashModeBuffer = bufferCV(Buffer.from([hashMode]));
          const hashbytes = bufferCV(data);
          const poxAddressCV = tupleCV({
            hashbytes,
            version: hashModeBuffer,
          });

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
          if (!options.number_of_cycles || !options.amount) {
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
            fee: txFee,
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
            const { version: hashMode, data } = decodeBtcAddress(poxBTCAddress);
            const hashModeBuffer = bufferCV(Buffer.from([hashMode]));
            const hashbytes = bufferCV(data);
            poxAddressCV = someCV(
              tupleCV({
                hashbytes,
                version: hashModeBuffer,
              })
            );
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
          if (!options.delegate_to || !options.amount) {
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
            fee: txFee,
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

      const unsignedTransaction = Buffer.from(transaction.serialize());

      const signer = new TransactionSigner(transaction);

      const prehash = makeSigHashPreSign(signer.sigHash, AuthType.Standard, txFee, nonce);
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
  router.post('/combine', makeValidationMiddleware(chainId), (req, res) => {
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
      transaction = deserializeTransaction(new BytesReader(unsigned_transaction_buffer));
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

    const serializedTx = Buffer.from(transaction.serialize()).toString('hex');

    const combineResponse: RosettaConstructionCombineResponse = {
      signed_transaction: '0x' + serializedTx,
    };

    res.status(200).json(combineResponse);
  });

  return router;
}

// Middleware ==================================================================
function makeValidationMiddleware(chainId: ChainID) {
  return asyncHandler(async function validationMiddleware(req, res, next) {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }
    next();
  });
}
