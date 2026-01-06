import { has0xPrefix, hexToBuffer } from '@hirosystems/api-toolkit';
import { hexToBytes } from '@stacks/common';
import { StacksMainnet, StacksTestnet } from '@stacks/network';
import { StackingClient, decodeBtcAddress, poxAddressToTuple } from '@stacks/stacking';
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
} from '../../../rosetta/types';
import {
  AnchorMode,
  AuthType,
  BytesReader,
  MessageSignature,
  OptionalCV,
  StacksTransaction,
  TransactionSigner,
  UnsignedContractCallOptions,
  UnsignedTokenTransferOptions,
  bufferCV,
  createMessageSignature,
  createStacksPrivateKey,
  deserializeTransaction,
  emptyMessageSignature,
  isSingleSig,
  makeRandomPrivKey,
  makeSigHashPreSign,
  makeUnsignedContractCall,
  makeUnsignedSTXTokenTransfer,
  noneCV,
  principalCV,
  someCV,
  standardPrincipalCV,
  tupleCV,
  uintCV,
} from '@stacks/transactions';
import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@fastify/type-provider-typebox';
import { bitcoinToStacksAddress } from '@hirosystems/stacks-encoding-native-js';
import { StacksCoreRpcClient, getCoreNodeEndpoint } from '../../../core-rpc/client';
import { DbBlock } from '../../../datastore/common';
import { PgStore } from '../../../datastore/pg-store';
import {
  BigIntMath,
  ChainID,
  FoundOrNot,
  doesThrow,
  getChainIDNetwork,
  isValidC32Address,
} from '../../../helpers';
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
import {
  RosettaConstants,
  RosettaErrors,
  RosettaErrorsTypes,
  RosettaOperationType,
} from '../../rosetta-constants';
import { ValidSchema, makeRosettaError, rosettaValidateRequest } from './../../rosetta-validate';
import { randomBytes } from 'node:crypto';

