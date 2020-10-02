import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as BN from 'bn.js';
import {
  NetworkIdentifier,
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
  RosettaConstructionPreprocessRequest,
  RosettaConstructionMetadataRequest,
  RosettaConstructionPayloadResponse,
} from '@blockstack/stacks-blockchain-api-types';
import {
  emptyMessageSignature,
  isSingleSig,
} from '@blockstack/stacks-transactions/lib/authorization';
import { BufferReader } from '@blockstack/stacks-transactions/lib/bufferReader';
import { deserializeTransaction } from '@blockstack/stacks-transactions/lib/transaction';
import {
  UnsignedTokenTransferOptions,
  makeUnsignedSTXTokenTransfer,
} from '@blockstack/stacks-transactions';
import * as express from 'express';
import { StacksCoreRpcClient } from '../../../core-rpc/client';
import { DataStore, DbBlock } from '../../../datastore/common';
import { FoundOrNot, hexToBuffer, isValidC32Address, digestSha512_256 } from '../../../helpers';
import { RosettaConstants, RosettaErrors } from '../../rosetta-constants';
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
  GetStacksTestnetNetwork,
} from './../../../rosetta-helpers';
import { makeRosettaError, rosettaValidateRequest, ValidSchema } from './../../rosetta-validate';

export function createRosettaConstructionRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  //construction/derive endpoint
  router.postAsync('/derive', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      //TODO have to fix this and make error generic
      if (valid.error?.includes('should be equal to one of the allowed values')) {
        res.status(400).json(RosettaErrors.invalidCurveType);
      }
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const publicKey: RosettaPublicKey = req.body.public_key;
    const network: NetworkIdentifier = req.body.network_identifier;

    try {
      const btcAddress = publicKeyToBitcoinAddress(publicKey.hex_bytes, network.network);
      if (btcAddress === undefined) {
        res.status(400).json(RosettaErrors.invalidPublicKey);
        return;
      }
      const stxAddress = bitcoinAddressToSTXAddress(btcAddress);

      const response: RosettaConstructionDeriveResponse = {
        address: stxAddress,
      };
      res.json(response);
    } catch (e) {
      res.status(400).json(RosettaErrors.invalidPublicKey);
    }
  });

  //construction/preprocess endpoint
  router.postAsync('/preprocess', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const operations: RosettaOperation[] = req.body.operations;

    // We are only supporting transfer, we should have operations length = 3
    if (operations.length != 3) {
      res.status(400).json(RosettaErrors.invalidOperation);
      return;
    }

    if (!isSymbolSupported(req.body.operations)) {
      res.status(400).json(RosettaErrors.invalidCurrencySymbol);
      return;
    }

    if (!isDecimalsSupported(req.body.operations)) {
      res.status(400).json(RosettaErrors.invalidCurrencyDecimals);
      return;
    }

    const options = getOptionsFromOperations(req.body.operations);
    if (options == null) {
      res.status(400).json(RosettaErrors.invalidOperation);
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
        res.status(400).json(RosettaErrors.invalidFee);
        return;
      }
    }

    const rosettaPreprocessResponse: RosettaConstructionPreprocessResponse = {
      options,
      required_public_keys: {
        address: options.sender_address as string,
      },
    };

    res.json(rosettaPreprocessResponse);
  });

  //construction/metadata endpoint
  router.postAsync('/metadata', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const request: RosettaConstructionMetadataRequest = req.body;
    const options: RosettaOptions = req.body.options;
    if (options.type != 'token_transfer') {
      res.status(400).json(RosettaErrors.invalidTransactionType);
      return;
    }

    if (options?.sender_address && !isValidC32Address(options.sender_address)) {
      res.status(400).json(RosettaErrors.invalidSender);
      return;
    }
    if (options?.symbol !== RosettaConstants.symbol) {
      res.status(400).json(RosettaErrors.invalidCurrencySymbol);
      return;
    }

    const recipientAddress = options.token_transfer_recipient_address;
    if (options?.decimals !== RosettaConstants.decimals) {
      res.status(400).json(RosettaErrors.invalidCurrencyDecimals);
      return;
    }

    if (recipientAddress == null || !isValidC32Address(recipientAddress)) {
      res.status(400).json(RosettaErrors.invalidRecipient);
      return;
    }

    if (request.public_keys && request.public_keys.length > 0) {
      const publicKey: RosettaPublicKey = request.public_keys[0];
      try {
        const btcAddress = publicKeyToBitcoinAddress(
          publicKey.hex_bytes,
          request.network_identifier.network
        );
        if (btcAddress === undefined) {
          res.status(400).json(RosettaErrors.invalidPublicKey);
          return;
        }
        const stxAddress = bitcoinAddressToSTXAddress(btcAddress);

        if (stxAddress !== options.sender_address) {
          res.status(400).json(RosettaErrors.invalidPublicKey);
          return;
        }
      } catch (e) {
        res.status(400).json(RosettaErrors.invalidPublicKey);
        return;
      }
    }

    const accountInfo = await new StacksCoreRpcClient().getAccount(recipientAddress);
    const nonce = accountInfo.nonce;

    let recentBlockHash = undefined;
    const blockQuery: FoundOrNot<DbBlock> = await db.getCurrentBlock();
    if (blockQuery.found) {
      recentBlockHash = blockQuery.result.block_hash;
    }

    const response: RosettaConstructionMetadataResponse = {
      metadata: {
        ...req.body.options,
        account_sequence: nonce,
        recent_block_hash: recentBlockHash,
      },
    };

    res.json(response);
  });

  //construction/hash endpoint
  router.postAsync('/hash', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const request: RosettaConstructionHashRequest = req.body;

    let buffer: Buffer;
    try {
      buffer = hexToBuffer(request.signed_transaction);
    } catch (error) {
      res.status(400).json(RosettaErrors.invalidTransactionString);
      return;
    }

    const transaction = deserializeTransaction(BufferReader.fromBuffer(buffer));
    const hash = transaction.txid();

    if (!transaction.auth.spendingCondition) {
      res.status(400).json(RosettaErrors.transactionNotSigned);
      return;
    }
    if (isSingleSig(transaction.auth.spendingCondition)) {
      /**Single signature Transaction has an empty signature, so the transaction is not signed */
      if (
        !transaction.auth.spendingCondition.signature.data ||
        emptyMessageSignature().data === transaction.auth.spendingCondition.signature.data
      ) {
        res.status(400).json(RosettaErrors.transactionNotSigned);
        return;
      }
    } else {
      /**Multi-signature transaction does not have signature fields thus the transaction not signed */
      if (transaction.auth.spendingCondition.fields.length === 0) {
        res.status(400).json(RosettaErrors.transactionNotSigned);
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
  router.postAsync('/parse', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }
    const inputTx = req.body.transaction;
    const signed = req.body.signed;
    const transaction = rawTxToStacksTransaction(inputTx);
    const checkSigned = isSignedTransaction(transaction);
    if (signed != checkSigned) {
      res.status(400).json(RosettaErrors.invalidParams);
      return;
    }
    const operations = getOperations(rawTxToBaseTx(inputTx));
    if (signed) {
      res.json({
        operations: operations,
        account_identifier_signers: getSigners(transaction),
      });
    } else {
      res.json({
        operations: operations,
      });
    }
  });

  //construction/submit endpoint
  router.postAsync('/submit', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }
    const transaction = req.body.signed_transaction;
    let buffer: Buffer;
    try {
      buffer = hexToBuffer(transaction);
    } catch (error) {
      res.status(400).json(RosettaErrors.invalidTransactionString);
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
    } catch {
      res.status(400).json(RosettaErrors.invalidTransactionString);
    }
  });

  //construction/payloads endpoint
  router.postAsync('/payloads', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const options = getOptionsFromOperations(req.body.operations);
    if (options == null) {
      res.status(400).json(RosettaErrors.invalidOperation);
      return;
    }

    const amount = options.amount;
    if (!amount) {
      res.status(400).json(RosettaErrors.invalidAmount);
      return;
    }

    const fees = options.fee;
    if (!fees) {
      res.status(400).json(RosettaErrors.invalidFees);
      return;
    }

    const publicKeys: RosettaPublicKey[] = req.body.public_keys;
    if (!publicKeys) {
      res.status(400).json(RosettaErrors.emptyPublicKey);
      return;
    }

    if (publicKeys[0].curve_type !== 'secp256k1') {
      res.status(400).json(RosettaErrors.invalidCurveType);
      return;
    }

    const recipientAddress = options.token_transfer_recipient_address
      ? options.token_transfer_recipient_address
      : '';
    const senderAddress = options.sender_address ? options.sender_address : '';

    const accountInfo = await new StacksCoreRpcClient().getAccount(senderAddress);

    const tokenTransferOptions: UnsignedTokenTransferOptions = {
      recipient: recipientAddress,
      amount: new BN(amount),
      fee: new BN(fees),
      publicKey: publicKeys[0].hex_bytes,
      network: GetStacksTestnetNetwork(),
      nonce: accountInfo.nonce ? new BN(accountInfo.nonce) : new BN(0),
    };

    const transaction = await makeUnsignedSTXTokenTransfer(tokenTransferOptions);
    const unsignedTransaction = transaction.serialize();
    const hexBytes = digestSha512_256(unsignedTransaction).toString('hex');
    const response: RosettaConstructionPayloadResponse = {
      unsigned_transaction: unsignedTransaction.toString('hex'),
      payloads: [
        {
          address: senderAddress,
          hex_bytes: '0x' + hexBytes,
          signature_type: 'ecdsa',
        },
      ],
    };
    res.json(response);
  });

  //construction/combine endpoint
  router.postAsync('combine', async (req, res) => {});

  return router;
}