export const RosettaConstructionRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  const db: PgStore = fastify.db;
  const chainId: ChainID = fastify.chainId;
  const stackingOpts = { url: `http://${getCoreNodeEndpoint()}` };
  const stackingRpc = new StackingClient(
    '', // anonymous
    getChainIDNetwork(chainId) == 'mainnet'
      ? new StacksMainnet(stackingOpts)
      : new StacksTestnet(stackingOpts)
  );

  fastify.post<{
    Body: Record<string, any>;
  }>('/derive', async (req, reply) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      //TODO have to fix this and make error generic
      if (valid.error?.includes('must be equal to one of the allowed values')) {
        return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidCurveType]);
      }
      return reply.status(400).send(makeRosettaError(valid));
    }

    const publicKey: RosettaPublicKey = req.body.public_key;
    const network: NetworkIdentifier = req.body.network_identifier;

    if (has0xPrefix(publicKey.hex_bytes)) {
      publicKey.hex_bytes = publicKey.hex_bytes.replace('0x', '');
    }

    try {
      const btcAddress = publicKeyToBitcoinAddress(publicKey.hex_bytes, network.network);
      if (btcAddress === undefined) {
        return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidPublicKey]);
      }
      const stxAddress = bitcoinToStacksAddress(btcAddress);

      const accountIdentifier: RosettaAccountIdentifier = {
        address: stxAddress,
      };
      const response: RosettaConstructionDeriveResponse = {
        account_identifier: accountIdentifier,
      };
      await reply.send(response);
    } catch (_err) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidPublicKey]);
    }
  });

  fastify.post<{
    Body: Record<string, any>;
  }>('/preprocess', async (req, reply) => {
    const valid = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      return reply.status(400).send(makeRosettaError(valid));
    }

    const operations: RosettaOperation[] = req.body.operations;

    // Max operations should be 3 for one transaction
    if (operations.length > 3) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
    }

    if (!isSymbolSupported(operations)) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidCurrencySymbol]);
    }

    if (!isDecimalsSupported(operations)) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidCurrencyDecimals]);
    }

    const options = getOptionsFromOperations(operations);
    if (options == null) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
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
        return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidFee]);
      }
    }

    let transaction: StacksTransaction;
    switch (options.type as RosettaOperationType) {
      case RosettaOperationType.TokenTransfer: {
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
      }
      case RosettaOperationType.StackStx: {
        const poxContract = await stackingRpc.getStackingContract();
        const [contractAddress, contractName] = poxContract.split('.');
        const isPox4 = contractName === 'pox-4';

        const poxAddr = options.pox_addr;
        if (!options.number_of_cycles || !poxAddr) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        }

        if (isPox4 && !options.signer_key) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        }

        if (doesThrow(() => decodeBtcAddress(poxAddr))) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        }

        if (!options.amount) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        }

        // dummy transaction to calculate size
        let dummyStackingTx: UnsignedContractCallOptions;
        if (isPox4) {
          const signerPrivKey = makeRandomPrivKey();
          const signerSig = hexToBytes(
            stackingRpc.signPoxSignature({
              topic: 'stack-stx',
              poxAddress: poxAddr,
              rewardCycle: 0,
              period: options.number_of_cycles ?? 1,
              signerPrivateKey: signerPrivKey,
              maxAmount: options.pox_max_amount ?? options.amount ?? 1,
              authId: options.pox_auth_id ?? 0,
            })
          );
          dummyStackingTx = {
            publicKey: '000000000000000000000000000000000000000000000000000000000000000000',
            contractAddress: contractAddress,
            contractName: contractName,
            functionName: 'stack-stx',
            functionArgs: [
              uintCV(options.amount), // amount-ustx
              poxAddressToTuple(poxAddr), // pox-addr
              uintCV(0), // start-burn-ht
              uintCV(options.number_of_cycles ?? 1), // lock-period
              someCV(bufferCV(signerSig)), // signer-sig
              bufferCV(hexToBytes(options.signer_key as string)), // signer-key
              uintCV(options.pox_max_amount ?? options.amount ?? 1), // max-amount
              uintCV(options.pox_auth_id ?? 0), // auth-id
            ],
            validateWithAbi: false,
            network: getStacksNetwork(),
            fee: 0,
            nonce: 0,
            anchorMode: AnchorMode.Any,
          };
        } else {
          dummyStackingTx = {
            publicKey: '000000000000000000000000000000000000000000000000000000000000000000',
            contractAddress: contractAddress,
            contractName: contractName,
            functionName: 'stack-stx',
            functionArgs: [
              uintCV(options.amount), // amount-ustx
              poxAddressToTuple(poxAddr), // pox-addr
              uintCV(0), // start-burn-ht
              uintCV(options.number_of_cycles), // lock-period
            ],
            validateWithAbi: false,
            network: getStacksNetwork(),
            fee: 0,
            nonce: 0,
            anchorMode: AnchorMode.Any,
          };
        }
        transaction = await makeUnsignedContractCall(dummyStackingTx);
        break;
      }
      case RosettaOperationType.DelegateStx: {
        if (!options.amount || !options.delegate_to) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
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
        return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
    }

    options.size = transaction.serialize().byteLength;
    options.memo = req.body.metadata?.memo;

    const rosettaPreprocessResponse: RosettaConstructionPreprocessResponse = {
      options,
      required_public_keys: [{ address: options.sender_address as string }],
    };
    await reply.send(rosettaPreprocessResponse);
  });

  fastify.post<{
    Body: Record<string, any>;
  }>('/metadata', async (req, reply) => {
    const valid = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      return reply.status(400).send(makeRosettaError(valid));
    }

    const request: RosettaConstructionMetadataRequest = req.body as any;
    const options: RosettaOptions | undefined = request.options;

    let dummyTransaction: StacksTransaction;

    if (options?.sender_address && !isValidC32Address(options.sender_address)) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidSender]);
    }
    if (options?.symbol !== RosettaConstants.symbol) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidCurrencySymbol]);
    }

    if (!options?.fee && options?.size === undefined) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.missingTransactionSize]);
    }

    let response = {} as RosettaConstructionMetadataResponse;
    switch (options.type as RosettaOperationType) {
      case RosettaOperationType.TokenTransfer: {
        const recipientAddress = options.token_transfer_recipient_address;
        if (options?.decimals !== RosettaConstants.decimals) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidCurrencyDecimals]);
        }

        if (recipientAddress == null || !isValidC32Address(recipientAddress)) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidRecipient]);
        }

        const dummyTokenTransferTx: UnsignedTokenTransferOptions = {
          recipient: recipientAddress,
          amount: 1n, // placeholder
          publicKey: '000000000000000000000000000000000000000000000000000000000000000000', // placeholder
          network: getStacksNetwork(),
          nonce: 0, // placeholder
          memo: '123456', // placeholder
          anchorMode: AnchorMode.Any,
        };
        // Do not set fee so that the fee is calculated
        dummyTransaction = await makeUnsignedSTXTokenTransfer(dummyTokenTransferTx);

        break;
      }
      case RosettaOperationType.StackStx: {
        // Getting PoX info
        const poxInfo = await stackingRpc.getPoxInfo();
        const [contractAddress, contractName] = poxInfo.contract_id.split('.');

        if (!options.number_of_cycles || !options.pox_addr) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        }

        let burnBlockHeight = options?.burn_block_height ?? poxInfo.current_burnchain_block_height;
        // In Stacks 2.1, the burn block height is included in `/v2/pox` so we can skip the extra network request
        burnBlockHeight ??= (await new StacksCoreRpcClient().getInfo()).burn_block_height;

        options.contract_address = contractAddress;
        options.contract_name = contractName;
        options.burn_block_height = burnBlockHeight;
        options.reward_cycle_id ??= poxInfo.current_cycle.id;

        // dummy transaction to calculate fee
        let dummyStackingTx: UnsignedContractCallOptions;
        const poxAddr = options?.pox_addr;
        if (contractName === 'pox-4') {
          // fields required for pox4
          if (!options.signer_key) {
            return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
          }
          options.pox_auth_id ??= BigInt(`0x${randomBytes(16).toString('hex')}`).toString();
          let signerSigCV: OptionalCV = noneCV();
          if (options.signer_signature) {
            signerSigCV = someCV(bufferCV(hexToBytes(options.signer_signature)));
          } else if (options.signer_private_key) {
            const signerSig = stackingRpc.signPoxSignature({
              topic: 'stack-stx',
              poxAddress: poxAddr,
              rewardCycle: options.reward_cycle_id,
              period: options.number_of_cycles,
              signerPrivateKey: createStacksPrivateKey(options.signer_private_key),
              maxAmount: (options.pox_max_amount ?? options.amount) as string,
              authId: options.pox_auth_id,
            });
            options.signer_signature = signerSig;
            signerSigCV = someCV(bufferCV(hexToBytes(signerSig)));
          }
          dummyStackingTx = {
            publicKey: '000000000000000000000000000000000000000000000000000000000000000000',
            contractAddress: contractAddress,
            contractName: contractName,
            functionName: 'stack-stx',
            functionArgs: [
              uintCV(0), // amount-ustx
              poxAddressToTuple(poxAddr), // pox-addr
              uintCV(options?.burn_block_height ?? 0), // start-burn-ht
              uintCV(options?.number_of_cycles ?? 0), // lock-period
              signerSigCV, // signer-sig
              bufferCV(hexToBytes(options.signer_key)), // signer-key
              uintCV(options?.pox_max_amount ?? options?.amount ?? 1), // max-amount
              uintCV(options?.pox_auth_id ?? 0), // auth-id
            ],
            validateWithAbi: false,
            network: getStacksNetwork(),
            nonce: 0,
            anchorMode: AnchorMode.Any,
          };
        } else {
          dummyStackingTx = {
            publicKey: '000000000000000000000000000000000000000000000000000000000000000000',
            contractAddress: contractAddress,
            contractName: contractName,
            functionName: 'stack-stx',
            functionArgs: [
              uintCV(0),
              poxAddressToTuple(poxAddr), // placeholder
              uintCV(0),
              uintCV(1),
            ],
            validateWithAbi: false,
            network: getStacksNetwork(),
            nonce: 0,
            anchorMode: AnchorMode.Any,
          };
        }
        // Do not set fee so that the fee is calculated
        dummyTransaction = await makeUnsignedContractCall(dummyStackingTx);

        break;
      }
      case RosettaOperationType.DelegateStx: {
        // Delegate stacking
        const contract = await stackingRpc.getStackingContract();
        const [contractAddress, contractName] = contract.split('.');
        options.contract_address = contractAddress;
        options.contract_name = contractName;

        // dummy transaction to calculate fee
        const dummyDelegateStxTx: UnsignedContractCallOptions = {
          publicKey: '000000000000000000000000000000000000000000000000000000000000000000',
          contractAddress: 'ST000000000000000000002AMW42H',
          contractName: 'pox',
          functionName: 'delegate-stx',
          functionArgs: [
            uintCV(1), // placeholder
            principalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159.some-contract-name-v1-2-3-4'), // placeholder,
            someCV(uintCV(1)), // placeholder
            someCV(poxAddressToTuple('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')), // placeholder
          ],
          validateWithAbi: false,
          network: getStacksNetwork(),
          nonce: 0,
          anchorMode: AnchorMode.Any,
        };
        // Do not set fee so that the fee is calculated
        dummyTransaction = await makeUnsignedContractCall(dummyDelegateStxTx);

        break;
      }
      default:
        return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidTransactionType]);
    }

    if (typeof options?.sender_address === 'undefined') {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.missingSenderAddress]);
    }
    const stxAddress = options.sender_address;

    const accountInfo = await new StacksCoreRpcClient().getAccount(stxAddress);

    let recentBlockHash: string | undefined;
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
    const feeValue = dummyTransaction.auth.spendingCondition.fee.toString();
    if (feeValue === undefined || feeValue === '0') {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidFee]);
    }

    if (!options.size) {
      return reply.status(400).send(RosettaErrorsTypes.missingTransactionSize);
    }

    const currency: RosettaCurrency = {
      symbol: RosettaConstants.symbol,
      decimals: RosettaConstants.decimals,
    };

    const fee: RosettaAmount = {
      value: feeValue,
      currency,
    };

    response.suggested_fee = [fee];

    await reply.send(response);
  });

  //construction/hash endpoint
  fastify.post<{
    Body: Record<string, any>;
  }>('/hash', async (req, reply) => {
    const valid = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      return reply.status(400).send(makeRosettaError(valid));
    }

    const request: RosettaConstructionHashRequest = req.body as any;

    if (!has0xPrefix(request.signed_transaction)) {
      request.signed_transaction = '0x' + request.signed_transaction;
    }

    let buffer: Buffer;
    try {
      buffer = hexToBuffer(request.signed_transaction);
    } catch (error) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidTransactionString]);
    }

    const transaction = deserializeTransaction(new BytesReader(buffer));
    const hash = transaction.txid();

    if (!transaction.auth.spendingCondition) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.transactionNotSigned]);
    }
    if (isSingleSig(transaction.auth.spendingCondition)) {
      /**Single signature Transaction has an empty signature, so the transaction is not signed */
      if (
        !transaction.auth.spendingCondition.signature.data ||
        emptyMessageSignature().data === transaction.auth.spendingCondition.signature.data
      ) {
        return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.transactionNotSigned]);
      }
    } else {
      /**Multi-signature transaction does not have signature fields thus the transaction not signed */
      if (transaction.auth.spendingCondition.fields.length === 0) {
        return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.transactionNotSigned]);
      }
    }

    const hashResponse: RosettaConstructionHashResponse = {
      transaction_identifier: {
        hash: '0x' + hash,
      },
    };
    await reply.send(hashResponse);
  });

  fastify.post<{
    Body: Record<string, any>;
  }>('/parse', async (req, reply) => {
    const valid = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      return reply.status(400).send(makeRosettaError(valid));
    }

    let inputTx = req.body.transaction;
    const signed = req.body.signed;

    if (!has0xPrefix(inputTx)) {
      inputTx = '0x' + inputTx;
    }

    const transaction = rawTxToStacksTransaction(inputTx);
    const checkSigned = isSignedTransaction(transaction);
    if (signed != checkSigned) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidParams]);
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
      await reply.send(response);
    } catch (error) {
      console.error(error);
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.unknownError]);
    }
  });

  fastify.post<{
    Body: Record<string, any>;
  }>('/submit', async (req, reply) => {
    const valid = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      return reply.status(400).send(makeRosettaError(valid));
    }

    let transaction = req.body.signed_transaction;
    let buffer: Buffer;

    if (!has0xPrefix(transaction)) {
      transaction = '0x' + transaction;
    }

    try {
      buffer = hexToBuffer(transaction);
    } catch (_error) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidTransactionString]);
    }
    try {
      const submitResult = await new StacksCoreRpcClient().sendTransaction(buffer);
      const response: RosettaConstructionSubmitResponse = {
        transaction_identifier: {
          hash: submitResult.txId,
        },
      };
      return reply.status(200).send(response);
    } catch (e: any) {
      const err: RosettaError = {
        ...RosettaErrors[RosettaErrorsTypes.invalidTransactionString],
        details: { message: e.message },
      };
      return reply.status(400).send(err);
    }
  });

  //construction/payloads endpoint
  fastify.post<{
    Body: Record<string, any>;
  }>('/payloads', async (req, reply) => {
    const valid = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      return reply.status(400).send(makeRosettaError(valid));
    }

    const options = getOptionsFromOperations(req.body.operations);
    if (options == null) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
    }

    if (!options.amount) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidAmount]);
    }

    if (!options.fee || typeof options.fee !== 'string') {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidFees]);
    }

    const txFee = BigIntMath.abs(BigInt(options.fee));

    const publicKeys: RosettaPublicKey[] = req.body.public_keys;
    if (!publicKeys) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.emptyPublicKey]);
    }

    const senderAddress = options.sender_address;
    if (!senderAddress) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidSender]);
    }

    if (!('metadata' in req.body) || !('account_sequence' in req.body.metadata)) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.missingNonce]);
    }

    const nonce = BigInt(req.body.metadata.account_sequence);

    if (publicKeys.length !== 1) {
      //TODO support multi-sig in the future.
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.needOnePublicKey]);
    }

    if (publicKeys[0].curve_type !== 'secp256k1') {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidCurveType]);
    }

    if (has0xPrefix(publicKeys[0].hex_bytes)) {
      publicKeys[0].hex_bytes = publicKeys[0].hex_bytes.slice(2);
    }

    let transaction: StacksTransaction;
    switch (options.type as RosettaOperationType) {
      case RosettaOperationType.TokenTransfer: {
        const recipientAddress = options.token_transfer_recipient_address;
        if (!recipientAddress) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidRecipient]);
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
        const contractAddress = options.contract_address ?? req.body.metadata.contract_address;
        const contractName = options.contract_name ?? req.body.metadata.contract_name;
        const poxAddr = options.pox_addr ?? req.body.metadata.pox_addr;
        const burnBlockHeight = options.burn_block_height ?? req.body.metadata.burn_block_height;
        const numberOfCycles = options.number_of_cycles ?? req.body.metadata.number_of_cycles;

        // pox4 fields
        const authID = options.pox_auth_id ?? req.body.metadata.pox_auth_id;
        const signerKey = options.signer_key ?? req.body.metadata.signer_key;
        const rewardCycleID = options.reward_cycle_id ?? req.body.metadata.reward_cycle_id;
        const poxMaxAmount =
          options.pox_max_amount ?? req.body.metadata.pox_max_amount ?? options.amount;
        const signerSignature = options.signer_signature ?? req.body.metadata.signer_signature;

        if (!poxAddr) {
          return reply.status(400).send(RosettaErrorsTypes.invalidOperation);
        }

        if (!contractAddress) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.missingContractAddress]);
        }
        if (!contractName) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.missingContractName]);
        }
        if (!burnBlockHeight) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        }
        if (!numberOfCycles || !options.amount) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        }

        const isPox4 = contractName === 'pox-4';
        // fields required for pox4
        if (isPox4 && (!signerKey || !poxMaxAmount || !rewardCycleID || !authID)) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
        }

        let stackingTx: UnsignedContractCallOptions;
        if (isPox4) {
          stackingTx = {
            contractAddress: contractAddress,
            contractName: contractName,
            functionName: 'stack-stx',
            publicKey: publicKeys[0].hex_bytes,
            functionArgs: [
              uintCV(options.amount), // amount-ustx
              poxAddressToTuple(poxAddr), // pox-addr
              uintCV(burnBlockHeight), // start-burn-ht
              uintCV(numberOfCycles), // lock-period
              signerSignature ? someCV(bufferCV(hexToBytes(signerSignature))) : noneCV(), // signer-sig
              bufferCV(hexToBytes(signerKey)), // signer-key
              uintCV(poxMaxAmount), // max-amount
              uintCV(authID), // auth-id
            ],
            fee: txFee,
            nonce: nonce,
            validateWithAbi: false,
            network: getStacksNetwork(),
            anchorMode: AnchorMode.Any,
          };
        } else {
          stackingTx = {
            contractAddress: req.body.metadata.contract_address,
            contractName: req.body.metadata.contract_name,
            functionName: 'stack-stx',
            publicKey: publicKeys[0].hex_bytes,
            functionArgs: [
              uintCV(options.amount),
              poxAddressToTuple(poxAddr),
              uintCV(burnBlockHeight),
              uintCV(numberOfCycles),
            ],
            fee: txFee,
            nonce: nonce,
            validateWithAbi: false,
            network: getStacksNetwork(),
            anchorMode: AnchorMode.Any,
          };
        }
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
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.missingContractAddress]);
        }
        if (!req.body.metadata.contract_name) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.missingContractName]);
        }

        let expire_burn_block_heightCV: OptionalCV = noneCV();
        if (req.body.metadata.burn_block_height) {
          const burn_block_height = req.body.metadata.burn_block_height;
          if (typeof burn_block_height !== 'number' || typeof burn_block_height !== 'string')
            expire_burn_block_heightCV = someCV(uintCV(burn_block_height));
        }
        if (!options.delegate_to || !options.amount) {
          return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
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
        return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidOperation]);
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
    await reply.send(response);
  });

  //construction/combine endpoint
  fastify.post<{
    Body: Record<string, any>;
  }>('/combine', async (req, reply) => {
    const valid = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      return reply.status(400).send(makeRosettaError(valid));
    }

    const combineRequest: RosettaConstructionCombineRequest = req.body as any;
    const signatures = combineRequest.signatures;

    if (!has0xPrefix(combineRequest.unsigned_transaction)) {
      combineRequest.unsigned_transaction = '0x' + combineRequest.unsigned_transaction;
    }

    if (signatures.length === 0) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.noSignatures]);
    }

    let unsigned_transaction_buffer: Buffer;
    let transaction: StacksTransaction;

    try {
      unsigned_transaction_buffer = hexToBuffer(combineRequest.unsigned_transaction);
      transaction = deserializeTransaction(new BytesReader(unsigned_transaction_buffer));
    } catch (e) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidTransactionString]);
    }

    if (signatures.length !== 1) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.needOnlyOneSignature]);
    }

    if (signatures[0].public_key.curve_type !== 'secp256k1') {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidCurveType]);
    }
    const preSignHash = makePresignHash(transaction);
    if (!preSignHash) {
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidTransactionString]);
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
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.invalidSignature]);
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
      return reply.status(400).send(RosettaErrors[RosettaErrorsTypes.signatureNotVerified]);
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

    await reply.send(combineResponse);
  });

  await Promise.resolve();
};
