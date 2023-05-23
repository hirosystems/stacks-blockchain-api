import * as supertest from 'supertest';
import {
  makeContractCall,
  NonFungibleConditionCode,
  FungibleConditionCode,
  bufferCVFromString,
  ClarityAbi,
  ClarityType,
  makeContractDeploy,
  sponsorTransaction,
  createNonFungiblePostCondition,
  createFungiblePostCondition,
  createSTXPostCondition,
  ChainID,
  AnchorMode,
  uintCV,
  pubKeyfromPrivKey,
  publicKeyToAddress,
  AddressVersion,
  bufferCV,
} from '@stacks/transactions';
import { createClarityValueArray } from '../stacks-encoding-helpers';
import { decodeTransaction, TxPayloadVersionedSmartContract } from 'stacks-encoding-native-js';
import { getTxFromDataStore } from '../api/controllers/db-controller';
import {
  DbBlock,
  DbTxRaw,
  DbTxTypeId,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbNftEvent,
  DbMempoolTxRaw,
  DbSmartContract,
  DbTxStatus,
  DataStoreBlockUpdateData,
  DbTxAnchorMode,
  DbStxEvent,
} from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { bufferToHexPrefixString, I32_MAX } from '../helpers';
import { TestBlockBuilder } from '../test-utils/test-builders';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { createDbTxFromCoreMsg } from '../datastore/helpers';
import { PgSqlClient } from '../datastore/connection';
import { getPagingQueryLimit, ResourceType } from '../api/pagination';

describe('tx tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet, httpLogLevel: 'silly' });
  });

  test('fetch tx list details', async () => {
    const mempoolTx: DbMempoolTxRaw = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: DbTxStatus.Pending,
      receipt_time: 1594307695,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('coinbase hi')),
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    const source_code = `;; pg-mdomains-v1\n;;\n;; Decentralized domain names manager for Paradigma\n;; To facilitate acquisition of Stacks decentralized domain names\n(use-trait sip-010-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait )\n(use-trait token-trait 'SP3YK7KWMYRCDMV5M4792T0T7DERQXHJJGGEPV1N8.paradigma-token-trait-v1.paradigma-token-trait)\n\n\n;; constants\n(define-constant ERR_INSUFFICIENT_FUNDS 101)\n(define-constant ERR_UNAUTHORIZED 109)\n(define-constant ERR_NAME_PREORDER_FUNDS_INSUFFICIENT 203)              ;; transfer to sponsored  \n(define-constant ERR_DOMAINNAME_MANAGER_NOT_FOUND 501)\n\n;; set constant for contract owner, used for updating token-uri\n(define-constant CONTRACT_OWNER tx-sender)\n\n;; initial value for domain wallet, set to this contract until initialized\n(define-data-var domainWallet principal 'SP3YK7KWMYRCDMV5M4792T0T7DERQXHJJGGEPV1N8)\n\n(define-data-var platformDomainWallet principal 'SPRK2JVQ988PYT19JSAJNR3K9YZAZGVY04XMC2Z7)  ;; Wallet where to transfer share fee services\n\n;; Manage domain name service fees\n;;  by accepted tokens\n(define-map DomainServiceFeeIndex\n   {\n     serviceId: uint\n   }\n   {\n     tokenSymbol: (string-ascii 32),\n   }  \n)\n\n(define-read-only (get-domain-service-fee-index (id uint))\n     (map-get? DomainServiceFeeIndex\n        {\n            serviceId: id\n        }\n     ) \n)\n\n(define-map DomainServiceFee\n   {\n     tokenSymbol: (string-ascii 32),\n   }\n   {\n     fee: uint\n   }\n)\n(define-read-only (get-domain-service-fee (tokenSymbol (string-ascii 32)))\n  (unwrap-panic (get fee \n                  (map-get? DomainServiceFee\n                     {tokenSymbol: tokenSymbol}\n                  )\n                )\n  )\n)\n(define-data-var domainServiceFeeCount uint u0)\n(define-read-only (get-domain-service-fee-count)\n  (var-get domainServiceFeeCount)\n)\n\n;; Set reference info for domain service fee\n;; protected function to update domain service fee variable\n(define-public (create-domain-service-fee \n                            (tokenSymbol (string-ascii 32))\n                            (fee uint) \n                )\n  (begin\n    (if (is-authorized-domain) \n      (if\n        (is-none \n          (map-get? DomainServiceFee\n             {\n                tokenSymbol: tokenSymbol\n             }\n          )       \n        )\n        (begin\n          (var-set domainServiceFeeCount (+ (var-get domainServiceFeeCount) u1))\n          (map-insert DomainServiceFeeIndex\n          { \n            serviceId: (var-get domainServiceFeeCount)\n          }\n           {\n            tokenSymbol: tokenSymbol\n           } \n          )\n          (map-insert DomainServiceFee \n           {\n             tokenSymbol: tokenSymbol\n           } \n           {\n             fee: fee\n           }\n          ) \n         (ok true)\n        )\n        (begin\n         (ok \n          (map-set DomainServiceFee \n           {\n            tokenSymbol: tokenSymbol\n           } \n           {\n             fee: fee\n           }\n          )\n         )\n        )\n      )\n      (err ERR_UNAUTHORIZED)\n    )\n  )\n)\n\n;; check if contract caller is contract owner\n(define-private (is-authorized-owner)\n  (is-eq contract-caller CONTRACT_OWNER)\n)\n\n;; Token flow management\n\n;; Stores participants DomainName service sell\n\n;; (define-data-var domainNameManagerCount -list (list 2000 uint) (list))\n\n(define-data-var domainNameManagerCount uint u0)\n\n(define-read-only (get-domain-name-manager-count)\n  (var-get domainNameManagerCount)\n)\n(define-map DomainNameManagersIndex\n  { domainNMId: uint }\n  {\n   nameSpace: (buff 48),                  ;; domain namespace defined in Blockchain Name Service (BNS) like .app\n   domainName: (buff 48)                  ;; domain name under a namespace like xck in xck.app\n  }\n)\n\n(define-read-only (get-domain-name-managers-index (id uint))\n     (map-get? DomainNameManagersIndex\n        {\n            domainNMId: id\n        }\n     ) \n)\n\n(define-map DomainNameManagers\n  {\n   nameSpace: (buff 48),                  ;; domain namespace defined in Blockchain Name Service (BNS) like .app\n   domainName: (buff 48)                  ;; domain name under a namespace like xck in xck.app\n  }\n  {\n    domainNameWallet: principal,           ;; DomainName manager account - branding and domainName token\n    domainNameFeePerc: uint,               ;; DomainName share percentage of fee (ie u10)\n    domainNameFeeTokenMint: uint,          ;; Tokens considered reciprocity to domainName token\n    domainNameTokenSymbol: (string-utf8 5), ;; Token Symbol used to mint domainName token\n    sponsoredWallet: principal,            ;; Sponsored institution account\n    sponsoredFeePerc: uint,                ;; Sponsored share percentage of fee (ie u10)\n    sponsoredDID: (string-utf8 256),       ;; Sponsored Stacks ID\n    sponsoredUri: (string-utf8 256),       ;; Sponsored website Uri\n    referencerFeeTokenMint: uint           ;; Tokens for promoters references as reciprocity \n  }\n)\n\n;; returns set domain wallet principal\n(define-read-only (get-domain-wallet)\n  (var-get domainWallet)\n)\n\n;; checks if caller is Auth contract\n(define-private (is-authorized-auth)   \n  (is-eq contract-caller 'SP3YK7KWMYRCDMV5M4792T0T7DERQXHJJGGEPV1N8)\n) \n\n;; protected function to update domain wallet variable\n(define-public (set-domain-wallet (newDomainWallet principal))\n  (begin\n    (asserts! (is-authorized-auth) (err ERR_UNAUTHORIZED))  \n    (ok (var-set domainWallet newDomainWallet))\n  )\n)\n\n;; check if contract caller is domain wallet\n(define-private (is-authorized-domain)\n    (is-eq contract-caller (var-get domainWallet))\n)\n\n;; Set reference info for domainName managers\n(define-public (create-domainname-manager \n                            (nameSpace (buff 48))\n                            (domainName (buff 48)) \n                            (domainNameWallet principal) \n                            (domainNameFeePerc uint) \n                            (domainNameFeeTokenMint uint) \n                            (tokenSymbol (string-utf8 5))\n                            (sponsoredWallet principal) \n                            (sponsoredFeePerc uint)\n                            (sponsoredDID (string-utf8 256))\n                            (sponsoredUri (string-utf8 256))\n                            (referencerFeeTokenMint uint)\n                )\n  (begin\n    (if (is-authorized-domain) \n      (if\n        (is-none \n           (map-get? DomainNameManagers \n             {\n                nameSpace: nameSpace,\n                domainName: domainName\n             }\n           )       \n        )\n        (begin\n          (var-set domainNameManagerCount (+ (var-get domainNameManagerCount) u1))\n          (map-insert DomainNameManagersIndex\n          { \n            domainNMId: (var-get domainNameManagerCount)\n          }\n           {\n            nameSpace: nameSpace,\n            domainName: domainName\n           } \n          )\n          (map-insert DomainNameManagers \n           {\n            nameSpace: nameSpace,\n            domainName: domainName\n           } \n           {\n            domainNameWallet:  domainNameWallet,\n            domainNameFeePerc: domainNameFeePerc,\n            domainNameFeeTokenMint: domainNameFeeTokenMint,\n            domainNameTokenSymbol: tokenSymbol,\n            sponsoredWallet: sponsoredWallet,\n            sponsoredFeePerc: sponsoredFeePerc,\n            sponsoredDID: sponsoredDID,\n            sponsoredUri: sponsoredUri,\n            referencerFeeTokenMint: referencerFeeTokenMint\n           }\n          ) \n         (ok true)\n        )\n        (begin\n         (ok \n          (map-set DomainNameManagers \n           {\n            nameSpace: nameSpace,\n            domainName: domainName\n           } \n           {\n            domainNameWallet:  domainNameWallet,\n            domainNameFeePerc: domainNameFeePerc,\n            domainNameFeeTokenMint: domainNameFeeTokenMint,\n            domainNameTokenSymbol: tokenSymbol,\n            sponsoredWallet: sponsoredWallet,\n            sponsoredFeePerc: sponsoredFeePerc,\n            sponsoredDID: sponsoredDID,\n            sponsoredUri: sponsoredUri,\n            referencerFeeTokenMint: referencerFeeTokenMint\n           }\n          )\n         )\n        )\n      )\n      (err ERR_UNAUTHORIZED)\n    )\n  )\n)\n\n;; Gets the principal for domainName managers\n(define-read-only (get-ref-domainname-manager (nameSpace (buff 48)) (domainName (buff 48)))\n   (ok (unwrap! (map-get? DomainNameManagers \n                        {\n                         nameSpace: nameSpace,\n                         domainName: domainName\n                        }\n               )\n               (err ERR_DOMAINNAME_MANAGER_NOT_FOUND)\n      )\n   )\n)\n\n\n;; Makes the name-preorder\n(define-public (bns-name-preorder (hashedSaltedFqn (buff 20)) (stxToBurn uint) (paymentSIP010Trait <sip-010-trait>) (reciprocityTokenTrait <token-trait>) (referencerWallet principal))\n  (begin\n    (asserts! (> (stx-get-balance tx-sender) stxToBurn) (err ERR_NAME_PREORDER_FUNDS_INSUFFICIENT))\n    (let \n        (\n          (symbol (unwrap-panic (contract-call? paymentSIP010Trait get-symbol)))\n          (fee (get-domain-service-fee symbol))\n          (toBurn (- stxToBurn fee))\n          (tr (order-to-register-domain tx-sender fee 0x616c6c 0x616c6c 0x737461636b73 paymentSIP010Trait reciprocityTokenTrait referencerWallet))  ;; Includes subdomain:all namespace:all name:stacks as domainnames\n        )\n        (ok (try! (contract-call? 'SP000000000000000000002Q6VF78.bns name-preorder hashedSaltedFqn toBurn)))\n    )     \n  )\n)\n\n;;
    Gives the order to register a domain and subdomain associated to a domainName and transfers to the domain managers\n(define-public (order-to-register-domain (sender principal) (fee uint) (nameSpace (buff 48)) (domainName (buff 48)) (subDomain (buff 48)) \n                                         (paymentSIP010Trait <sip-010-trait>) (reciprocityTokenTrait <token-trait>) (referencerWallet principal))\n   (begin\n    (asserts! (is-eq tx-sender sender) (err ERR_UNAUTHORIZED))\n    (asserts! (> (unwrap-panic (contract-call? paymentSIP010Trait get-balance tx-sender)) fee) (err ERR_INSUFFICIENT_FUNDS))\n    (let \n    (\n       (domainNameRef  \n             (unwrap-panic (map-get? DomainNameManagers \n                        {\n                         nameSpace: nameSpace,\n                         domainName: domainName\n                        }\n               )\n             )\n       )\n       (sponsoredFeePerc \n             (get sponsoredFeePerc domainNameRef)\n       )\n       (sponsoredWallet \n            (get sponsoredWallet domainNameRef)\n       )\n       (domainNameFeePerc \n          (get domainNameFeePerc domainNameRef)\n       )    \n      (domainNameWallet \n             (get domainNameWallet domainNameRef)\n       )\n      (domainNameFeeTokenMint \n              (get domainNameFeeTokenMint domainNameRef)\n       )\n      (referencerFeeTokenMint\n               (get referencerFeeTokenMint domainNameRef))\n       (transferToSponsored (/ (* sponsoredFeePerc  fee) u100) )\n       (transferToDomainManager (/ (* domainNameFeePerc  fee) u100))\n       (transferToPlatform (/ (* (- u100 (+ domainNameFeePerc sponsoredFeePerc ) ) fee) u100))\n       (platformDWallet (get-platform-domain-wallet))\n     )  \n       ;; transfer to sponsored  \n     (if (> transferToSponsored u0)\n        (unwrap-panic (contract-call? paymentSIP010Trait transfer \n                             transferToSponsored \n                             sender \n                             sponsoredWallet\n                             none\n                      )\n        )\n        true\n     )\n         ;; transfer to domain name manager\n      (if (> transferToDomainManager u0)\n        (unwrap-panic (contract-call? paymentSIP010Trait transfer\n                             transferToDomainManager\n                             sender\n                             domainNameWallet\n                             none\n                     )\n        )\n        true\n      )\n        ;; transfer to platform manager\n      (if (> transferToPlatform u0)\n         (unwrap-panic (contract-call? paymentSIP010Trait transfer\n                              transferToPlatform\n                              sender \n                              platformDWallet\n                              none\n                )\n         )\n          true\n      )\n         ;; mint token to sender as reciprocity\n      (if (> domainNameFeeTokenMint u0)\n        (unwrap-panic (as-contract (contract-call? reciprocityTokenTrait \n                            mint \n                            domainNameFeeTokenMint\n                            sender\n                                   )\n                      )\n        )\n        true\n      )\n         ;; mint token for referencer (if there is) as reciprocity\n      (if (> referencerFeeTokenMint u0)\n        (unwrap-panic (as-contract (contract-call? reciprocityTokenTrait \n                            mint \n                            referencerFeeTokenMint\n                            referencerWallet\n                                   )\n                      )\n        )\n        true\n      )\n    )\n   (ok true)\n  )\n)\n\n;; returns set domain wallet principal\n(define-read-only (get-platform-domain-wallet)\n  (var-get platformDomainWallet)\n)\n;; protected function to update domain wallet variable\n(define-public (set-platform-domain-wallet (newPDomainWallet principal))\n  (begin\n    (asserts! (is-authorized-auth) (err ERR_UNAUTHORIZED))  \n    (ok (var-set platformDomainWallet newPDomainWallet))\n  )\n)`;
    const abi = `{\"maps\":[{\"key\":{\"tuple\":[{\"name\":\"domainName\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"nameSpace\",\"type\":{\"buffer\":{\"length\":48}}}]},\"name\":\"DomainNameManagers\",\"value\":{\"tuple\":[{\"name\":\"domainNameFeePerc\",\"type\":\"uint128\"},{\"name\":\"domainNameFeeTokenMint\",\"type\":\"uint128\"},{\"name\":\"domainNameTokenSymbol\",\"type\":{\"string-utf8\":{\"length\":5}}},{\"name\":\"domainNameWallet\",\"type\":\"principal\"},{\"name\":\"referencerFeeTokenMint\",\"type\":\"uint128\"},{\"name\":\"sponsoredDID\",\"type\":{\"string-utf8\":{\"length\":256}}},{\"name\":\"sponsoredFeePerc\",\"type\":\"uint128\"},{\"name\":\"sponsoredUri\",\"type\":{\"string-utf8\":{\"length\":256}}},{\"name\":\"sponsoredWallet\",\"type\":\"principal\"}]}},{\"key\":{\"tuple\":[{\"name\":\"domainNMId\",\"type\":\"uint128\"}]},\"name\":\"DomainNameManagersIndex\",\"value\":{\"tuple\":[{\"name\":\"domainName\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"nameSpace\",\"type\":{\"buffer\":{\"length\":48}}}]}},{\"key\":{\"tuple\":[{\"name\":\"tokenSymbol\",\"type\":{\"string-ascii\":{\"length\":32}}}]},\"name\":\"DomainServiceFee\",\"value\":{\"tuple\":[{\"name\":\"fee\",\"type\":\"uint128\"}]}},{\"key\":{\"tuple\":[{\"name\":\"serviceId\",\"type\":\"uint128\"}]},\"name\":\"DomainServiceFeeIndex\",\"value\":{\"tuple\":[{\"name\":\"tokenSymbol\",\"type\":{\"string-ascii\":{\"length\":32}}}]}}],\"functions\":[{\"args\":[],\"name\":\"is-authorized-auth\",\"access\":\"private\",\"outputs\":{\"type\":\"bool\"}},{\"args\":[],\"name\":\"is-authorized-domain\",\"access\":\"private\",\"outputs\":{\"type\":\"bool\"}},{\"args\":[],\"name\":\"is-authorized-owner\",\"access\":\"private\",\"outputs\":{\"type\":\"bool\"}},{\"args\":[{\"name\":\"hashedSaltedFqn\",\"type\":{\"buffer\":{\"length\":20}}},{\"name\":\"stxToBurn\",\"type\":\"uint128\"},{\"name\":\"paymentSIP010Trait\",\"type\":\"trait_reference\"},{\"name\":\"reciprocityTokenTrait\",\"type\":\"trait_reference\"},{\"name\":\"referencerWallet\",\"type\":\"principal\"}],\"name\":\"bns-name-preorder\",\"access\":\"public\",\"outputs\":{\"type\":{\"response\":{\"ok\":\"uint128\",\"error\":\"int128\"}}}},{\"args\":[{\"name\":\"tokenSymbol\",\"type\":{\"string-ascii\":{\"length\":32}}},{\"name\":\"fee\",\"type\":\"uint128\"}],\"name\":\"create-domain-service-fee\",\"access\":\"public\",\"outputs\":{\"type\":{\"response\":{\"ok\":\"bool\",\"error\":\"int128\"}}}},{\"args\":[{\"name\":\"nameSpace\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"domainName\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"domainNameWallet\",\"type\":\"principal\"},{\"name\":\"domainNameFeePerc\",\"type\":\"uint128\"},{\"name\":\"domainNameFeeTokenMint\",\"type\":\"uint128\"},{\"name\":\"tokenSymbol\",\"type\":{\"string-utf8\":{\"length\":5}}},{\"name\":\"sponsoredWallet\",\"type\":\"principal\"},{\"name\":\"sponsoredFeePerc\",\"type\":\"uint128\"},{\"name\":\"sponsoredDID\",\"type\":{\"string-utf8\":{\"length\":256}}},{\"name\":\"sponsoredUri\",\"type\":{\"string-utf8\":{\"length\":256}}},{\"name\":\"referencerFeeTokenMint\",\"type\":\"uint128\"}],\"name\":\"create-domainname-manager\",\"access\":\"public\",\"outputs\":{\"type\":{\"response\":{\"ok\":\"bool\",\"error\":\"int128\"}}}},{\"args\":[{\"name\":\"sender\",\"type\":\"principal\"},{\"name\":\"fee\",\"type\":\"uint128\"},{\"name\":\"nameSpace\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"domainName\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"subDomain\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"paymentSIP010Trait\",\"type\":\"trait_reference\"},{\"name\":\"reciprocityTokenTrait\",\"type\":\"trait_reference\"},{\"name\":\"referencerWallet\",\"type\":\"principal\"}],\"name\":\"order-to-register-domain\",\"access\":\"public\",\"outputs\":{\"type\":{\"response\":{\"ok\":\"bool\",\"error\":\"int128\"}}}},{\"args\":[{\"name\":\"newDomainWallet\",\"type\":\"principal\"}],\"name\":\"set-domain-wallet\",\"access\":\"public\",\"outputs\":{\"type\":{\"response\":{\"ok\":\"bool\",\"error\":\"int128\"}}}},{\"args\":[{\"name\":\"newPDomainWallet\",\"type\":\"principal\"}],\"name\":\"set-platform-domain-wallet\",\"access\":\"public\",\"outputs\":{\"type\":{\"response\":{\"ok\":\"bool\",\"error\":\"int128\"}}}},{\"args\":[],\"name\":\"get-domain-name-manager-count\",\"access\":\"read_only\",\"outputs\":{\"type\":\"uint128\"}},{\"args\":[{\"name\":\"id\",\"type\":\"uint128\"}],\"name\":\"get-domain-name-managers-index\",\"access\":\"read_only\",\"outputs\":{\"type\":{\"optional\":{\"tuple\":[{\"name\":\"domainName\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"nameSpace\",\"type\":{\"buffer\":{\"length\":48}}}]}}}},{\"args\":[{\"name\":\"tokenSymbol\",\"type\":{\"string-ascii\":{\"length\":32}}}],\"name\":\"get-domain-service-fee\",\"access\":\"read_only\",\"outputs\":{\"type\":\"uint128\"}},{\"args\":[],\"name\":\"get-domain-service-fee-count\",\"access\":\"read_only\",\"outputs\":{\"type\":\"uint128\"}},{\"args\":[{\"name\":\"id\",\"type\":\"uint128\"}],\"name\":\"get-domain-service-fee-index\",\"access\":\"read_only\",\"outputs\":{\"type\":{\"optional\":{\"tuple\":[{\"name\":\"tokenSymbol\",\"type\":{\"string-ascii\":{\"length\":32}}}]}}}},{\"args\":[],\"name\":\"get-domain-wallet\",\"access\":\"read_only\",\"outputs\":{\"type\":\"principal\"}},{\"args\":[],\"name\":\"get-platform-domain-wallet\",\"access\":\"read_only\",\"outputs\":{\"type\":\"principal\"}},{\"args\":[{\"name\":\"nameSpace\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"domainName\",\"type\":{\"buffer\":{\"length\":48}}}],\"name\":\"get-ref-domainname-manager\",\"access\":\"read_only\",\"outputs\":{\"type\":{\"response\":{\"ok\":{\"tuple\":[{\"name\":\"domainNameFeePerc\",\"type\":\"uint128\"},{\"name\":\"domainNameFeeTokenMint\",\"type\":\"uint128\"},{\"name\":\"domainNameTokenSymbol\",\"type\":{\"string-utf8\":{\"length\":5}}},{\"name\":\"domainNameWallet\",\"type\":\"principal\"},{\"name\":\"referencerFeeTokenMint\",\"type\":\"uint128\"},{\"name\":\"sponsoredDID\",\"type\":{\"string-utf8\":{\"length\":256}}},{\"name\":\"sponsoredFeePerc\",\"type\":\"uint128\"},{\"name\":\"sponsoredUri\",\"type\":{\"string-utf8\":{\"length\":256}}},{\"name\":\"sponsoredWallet\",\"type\":\"principal\"}]},\"error\":\"int128\"}}}}],\"variables\":[{\"name\":\"CONTRACT_OWNER\",\"type\":\"principal\",\"access\":\"constant\"},{\"name\":\"ERR_DOMAINNAME_MANAGER_NOT_FOUND\",\"type\":\"int128\",\"access\":\"constant\"},{\"name\":\"ERR_INSUFFICIENT_FUNDS\",\"type\":\"int128\",\"access\":\"constant\"},{\"name\":\"ERR_NAME_PREORDER_FUNDS_INSUFFICIENT\",\"type\":\"int128\",\"access\":\"constant\"},{\"name\":\"ERR_UNAUTHORIZED\",\"type\":\"int128\",\"access\":\"constant\"},{\"name\":\"domainNameManagerCount\",\"type\":\"uint128\",\"access\":\"variable\"},{\"name\":\"domainServiceFeeCount\",\"type\":\"uint128\",\"access\":\"variable\"},{\"name\":\"domainWallet\",\"type\":\"principal\",\"access\":\"variable\"},{\"name\":\"platformDomainWallet\",\"type\":\"principal\",\"access\":\"variable\"}],\"fungible_tokens\":[],\"non_fungible_tokens\":[]}`;
    const tx1: DbTxRaw = {
      type_id: DbTxTypeId.ContractCall,
      tx_id: '0x8407751d1a8d11ee986aca32a6459d9cd798283a12e048ebafcd4cc7dadb29af',
      anchor_mode: DbTxAnchorMode.Any,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: 2147483647,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      block_height: 1,
      tx_index: 33,
      index_block_hash: '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb663139',
      block_hash: '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb663139',
      burn_block_time: 1637003433,
      parent_burn_block_time: 1637002470,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      post_conditions: '0x01f5',
      fee_rate: 139200n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'SPX3DV9X9CGA8P14B3CMP2X8DBW6ZDXEAXDNPTER',
      origin_hash_mode: 1,
      event_count: 6,
      execution_cost_read_count: 55,
      execution_cost_read_length: 88420,
      execution_cost_runtime: 116256000,
      execution_cost_write_count: 9,
      execution_cost_write_length: 339,
      contract_call_contract_id: 'SP3YK7KWMYRCDMV5M4792T0T7DERQXHJJGGEPV1N8.pg-mdomains-v1',
      contract_call_function_name: 'bns-name-preorder',
    };
    const smartContract1: DbSmartContract = {
      tx_id: '0x668142abbcabb846e3f83183325325071a8b4882dcf5476a38148cb5b738fc83',
      canonical: true,
      clarity_version: null,
      contract_id: 'SP3YK7KWMYRCDMV5M4792T0T7DERQXHJJGGEPV1N8.pg-mdomains-v1',
      block_height: 1,
      source_code,
      abi,
    };
    const dbBlock: DbBlock = {
      block_hash: '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb663139',
      index_block_hash: '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb663139',
      parent_index_block_hash: '',
      parent_block_hash: '',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1637003433,
      burn_block_hash: '0x0000000000000000000342c6f7e9313ffa6f0a92618edaf86351ca265aee1c7a',
      burn_block_height: 1,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 1210,
      execution_cost_read_length: 1919542,
      execution_cost_runtime: 2480886000,
      execution_cost_write_count: 138,
      execution_cost_write_length: 91116,
    };
    const dbTx2: DbTxRaw = {
      tx_id: '0x8915000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 1000,
      raw_tx: bufferToHexPrefixString(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('coinbase hi')),
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: true,
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      origin_hash_mode: 1,
      block_hash: '0x0123',
      index_block_hash: '0x1234',
      parent_block_hash: '0x5678',
      block_height: 0,
      burn_block_time: 39486,
      parent_burn_block_time: 1626122935,
      tx_index: 4,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const versionedSmartContract1: DbSmartContract = {
      tx_id: '0x268142abbcabb846e3f83183325325071a8b4882dcf5476a38148cb5b738fc82',
      canonical: true,
      clarity_version: 2,
      contract_id: 'SP3YK7KWMYRCDMV5M4792T0T7DERQXHJJGGEPV1N8.some-versioned-contract',
      block_height: 1,
      source_code: '(some-versioned-contract-src)',
      abi: '{"some-abi":1}',
    };
    const dbTx3: DbTxRaw = {
      tx_id: versionedSmartContract1.tx_id,
      anchor_mode: 3,
      nonce: 1000,
      raw_tx: bufferToHexPrefixString(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.VersionedSmartContract,
      smart_contract_clarity_version: versionedSmartContract1.clarity_version ?? undefined,
      smart_contract_contract_id: versionedSmartContract1.contract_id,
      smart_contract_source_code: versionedSmartContract1.source_code,
      post_conditions: '0x01f5',
      fee_rate: 2345n,
      sponsored: false,
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      origin_hash_mode: 1,
      block_hash: '0x0123',
      index_block_hash: '0x1234',
      parent_block_hash: '0x5678',
      block_height: 0,
      burn_block_time: 39486,
      parent_burn_block_time: 1626122935,
      tx_index: 5,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx1,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [smartContract1],
          pox2Events: [],
          pox3Events: [],
        },
        {
          tx: dbTx2,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
        },
        {
          tx: dbTx3,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [versionedSmartContract1],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });
    const notFoundTxId = '0x8914000000000000000000000000000000000000000000000000000000000000';
    const txsListDetail = await supertest(api.server).get(
      `/extended/v1/tx/multiple?tx_id=${mempoolTx.tx_id}&tx_id=${tx1.tx_id}&tx_id=${notFoundTxId}&tx_id=${dbTx2.tx_id}&tx_id=${dbTx3.tx_id}`
    );
    const jsonRes = txsListDetail.body;
    // tx comparison
    expect(jsonRes[mempoolTx.tx_id].result.tx_id).toEqual(mempoolTx.tx_id);
    expect(jsonRes[tx1.tx_id].result.tx_id).toEqual(tx1.tx_id);
    // mempool tx comparison
    expect(jsonRes[notFoundTxId].result.tx_id).toEqual(notFoundTxId);
    // not found comparison
    expect(jsonRes[dbTx2.tx_id].result.tx_id).toEqual(dbTx2.tx_id);

    // versioned smart contract comparison
    expect(jsonRes[dbTx3.tx_id].result.tx_id).toEqual(dbTx3.tx_id);
    expect(jsonRes[dbTx3.tx_id].result.tx_type).toEqual('smart_contract');
    expect(jsonRes[dbTx3.tx_id].result.smart_contract.clarity_version).toEqual(2);
  });

  test('getTxList returns object', async () => {
    const block = new TestBlockBuilder().build();
    await db.update(block);
    const expectedResp = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      results: [],
      total: 0,
    };
    const fetchTx = await supertest(api.server).get('/extended/v1/tx/');
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('tx - versioned smart contract', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    // stacks.js does not have a versioned-smart-contract tx builder as of writing, so use a known good serialized tx
    const versionedSmartContractTx = Buffer.from(
      '80000000000400000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000030200000000060205706f782d320000003b3b3b20506f5820746573746e657420636f6e7374616e74730a3b3b204d696e2f6d6178206e756d626572206f6620726577617264206379636c6573',
      'hex'
    );
    const abiSample = {
      functions: [],
      variables: [],
      maps: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    const tx = decodeTransaction(versionedSmartContractTx);
    const txPayload = tx.payload as TxPayloadVersionedSmartContract;
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: bufferToHexPrefixString(versionedSmartContractTx),
        status: 'success',
        raw_result: '0x0100000000000000000000000000000001', // u1
        txid: tx.tx_id,
        tx_index: 2,
        contract_abi: abiSample,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        execution_cost: {
          read_count: 0,
          read_length: 0,
          runtime: 0,
          write_count: 0,
          write_length: 0,
        },
      },
      nonce: 0,
      raw_tx: bufferToHexPrefixString(versionedSmartContractTx),
      parsed_tx: tx,
      sender_address: tx.auth.origin_condition.signer.address,
      sponsor_address: undefined,
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
    const smartContract: DbSmartContract = {
      tx_id: dbTx.tx_id,
      canonical: true,
      clarity_version: txPayload.clarity_version,
      contract_id: `${dbTx.sender_address}.${txPayload.contract_name}`,
      block_height: dbBlock.block_height,
      source_code: txPayload.code_body,
      abi: JSON.stringify(abiSample),
    };
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: dbTx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [smartContract],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });

    const txQuery = await getTxFromDataStore(db, { txId: dbTx.tx_id, includeUnanchored: false });
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      microblock_canonical: true,
      microblock_hash: '0x',
      microblock_sequence: I32_MAX,
      parent_block_hash: '0x5678',
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      tx_id: '0x0c80debd01f7ca45e6126d9da7fd54f61d43a9e7cb41d975b30e17ab423f22e4',
      tx_index: 2,
      tx_status: 'success',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'smart_contract',
      fee_rate: '0',
      is_unanchored: false,
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'ST000000000000000000002AMW42H',
      sponsored: false,
      post_condition_mode: 'deny',
      post_conditions: [],
      smart_contract: {
        clarity_version: 2,
        contract_id: 'ST000000000000000000002AMW42H.pox-2',
        source_code: txPayload.code_body,
      },
      event_count: 0,
      events: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
    expect(txQuery.result).toEqual(expectedResp);
  });

  test('tx - coinbase pay to alt recipient - standard principal', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    // stacks.js does not support `coinbase-pay-to-alt-recipient` tx support as of writing, so use a known good serialized tx
    const versionedSmartContractTx = Buffer.from(
      '80800000000400fd3cd910d78fe7c4cd697d5228e51a912ff2ba740000000000000004000000000000000001008d36064b250dba5d3221ac235a9320adb072cfc23cd63511e6d814f97f0302e66c2ece80d7512df1b3e90ca6dce18179cb67b447973c739825ce6c6756bc247d010200000000050000000000000000000000000000000000000000000000000000000000000000051aba27f99e007c7f605a8305e318c1abde3cd220ac',
      'hex'
    );

    const tx = decodeTransaction(versionedSmartContractTx);
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: bufferToHexPrefixString(versionedSmartContractTx),
        status: 'success',
        raw_result: '0x0100000000000000000000000000000001', // u1
        txid: tx.tx_id,
        tx_index: 2,
        contract_abi: null,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        execution_cost: {
          read_count: 0,
          read_length: 0,
          runtime: 0,
          write_count: 0,
          write_length: 0,
        },
      },
      nonce: 0,
      raw_tx: bufferToHexPrefixString(versionedSmartContractTx),
      parsed_tx: tx,
      sender_address: tx.auth.origin_condition.signer.address,
      sponsor_address: undefined,
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: dbTx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });

    const txQuery = await getTxFromDataStore(db, { txId: dbTx.tx_id, includeUnanchored: false });
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      microblock_canonical: true,
      microblock_hash: '0x',
      microblock_sequence: I32_MAX,
      parent_block_hash: '0x5678',
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      tx_id: '0x449f5ea5c541bbbbbf7a1bff2434c449dca2ae3cdc52ba8d24b0bd0d3632d9bc',
      tx_index: 2,
      tx_status: 'success',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'coinbase',
      fee_rate: '0',
      is_unanchored: false,
      nonce: 4,
      anchor_mode: 'on_chain_only',
      sender_address: 'ST3YKSP8GTY7YFH6DD5YN4A753A8JZWNTEJFG78GN',
      sponsored: false,
      post_condition_mode: 'deny',
      post_conditions: [],
      coinbase_payload: {
        data: '0x0000000000000000000000000000000000000000000000000000000000000000',
        alt_recipient: 'ST2X2FYCY01Y7YR2TGC2Y6661NFF3SMH0NGXPWTV5',
      },
      event_count: 0,
      events: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
    expect(txQuery.result).toEqual(expectedResp);
  });

  test('tx - coinbase pay to alt recipient - contract principal', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    // stacks.js does not support `coinbase-pay-to-alt-recipient` tx support as of writing, so use a known good serialized tx
    const versionedSmartContractTx = Buffer.from(
      '8080000000040055a0a92720d20398211cd4c7663d65d018efcc1f00000000000000030000000000000000010118da31f542913e8c56961b87ee4794924e655a28a2034e37ef4823eeddf074747285bd6efdfbd84eecdf62cffa7c1864e683c688f4c105f4db7429066735b4e2010200000000050000000000000000000000000000000000000000000000000000000000000000061aba27f99e007c7f605a8305e318c1abde3cd220ac0b68656c6c6f5f776f726c64',
      'hex'
    );

    const tx = decodeTransaction(versionedSmartContractTx);
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: bufferToHexPrefixString(versionedSmartContractTx),
        status: 'success',
        raw_result: '0x0100000000000000000000000000000001', // u1
        txid: tx.tx_id,
        tx_index: 2,
        contract_abi: null,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        execution_cost: {
          read_count: 0,
          read_length: 0,
          runtime: 0,
          write_count: 0,
          write_length: 0,
        },
      },
      nonce: 0,
      raw_tx: bufferToHexPrefixString(versionedSmartContractTx),
      parsed_tx: tx,
      sender_address: tx.auth.origin_condition.signer.address,
      sponsor_address: undefined,
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: dbTx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });

    const txQuery = await getTxFromDataStore(db, { txId: dbTx.tx_id, includeUnanchored: false });
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      microblock_canonical: true,
      microblock_hash: '0x',
      microblock_sequence: I32_MAX,
      parent_block_hash: '0x5678',
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      tx_id: '0xbd1a9e1d60ca29fc630633170f396f5b6b85c9620bd16d63384ebc5a01a1829b',
      tx_index: 2,
      tx_status: 'success',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'coinbase',
      fee_rate: '0',
      is_unanchored: false,
      nonce: 3,
      anchor_mode: 'on_chain_only',
      sender_address: 'ST1AT1A97439076113KACESHXCQ81HVYC3XWGT2F5',
      sponsored: false,
      post_condition_mode: 'deny',
      post_conditions: [],
      coinbase_payload: {
        data: '0x0000000000000000000000000000000000000000000000000000000000000000',
        alt_recipient: 'ST2X2FYCY01Y7YR2TGC2Y6661NFF3SMH0NGXPWTV5.hello_world',
      },
      event_count: 0,
      events: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
    expect(txQuery.result).toEqual(expectedResp);
  });

  test('tx - sponsored', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const txBuilder = await makeContractCall({
      contractAddress: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      contractName: 'hello-world',
      functionName: 'fn-name',
      functionArgs: [{ type: ClarityType.Int, value: BigInt(556) }],
      fee: 200,
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      nonce: 0,
      sponsored: true,
      anchorMode: AnchorMode.Any,
    });
    const sponsoredTx = await sponsorTransaction({
      transaction: txBuilder,
      sponsorPrivateKey: '381314da39a45f43f45ffd33b5d8767d1a38db0da71fea50ed9508e048765cf301',
      fee: 300,
      sponsorNonce: 2,
    });
    const serialized = Buffer.from(sponsoredTx.serialize());
    const tx = decodeTransaction(serialized);
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        status: 'success',
        raw_result: '0x0100000000000000000000000000000001', // u1
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        execution_cost: {
          read_count: 0,
          read_length: 0,
          runtime: 0,
          write_count: 0,
          write_length: 0,
        },
      },
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      parsed_tx: tx,
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsor_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
    const contractAbi: ClarityAbi = {
      functions: [
        {
          name: 'fn-name',
          args: [{ name: 'arg1', type: 'int128' }],
          access: 'public',
          outputs: { type: 'bool' },
        },
      ],
      variables: [],
      maps: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    const smartContract: DbSmartContract = {
      tx_id: dbTx.tx_id,
      canonical: true,
      clarity_version: null,
      contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
      block_height: dbBlock.block_height,
      source_code: '()',
      abi: JSON.stringify(contractAbi),
    };
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: dbTx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [smartContract],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });

    const txQuery = await getTxFromDataStore(db, { txId: dbTx.tx_id, includeUnanchored: false });
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      microblock_canonical: true,
      microblock_hash: '0x',
      microblock_sequence: I32_MAX,
      parent_block_hash: '0x5678',
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      tx_id: '0xc889d593d349834e100f63cf58975b6aa2787d6f3784a26f5654221e38f75b05',
      tx_index: 2,
      tx_status: 'success',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'contract_call',
      fee_rate: '300',
      is_unanchored: false,
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsor_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsored: true,
      post_condition_mode: 'deny',
      post_conditions: [],
      contract_call: {
        contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
        function_name: 'fn-name',
        function_signature: '(define-public (fn-name (arg1 int)))',
        function_args: [
          { hex: '0x000000000000000000000000000000022c', repr: '556', name: 'arg1', type: 'int' },
        ],
      },
      event_count: 0,
      events: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      sponsor_nonce: 2,
    };
    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
    expect(txQuery.result).toEqual(expectedResp);
  });

  test('tx - sponsored negtive balance', async () => {
    //a key with 0 balance
    const randomKey = '5e0f18e16a585a280b73198b271d558deaf7178be1b2e238b08d7aa175c697d6';
    const publicKey = pubKeyfromPrivKey(randomKey);
    const address = publicKeyToAddress(AddressVersion.TestnetSingleSig, publicKey);
    const sponsoredAddress = 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0';

    const dbBlock: DbBlock = {
      block_hash: '0xffab',
      index_block_hash: '0x1234ab',
      parent_index_block_hash: '0x5678ab',
      parent_block_hash: '0x5678ab',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647997,
      burn_block_hash: '0x1234ab',
      burn_block_height: 124,
      miner_txid: '0x4321ab',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [],
    });

    const expectedSponsoredRespBefore = {
      balance: '0',
      total_sent: '0',
      total_received: '0',
      total_fees_sent: '0',
      total_miner_rewards_received: '0',
      lock_tx_id: '',
      locked: '0',
      lock_height: 0,
      burnchain_lock_height: 0,
      burnchain_unlock_height: 0,
    };
    const sponsoredStxResBefore = await supertest(api.server).get(
      `/extended/v1/address/${sponsoredAddress}/stx`
    );
    expect(sponsoredStxResBefore.status).toBe(200);
    expect(sponsoredStxResBefore.type).toBe('application/json');
    expect(JSON.parse(sponsoredStxResBefore.text)).toEqual(expectedSponsoredRespBefore);

    const txBuilder = await makeContractCall({
      contractAddress: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      contractName: 'hello-world',
      functionName: 'fn-name',
      functionArgs: [{ type: ClarityType.Int, value: BigInt(556) }],
      fee: 200,
      senderKey: '5e0f18e16a585a280b73198b271d558deaf7178be1b2e238b08d7aa175c697d6',
      nonce: 0,
      sponsored: true,
      anchorMode: AnchorMode.Any,
    });
    const sponsoredTx = await sponsorTransaction({
      transaction: txBuilder,
      sponsorPrivateKey: '381314da39a45f43f45ffd33b5d8767d1a38db0da71fea50ed9508e048765cf301',
      fee: 300,
      sponsorNonce: 3,
    });
    const serialized = Buffer.from(sponsoredTx.serialize());
    const tx = decodeTransaction(serialized);
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        status: 'success',
        raw_result: '0x0100000000000000000000000000000001', // u1
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        execution_cost: {
          read_count: 0,
          read_length: 0,
          runtime: 0,
          write_count: 0,
          write_length: 0,
        },
      },
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      parsed_tx: tx,
      sender_address: address,
      sponsor_address: sponsoredAddress,
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
    await db.updateTx(client, dbTx);
    const contractAbi: ClarityAbi = {
      functions: [
        {
          name: 'fn-name',
          args: [{ name: 'arg1', type: 'int128' }],
          access: 'public',
          outputs: { type: 'bool' },
        },
      ],
      variables: [],
      maps: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    await db.updateSmartContract(client, dbTx, {
      tx_id: dbTx.tx_id,
      canonical: true,
      clarity_version: null,
      contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
      block_height: dbBlock.block_height,
      source_code: '()',
      abi: JSON.stringify(contractAbi),
    });
    const txQuery = await getTxFromDataStore(db, { txId: dbTx.tx_id, includeUnanchored: false });
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      balance: '0',
      total_sent: '0',
      total_received: '0',
      total_fees_sent: '0',
      total_miner_rewards_received: '0',
      lock_tx_id: '',
      locked: '0',
      lock_height: 0,
      burnchain_lock_height: 0,
      burnchain_unlock_height: 0,
    };
    const fetchStxBalance = await supertest(api.server).get(`/extended/v1/address/${address}/stx`);
    expect(fetchStxBalance.status).toBe(200);
    expect(fetchStxBalance.type).toBe('application/json');
    expect(JSON.parse(fetchStxBalance.text)).toEqual(expectedResp);

    const expectedRespBalance = {
      stx: {
        balance: '0',
        total_sent: '0',
        total_received: '0',
        total_fees_sent: '0',
        total_miner_rewards_received: '0',
        lock_tx_id: '',
        locked: '0',
        lock_height: 0,
        burnchain_lock_height: 0,
        burnchain_unlock_height: 0,
      },
      fungible_tokens: {},
      non_fungible_tokens: {},
    };
    const fetchBalance = await supertest(api.server).get(
      `/extended/v1/address/${address}/balances`
    );
    expect(fetchBalance.status).toBe(200);
    expect(fetchBalance.type).toBe('application/json');
    expect(JSON.parse(fetchBalance.text)).toEqual(expectedRespBalance);

    const expectedSponsoredRespAfter = {
      balance: '-300',
      total_sent: '0',
      total_received: '0',
      total_fees_sent: '300',
      total_miner_rewards_received: '0',
      lock_tx_id: '',
      locked: '0',
      lock_height: 0,
      burnchain_lock_height: 0,
      burnchain_unlock_height: 0,
    };
    const sponsoredStxResAfter = await supertest(api.server).get(
      `/extended/v1/address/${sponsoredAddress}/stx`
    );
    expect(sponsoredStxResAfter.status).toBe(200);
    expect(sponsoredStxResAfter.type).toBe('application/json');
    expect(JSON.parse(sponsoredStxResAfter.text)).toEqual(expectedSponsoredRespAfter);
  });

  test('tx with stx-transfer-memo', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const dbTx: DbTxRaw = {
      tx_id: '0x421234',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('test-raw-tx')),
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('hi')),
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const dbStxEvent: DbStxEvent = {
      event_index: 0,
      tx_id: dbTx.tx_id,
      tx_index: dbTx.tx_index,
      block_height: dbTx.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      sender: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      recipient: 'ST2X2FYCY01Y7YR2TGC2Y6661NFF3SMH0NGXPWTV5',
      event_type: DbEventTypeId.StxAsset,
      amount: 60n,
      memo: '0x74657374206d656d6f206669656c64',
    };

    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: dbTx,
          stxLockEvents: [],
          stxEvents: [dbStxEvent],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });

    const req1 = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(req1.status).toBe(200);
    expect(req1.type).toBe('application/json');
    expect(req1.body.events[0]).toEqual({
      event_index: 0,
      event_type: 'stx_asset',
      tx_id: '0x421234',
      asset: {
        asset_event_type: 'transfer',
        sender: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        recipient: 'ST2X2FYCY01Y7YR2TGC2Y6661NFF3SMH0NGXPWTV5',
        amount: '60',
        memo: '0x74657374206d656d6f206669656c64',
      },
    });

    const req2 = await supertest(api.server).get(`/extended/v1/tx/multiple?tx_id=${dbTx.tx_id}`);
    expect(req2.status).toBe(200);
    expect(req2.type).toBe('application/json');
    expect(req2.body[dbTx.tx_id].result.events[0]).toEqual({
      event_index: 0,
      event_type: 'stx_asset',
      tx_id: '0x421234',
      asset: {
        asset_event_type: 'transfer',
        sender: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        recipient: 'ST2X2FYCY01Y7YR2TGC2Y6661NFF3SMH0NGXPWTV5',
        amount: '60',
        memo: '0x74657374206d656d6f206669656c64',
      },
    });

    const req3 = await supertest(api.server).get(
      `/extended/v1/tx/events?address=${dbStxEvent.sender}`
    );
    expect(req3.status).toBe(200);
    expect(req3.type).toBe('application/json');
    expect(req3.body.events[0]).toEqual({
      event_index: 0,
      event_type: 'stx_asset',
      tx_id: '0x421234',
      asset: {
        asset_event_type: 'transfer',
        sender: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        recipient: 'ST2X2FYCY01Y7YR2TGC2Y6661NFF3SMH0NGXPWTV5',
        amount: '60',
        memo: '0x74657374206d656d6f206669656c64',
      },
    });

    const req4 = await supertest(api.server).get(`/extended/v1/tx/events?tx_id=${dbTx.tx_id}`);
    expect(req4.status).toBe(200);
    expect(req4.type).toBe('application/json');
    expect(req4.body.events[0]).toEqual({
      event_index: 0,
      event_type: 'stx_asset',
      tx_id: '0x421234',
      asset: {
        asset_event_type: 'transfer',
        sender: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        recipient: 'ST2X2FYCY01Y7YR2TGC2Y6661NFF3SMH0NGXPWTV5',
        amount: '60',
        memo: '0x74657374206d656d6f206669656c64',
      },
    });

    const req5 = await supertest(api.server).get(
      `/extended/v1/address/${dbStxEvent.sender}/assets`
    );
    expect(req5.status).toBe(200);
    expect(req5.type).toBe('application/json');
    expect(req5.body.results[0]).toEqual({
      event_index: 0,
      event_type: 'stx_asset',
      tx_id: '0x421234',
      asset: {
        asset_event_type: 'transfer',
        sender: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        recipient: 'ST2X2FYCY01Y7YR2TGC2Y6661NFF3SMH0NGXPWTV5',
        amount: '60',
        memo: '0x74657374206d656d6f206669656c64',
      },
    });

    const req6 = await supertest(api.server).get(
      `/extended/v1/address/${dbStxEvent.recipient}/stx_inbound`
    );
    expect(req6.status).toBe(200);
    expect(req6.type).toBe('application/json');
    expect(req6.body).toEqual({
      limit: 20,
      offset: 0,
      results: [
        {
          amount: '60',
          block_height: 1,
          memo: '0x74657374206d656d6f206669656c64',
          sender: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
          transfer_type: 'stx-transfer-memo',
          tx_id: '0x421234',
          tx_index: 0,
        },
      ],
      total: 1,
    });
  });

  test('tx store and processing', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const pc1 = createNonFungiblePostCondition(
      'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      NonFungibleConditionCode.DoesNotSend,
      'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP.hello::asset-name',
      bufferCVFromString('asset-value')
    );

    const pc2 = createFungiblePostCondition(
      'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      FungibleConditionCode.GreaterEqual,
      123456,
      'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP.hello-ft::asset-name-ft'
    );

    const pc3 = createSTXPostCondition(
      'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      FungibleConditionCode.LessEqual,
      36723458
    );

    const txBuilder = await makeContractCall({
      contractAddress: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      contractName: 'hello-world',
      functionName: 'fn-name',
      functionArgs: [{ type: ClarityType.Int, value: BigInt(556) }],
      fee: 200,
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [pc1, pc2, pc3],
      nonce: 0,
      anchorMode: AnchorMode.Any,
    });
    const serialized = Buffer.from(txBuilder.serialize());
    const tx = decodeTransaction(serialized);
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        status: 'success',
        raw_result: '0x0100000000000000000000000000000001', // u1
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        execution_cost: {
          read_count: 0,
          read_length: 0,
          runtime: 0,
          write_count: 0,
          write_length: 0,
        },
      },
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      parsed_tx: tx,
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsor_address: undefined,
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: 1594647995,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
    const contractAbi: ClarityAbi = {
      functions: [
        {
          name: 'fn-name',
          args: [{ name: 'arg1', type: 'int128' }],
          access: 'public',
          outputs: { type: 'bool' },
        },
      ],
      variables: [],
      maps: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    const smartContract: DbSmartContract = {
      tx_id: dbTx.tx_id,
      canonical: true,
      clarity_version: null,
      contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
      block_height: 123,
      source_code: '()',
      abi: JSON.stringify(contractAbi),
    };
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: dbTx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [smartContract],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });
    const txQuery = await getTxFromDataStore(db, { txId: dbTx.tx_id, includeUnanchored: false });
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      microblock_canonical: true,
      microblock_hash: '0x',
      microblock_sequence: I32_MAX,
      parent_block_hash: '0x5678',
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      tx_id: '0xc3e2fabaf7017fa2f6967db4f21be4540fdeae2d593af809c18a6adf369bfb03',
      tx_index: 2,
      tx_status: 'success',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'contract_call',
      fee_rate: '200',
      is_unanchored: false,
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsored: false,
      sponsor_address: undefined,
      sponsor_nonce: undefined,
      post_condition_mode: 'deny',
      post_conditions: [
        {
          type: 'non_fungible',
          condition_code: 'not_sent',
          principal: {
            type_id: 'principal_standard',
            address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
          },
          asset: {
            contract_name: 'hello',
            asset_name: 'asset-name',
            contract_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
          },
          asset_value: {
            hex: '0x020000000b61737365742d76616c7565',
            repr: '0x61737365742d76616c7565',
          },
        },
        {
          type: 'fungible',
          condition_code: 'sent_greater_than_or_equal_to',
          amount: '123456',
          principal: {
            type_id: 'principal_standard',
            address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
          },
          asset: {
            contract_name: 'hello-ft',
            asset_name: 'asset-name-ft',
            contract_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
          },
        },
        {
          type: 'stx',
          condition_code: 'sent_less_than_or_equal_to',
          amount: '36723458',
          principal: {
            type_id: 'principal_standard',
            address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
          },
        },
      ],
      contract_call: {
        contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
        function_name: 'fn-name',
        function_signature: '(define-public (fn-name (arg1 int)))',
        function_args: [
          { hex: '0x000000000000000000000000000000022c', repr: '556', name: 'arg1', type: 'int' },
        ],
      },
      event_count: 0,
      events: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);

    const expectedListResp = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      total: 1,
      results: [expectedResp],
    };
    const fetchTxList = await supertest(api.server).get(`/extended/v1/tx`);
    expect(fetchTxList.status).toBe(200);
    expect(fetchTxList.type).toBe('application/json');
    expect(JSON.parse(fetchTxList.text)).toEqual(expectedListResp);
  });

  test('tx store and processing - abort_by_response', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const txBuilder = await makeContractDeploy({
      contractName: 'hello-world',
      codeBody: '()',
      fee: 200,
      nonce: 0,
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [],
      anchorMode: AnchorMode.Any,
    });
    const serialized = Buffer.from(txBuilder.serialize());
    const tx = decodeTransaction(serialized);
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        raw_result: '0x0100000000000000000000000000000001', // u1
        status: 'abort_by_response',
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        execution_cost: {
          read_count: 0,
          read_length: 0,
          runtime: 0,
          write_count: 0,
          write_length: 0,
        },
      },
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      parsed_tx: tx,
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsor_address: undefined,
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.parent_block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: 1594647995,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: dbTx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });

    const txQuery = await getTxFromDataStore(db, { txId: dbTx.tx_id, includeUnanchored: false });
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0x5678',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      microblock_canonical: true,
      microblock_hash: '0x',
      microblock_sequence: I32_MAX,
      parent_block_hash: '0x5678',
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      tx_id: '0x068e0faed65a1fcddfba0dc5d8dbb685128c7f25e735bbf0fe57e58e8bbb8b75',
      tx_index: 2,
      tx_status: 'abort_by_response',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'smart_contract',
      fee_rate: '200',
      is_unanchored: false,
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsored: false,
      sponsor_address: undefined,
      sponsor_nonce: undefined,
      post_condition_mode: 'deny',
      post_conditions: [],
      smart_contract: {
        clarity_version: 2,
        contract_id: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0.hello-world',
        source_code: '()',
      },
      event_count: 0,
      events: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('tx store and processing - abort_by_post_condition', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const txBuilder = await makeContractDeploy({
      contractName: 'hello-world',
      codeBody: '()',
      fee: 200,
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [],
      nonce: 0,
      anchorMode: AnchorMode.Any,
    });
    const serialized = Buffer.from(txBuilder.serialize());
    const tx = decodeTransaction(serialized);
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        raw_result: '0x0100000000000000000000000000000001', // u1
        status: 'abort_by_post_condition',
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        execution_cost: {
          read_count: 0,
          read_length: 0,
          runtime: 0,
          write_count: 0,
          write_length: 0,
        },
      },
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      parsed_tx: tx,
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsor_address: undefined,
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: dbTx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });

    const txQuery = await getTxFromDataStore(db, { txId: dbTx.tx_id, includeUnanchored: false });
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      microblock_canonical: true,
      microblock_hash: '0x',
      microblock_sequence: I32_MAX,
      parent_block_hash: '0x5678',
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      canonical: true,
      tx_id: '0x068e0faed65a1fcddfba0dc5d8dbb685128c7f25e735bbf0fe57e58e8bbb8b75',
      tx_index: 2,
      tx_status: 'abort_by_post_condition',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'smart_contract',
      fee_rate: '200',
      is_unanchored: false,
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsored: false,
      sponsor_address: undefined,
      sponsor_nonce: undefined,
      post_condition_mode: 'deny',
      post_conditions: [],
      smart_contract: {
        clarity_version: 2,
        contract_id: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0.hello-world',
        source_code: '()',
      },
      event_count: 0,
      events: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('fetch raw tx', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const tx: DbTxRaw = {
      tx_id: '0x421234',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('test-raw-tx')),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: block.parent_index_block_hash,
      parent_block_hash: block.parent_block_hash,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('hi')),
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    await db.update({
      block: block,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });

    const mempoolTx: DbMempoolTxRaw = {
      tx_id: '0x521234',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('test-raw-mempool-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('hi')),
      pruned: false,
      receipt_time: 1616063078,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${tx.tx_id}/raw`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    expect(searchResult1.body.raw_tx).toEqual(bufferToHexPrefixString(Buffer.from('test-raw-tx')));
    const expectedResponse1 = {
      raw_tx: bufferToHexPrefixString(Buffer.from('test-raw-tx')),
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResponse1);

    const searchResult2 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx.tx_id}/raw`);
    expect(searchResult2.status).toBe(200);
    expect(searchResult2.type).toBe('application/json');
    expect(searchResult2.body.raw_tx).toEqual('0x746573742d7261772d6d656d706f6f6c2d7478');
    const expectedResponse2 = {
      raw_tx: '0x746573742d7261772d6d656d706f6f6c2d7478',
    };
    expect(JSON.parse(searchResult2.text)).toEqual(expectedResponse2);
  });

  test('fetch raw tx: transaction not found', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateBlock(client, block);
    const tx: DbTxRaw = {
      tx_id: '0x421234',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('test-raw-tx')),
      index_block_hash: '0x1234',
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: block.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: block.parent_index_block_hash,
      parent_block_hash: block.parent_block_hash,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('hi')),
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    await db.update({
      block: block,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });
    const searchResult = await supertest(api.server).get(`/extended/v1/tx/0x1234/raw`);
    expect(searchResult.status).toBe(404);
  });

  test('/tx/events address filter', async () => {
    const address = 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z';
    const block = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({
        tx_id: '0x1234',
      })
      .addTxStxEvent({ amount: 100n, sender: address })
      .addTxContractLogEvent({ contract_identifier: address })
      .addTxNftEvent({ asset_identifier: 'test_asset_id', sender: address })
      .addTxFtEvent({ sender: address, asset_identifier: 'test_ft_asset_id', amount: 50n })
      .addTxStxLockEvent({ unlock_height: 100, locked_amount: 10000, locked_address: address })
      .build();

    await db.update(block);
    const addressEvents = await supertest(api.server).get(
      `/extended/v1/tx/events?address=${address}&type=stx_asset&type=smart_contract_log&type=non_fungible_token_asset&type=fungible_token_asset&type=stx_lock`
    );
    const expectedResponse = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      events: [
        {
          event_index: 4,
          event_type: 'stx_lock',
          tx_id: '0x1234',
          stx_lock_event: {
            locked_amount: '10000',
            unlock_height: 100,
            locked_address: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
          },
        },
        {
          event_index: 3,
          event_type: 'fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'test_ft_asset_id',
            sender: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            recipient: '',
            amount: '50',
          },
        },
        {
          event_index: 2,
          event_type: 'non_fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'test_asset_id',
            sender: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            recipient: '',
            value: { hex: '0x020000000103', repr: '0x03' },
          },
        },
        {
          event_index: 1,
          event_type: 'smart_contract_log',
          tx_id: '0x1234',
          contract_log: {
            contract_id: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            topic: 'some-topic',
            value: { hex: '0x0200000008736f6d652076616c', repr: '0x736f6d652076616c' },
          },
        },
        {
          event_index: 0,
          event_type: 'stx_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            sender: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            amount: '100',
          },
        },
      ],
    };

    expect(addressEvents.status).toBe(200);
    expect(addressEvents.body).toEqual(expectedResponse);
  });

  test('/tx/events address filter -empty events returned', async () => {
    const address = 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z';
    const addressEvents = await supertest(api.server).get(
      `/extended/v1/tx/events?address=${address}`
    );
    const expectedResponse = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      events: [],
    };

    expect(addressEvents.status).toBe(200);
    expect(addressEvents.body).toEqual(expectedResponse);
  });

  test('/tx/events address filter -no filter applied', async () => {
    const address = 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z';
    const block = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({
        tx_id: '0x1234',
      })
      .addTxStxEvent({ amount: 100n, sender: address })
      .addTxContractLogEvent({ contract_identifier: address })
      .addTxNftEvent({ asset_identifier: 'test_asset_id', sender: address })
      .addTxFtEvent({ sender: address, asset_identifier: 'test_ft_asset_id', amount: 50n })
      .addTxStxLockEvent({ unlock_height: 100, locked_amount: 10000, locked_address: address })
      .build();

    await db.update(block);
    const addressEvents = await supertest(api.server).get(
      `/extended/v1/tx/events?address=${address}`
    );

    const expectedResponse = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      events: [
        {
          event_index: 4,
          event_type: 'stx_lock',
          tx_id: '0x1234',
          stx_lock_event: {
            locked_amount: '10000',
            unlock_height: 100,
            locked_address: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
          },
        },
        {
          event_index: 3,
          event_type: 'fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'test_ft_asset_id',
            sender: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            recipient: '',
            amount: '50',
          },
        },
        {
          event_index: 2,
          event_type: 'non_fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'test_asset_id',
            sender: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            recipient: '',
            value: { hex: '0x020000000103', repr: '0x03' },
          },
        },
        {
          event_index: 1,
          event_type: 'smart_contract_log',
          tx_id: '0x1234',
          contract_log: {
            contract_id: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            topic: 'some-topic',
            value: { hex: '0x0200000008736f6d652076616c', repr: '0x736f6d652076616c' },
          },
        },
        {
          event_index: 0,
          event_type: 'stx_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            sender: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            amount: '100',
          },
        },
      ],
    };

    expect(addressEvents.status).toBe(200);
    expect(addressEvents.body).toEqual(expectedResponse);
  });

  test('/tx/events address filter -limit and offset', async () => {
    const address = 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z';
    const block = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({
        tx_id: '0x1234',
      })
      .addTxStxEvent({ amount: 100n, sender: address })
      .addTxContractLogEvent({ contract_identifier: address })
      .addTxNftEvent({ asset_identifier: 'test_asset_id', sender: address })
      .addTxFtEvent({ sender: address, asset_identifier: 'test_ft_asset_id', amount: 50n })
      .addTxStxLockEvent({ unlock_height: 100, locked_amount: 10000, locked_address: address })
      .build();

    await db.update(block);
    const addressEvents = await supertest(api.server).get(
      `/extended/v1/tx/events?address=${address}&limit=2`
    );

    const expectedResponse = {
      limit: 2,
      offset: 0,
      events: [
        {
          event_index: 4,
          event_type: 'stx_lock',
          tx_id: '0x1234',
          stx_lock_event: {
            locked_amount: '10000',
            unlock_height: 100,
            locked_address: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
          },
        },
        {
          event_index: 3,
          event_type: 'fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'test_ft_asset_id',
            sender: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            recipient: '',
            amount: '50',
          },
        },
      ],
    };

    expect(addressEvents.status).toBe(200);
    expect(addressEvents.body).toEqual(expectedResponse);

    const addressEvents2 = await supertest(api.server).get(
      `/extended/v1/tx/events?address=${address}&limit=2&offset=2`
    );

    const expectedResponse2 = {
      limit: 2,
      offset: 2,
      events: [
        {
          event_index: 2,
          event_type: 'non_fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'test_asset_id',
            sender: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            recipient: '',
            value: { hex: '0x020000000103', repr: '0x03' },
          },
        },
        {
          event_index: 1,
          event_type: 'smart_contract_log',
          tx_id: '0x1234',
          contract_log: {
            contract_id: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            topic: 'some-topic',
            value: { hex: '0x0200000008736f6d652076616c', repr: '0x736f6d652076616c' },
          },
        },
      ],
    };

    expect(addressEvents2.status).toBe(200);
    expect(addressEvents2.body).toEqual(expectedResponse2);
  });

  test('/tx/events address filter -invalid address', async () => {
    const address = 'invalid address';
    const addressEvents = await supertest(api.server).get(
      `/extended/v1/tx/events?address=${address}`
    );

    expect(addressEvents.status).toBe(400);
  });

  test('/tx/events tx_id filter', async () => {
    const address = 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z';
    const txId = '0x1234';
    const block = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({
        tx_id: txId,
      })
      .addTxStxEvent({ amount: 100n, sender: address })
      .addTxContractLogEvent({ contract_identifier: address })
      .addTxNftEvent({ asset_identifier: 'test_asset_id', sender: address })
      .addTxFtEvent({ sender: address, asset_identifier: 'test_ft_asset_id', amount: 50n })
      .addTxStxLockEvent({ unlock_height: 100, locked_amount: 10000, locked_address: address })
      .build();

    await db.update(block);
    const events = await supertest(api.server).get(
      `/extended/v1/tx/events?tx_id=${txId}&type=stx_asset&type=smart_contract_log&type=non_fungible_token_asset&type=fungible_token_asset&type=stx_lock`
    );
    const expectedResponse = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      events: [
        {
          event_index: 4,
          event_type: 'stx_lock',
          tx_id: '0x1234',
          stx_lock_event: {
            locked_amount: '10000',
            unlock_height: 100,
            locked_address: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
          },
        },
        {
          event_index: 3,
          event_type: 'fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'test_ft_asset_id',
            sender: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            recipient: '',
            amount: '50',
          },
        },
        {
          event_index: 2,
          event_type: 'non_fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'test_asset_id',
            sender: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            recipient: '',
            value: { hex: '0x020000000103', repr: '0x03' },
          },
        },
        {
          event_index: 1,
          event_type: 'smart_contract_log',
          tx_id: '0x1234',
          contract_log: {
            contract_id: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            topic: 'some-topic',
            value: { hex: '0x0200000008736f6d652076616c', repr: '0x736f6d652076616c' },
          },
        },
        {
          event_index: 0,
          event_type: 'stx_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            sender: 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z',
            recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            amount: '100',
          },
        },
      ],
    };

    expect(events.status).toBe(200);
    expect(events.body).toEqual(expectedResponse);
  });

  test('/tx/events tx_id filter -no filter applied', async () => {
    const address = 'address with no filter applied';
    const txId = '0x1234';
    const block = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({
        tx_id: txId,
      })
      .addTxStxEvent({ amount: 100n, sender: address })
      .addTxContractLogEvent({ contract_identifier: address })
      .addTxNftEvent({ asset_identifier: 'test_asset_id', sender: address })
      .addTxFtEvent({ sender: address, asset_identifier: 'test_ft_asset_id', amount: 50n })
      .addTxStxLockEvent({ unlock_height: 100, locked_amount: 10000, locked_address: address })
      .build();

    await db.update(block);
    const events = await supertest(api.server).get(`/extended/v1/tx/events?tx_id=${txId}`);
    const expectedResponse = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      events: [
        {
          event_index: 4,
          event_type: 'stx_lock',
          tx_id: '0x1234',
          stx_lock_event: {
            locked_amount: '10000',
            unlock_height: 100,
            locked_address: 'address with no filter applied',
          },
        },
        {
          event_index: 3,
          event_type: 'fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'test_ft_asset_id',
            sender: 'address with no filter applied',
            recipient: '',
            amount: '50',
          },
        },
        {
          event_index: 2,
          event_type: 'non_fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'test_asset_id',
            sender: 'address with no filter applied',
            recipient: '',
            value: { hex: '0x020000000103', repr: '0x03' },
          },
        },
        {
          event_index: 1,
          event_type: 'smart_contract_log',
          tx_id: '0x1234',
          contract_log: {
            contract_id: 'address with no filter applied',
            topic: 'some-topic',
            value: { hex: '0x0200000008736f6d652076616c', repr: '0x736f6d652076616c' },
          },
        },
        {
          event_index: 0,
          event_type: 'stx_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            sender: 'address with no filter applied',
            recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            amount: '100',
          },
        },
      ],
    };

    expect(events.status).toBe(200);
    expect(events.body).toEqual(expectedResponse);
  });

  test('/tx/events tx_id filter -empty events returned', async () => {
    const txId = '0x1234';
    const events = await supertest(api.server).get(`/extended/v1/tx/events?tx_id=${txId}`);
    const expectedResponse = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      events: [],
    };

    expect(events.status).toBe(200);
    expect(events.body).toEqual(expectedResponse);
  });

  test('/tx/events tx_id filter -invalid type', async () => {
    const txId = '0x1234';
    const events = await supertest(api.server).get(
      `/extended/v1/tx/events?tx_id=${txId}&type=invalid`
    );

    expect(events.status).toBe(400);
  });

  test('/tx/events tx_id filter -limit and offset', async () => {
    const txId = '0x1234';
    const address = 'address with no filter applied';
    const block = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({
        tx_id: txId,
      })
      .addTxStxEvent({ amount: 100n, sender: address })
      .addTxContractLogEvent({ contract_identifier: address })
      .addTxNftEvent({ asset_identifier: 'test_asset_id', sender: address })
      .addTxFtEvent({ sender: address, asset_identifier: 'test_ft_asset_id', amount: 50n })
      .addTxStxLockEvent({ unlock_height: 100, locked_amount: 10000, locked_address: address })
      .build();

    await db.update(block);
    const events = await supertest(api.server).get(`/extended/v1/tx/events?tx_id=${txId}&limit=2`);

    const expectedResponse = {
      limit: 2,
      offset: 0,
      events: [
        {
          event_index: 4,
          event_type: 'stx_lock',
          tx_id: '0x1234',
          stx_lock_event: {
            locked_amount: '10000',
            unlock_height: 100,
            locked_address: 'address with no filter applied',
          },
        },
        {
          event_index: 3,
          event_type: 'fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'test_ft_asset_id',
            sender: 'address with no filter applied',
            recipient: '',
            amount: '50',
          },
        },
      ],
    };

    expect(events.status).toBe(200);
    expect(events.body).toEqual(expectedResponse);

    const addressEvents2 = await supertest(api.server).get(
      `/extended/v1/tx/events?tx_id=${txId}&limit=2&offset=2`
    );

    const expectedResponse2 = {
      limit: 2,
      offset: 2,
      events: [
        {
          event_index: 2,
          event_type: 'non_fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'test_asset_id',
            sender: 'address with no filter applied',
            recipient: '',
            value: { hex: '0x020000000103', repr: '0x03' },
          },
        },
        {
          event_index: 1,
          event_type: 'smart_contract_log',
          tx_id: '0x1234',
          contract_log: {
            contract_id: 'address with no filter applied',
            topic: 'some-topic',
            value: { hex: '0x0200000008736f6d652076616c', repr: '0x736f6d652076616c' },
          },
        },
      ],
    };

    expect(addressEvents2.status).toBe(200);
    expect(addressEvents2.body).toEqual(expectedResponse2);
  });

  test('/tx/events tx_id filter -invalid txId', async () => {
    const txId = 'invalid id';
    const events = await supertest(api.server).get(`/extended/v1/tx/events?tx_id=${txId}`);
    expect(events.status).toBe(400);
  });

  test('/tx/events -mutually exclusive query params', async () => {
    const txId = '0x1234';
    const address = 'ST3RJJS96F4GH90XDQQPFQ2023JVFNXPWCSV6BN1Z';
    const addressEvents = await supertest(api.server).get(
      `/extended/v1/tx/events?tx_id=${txId}&address=${address}&type=invalid`
    );

    expect(addressEvents.status).toBe(400);
  });

  test('event count value', async () => {
    const testAddr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
    const testAddr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647996,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const tx: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: 1594647995,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('coinbase hi')),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: block.parent_index_block_hash,
      parent_block_hash: block.parent_block_hash,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 1,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const nftEvent: DbNftEvent = {
      canonical: true,
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: tx.tx_id,
      tx_index: tx.tx_index,
      block_height: tx.block_height,
      asset_identifier: 'bux',
      value: '0x0000000000000000000000000000000000',
      recipient: testAddr1,
      sender: testAddr2,
    };
    await db.update({
      block: block,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [nftEvent],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });

    const expectedResponse = {
      tx_id: '0x1234',
      tx_type: 'coinbase',
      nonce: 0,
      anchor_mode: 'any',
      fee_rate: '1234',
      is_unanchored: false,
      sender_address: 'sender-addr',
      sponsored: false,
      post_condition_mode: 'allow',
      post_conditions: [],
      microblock_canonical: true,
      microblock_hash: '0x',
      microblock_sequence: I32_MAX,
      parent_block_hash: block.parent_block_hash,
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      tx_status: 'success',
      block_hash: '0x1234',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      tx_index: 4,
      tx_result: {
        hex: '0x0100000000000000000000000000000001',
        repr: 'u1',
      },
      coinbase_payload: {
        data: '0x636f696e62617365206869',
        alt_recipient: null,
      },
      event_count: 1,
      events: [
        {
          event_index: 0,
          event_type: 'non_fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'bux',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1',
            value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
          },
        },
      ],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${tx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResponse);
  });

  test('empty abi', async () => {
    const source_code = '(some-src)';
    const abi = `{\"maps\":[{\"key\":{\"tuple\":[{\"name\":\"domainName\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"nameSpace\",\"type\":{\"buffer\":{\"length\":48}}}]},\"name\":\"DomainNameManagers\",\"value\":{\"tuple\":[{\"name\":\"domainNameFeePerc\",\"type\":\"uint128\"},{\"name\":\"domainNameFeeTokenMint\",\"type\":\"uint128\"},{\"name\":\"domainNameTokenSymbol\",\"type\":{\"string-utf8\":{\"length\":5}}},{\"name\":\"domainNameWallet\",\"type\":\"principal\"},{\"name\":\"referencerFeeTokenMint\",\"type\":\"uint128\"},{\"name\":\"sponsoredDID\",\"type\":{\"string-utf8\":{\"length\":256}}},{\"name\":\"sponsoredFeePerc\",\"type\":\"uint128\"},{\"name\":\"sponsoredUri\",\"type\":{\"string-utf8\":{\"length\":256}}},{\"name\":\"sponsoredWallet\",\"type\":\"principal\"}]}},{\"key\":{\"tuple\":[{\"name\":\"domainNMId\",\"type\":\"uint128\"}]},\"name\":\"DomainNameManagersIndex\",\"value\":{\"tuple\":[{\"name\":\"domainName\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"nameSpace\",\"type\":{\"buffer\":{\"length\":48}}}]}},{\"key\":{\"tuple\":[{\"name\":\"tokenSymbol\",\"type\":{\"string-ascii\":{\"length\":32}}}]},\"name\":\"DomainServiceFee\",\"value\":{\"tuple\":[{\"name\":\"fee\",\"type\":\"uint128\"}]}},{\"key\":{\"tuple\":[{\"name\":\"serviceId\",\"type\":\"uint128\"}]},\"name\":\"DomainServiceFeeIndex\",\"value\":{\"tuple\":[{\"name\":\"tokenSymbol\",\"type\":{\"string-ascii\":{\"length\":32}}}]}}],\"functions\":[{\"args\":[],\"name\":\"is-authorized-auth\",\"access\":\"private\",\"outputs\":{\"type\":\"bool\"}},{\"args\":[],\"name\":\"is-authorized-domain\",\"access\":\"private\",\"outputs\":{\"type\":\"bool\"}},{\"args\":[],\"name\":\"is-authorized-owner\",\"access\":\"private\",\"outputs\":{\"type\":\"bool\"}},{\"args\":[{\"name\":\"hashedSaltedFqn\",\"type\":{\"buffer\":{\"length\":20}}},{\"name\":\"stxToBurn\",\"type\":\"uint128\"},{\"name\":\"paymentSIP010Trait\",\"type\":\"trait_reference\"},{\"name\":\"reciprocityTokenTrait\",\"type\":\"trait_reference\"},{\"name\":\"referencerWallet\",\"type\":\"principal\"}],\"name\":\"bns-name-preorder\",\"access\":\"public\",\"outputs\":{\"type\":{\"response\":{\"ok\":\"uint128\",\"error\":\"int128\"}}}},{\"args\":[{\"name\":\"tokenSymbol\",\"type\":{\"string-ascii\":{\"length\":32}}},{\"name\":\"fee\",\"type\":\"uint128\"}],\"name\":\"create-domain-service-fee\",\"access\":\"public\",\"outputs\":{\"type\":{\"response\":{\"ok\":\"bool\",\"error\":\"int128\"}}}},{\"args\":[{\"name\":\"nameSpace\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"domainName\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"domainNameWallet\",\"type\":\"principal\"},{\"name\":\"domainNameFeePerc\",\"type\":\"uint128\"},{\"name\":\"domainNameFeeTokenMint\",\"type\":\"uint128\"},{\"name\":\"tokenSymbol\",\"type\":{\"string-utf8\":{\"length\":5}}},{\"name\":\"sponsoredWallet\",\"type\":\"principal\"},{\"name\":\"sponsoredFeePerc\",\"type\":\"uint128\"},{\"name\":\"sponsoredDID\",\"type\":{\"string-utf8\":{\"length\":256}}},{\"name\":\"sponsoredUri\",\"type\":{\"string-utf8\":{\"length\":256}}},{\"name\":\"referencerFeeTokenMint\",\"type\":\"uint128\"}],\"name\":\"create-domainname-manager\",\"access\":\"public\",\"outputs\":{\"type\":{\"response\":{\"ok\":\"bool\",\"error\":\"int128\"}}}},{\"args\":[{\"name\":\"sender\",\"type\":\"principal\"},{\"name\":\"fee\",\"type\":\"uint128\"},{\"name\":\"nameSpace\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"domainName\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"subDomain\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"paymentSIP010Trait\",\"type\":\"trait_reference\"},{\"name\":\"reciprocityTokenTrait\",\"type\":\"trait_reference\"},{\"name\":\"referencerWallet\",\"type\":\"principal\"}],\"name\":\"order-to-register-domain\",\"access\":\"public\",\"outputs\":{\"type\":{\"response\":{\"ok\":\"bool\",\"error\":\"int128\"}}}},{\"args\":[{\"name\":\"newDomainWallet\",\"type\":\"principal\"}],\"name\":\"set-domain-wallet\",\"access\":\"public\",\"outputs\":{\"type\":{\"response\":{\"ok\":\"bool\",\"error\":\"int128\"}}}},{\"args\":[{\"name\":\"newPDomainWallet\",\"type\":\"principal\"}],\"name\":\"set-platform-domain-wallet\",\"access\":\"public\",\"outputs\":{\"type\":{\"response\":{\"ok\":\"bool\",\"error\":\"int128\"}}}},{\"args\":[],\"name\":\"get-domain-name-manager-count\",\"access\":\"read_only\",\"outputs\":{\"type\":\"uint128\"}},{\"args\":[{\"name\":\"id\",\"type\":\"uint128\"}],\"name\":\"get-domain-name-managers-index\",\"access\":\"read_only\",\"outputs\":{\"type\":{\"optional\":{\"tuple\":[{\"name\":\"domainName\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"nameSpace\",\"type\":{\"buffer\":{\"length\":48}}}]}}}},{\"args\":[{\"name\":\"tokenSymbol\",\"type\":{\"string-ascii\":{\"length\":32}}}],\"name\":\"get-domain-service-fee\",\"access\":\"read_only\",\"outputs\":{\"type\":\"uint128\"}},{\"args\":[],\"name\":\"get-domain-service-fee-count\",\"access\":\"read_only\",\"outputs\":{\"type\":\"uint128\"}},{\"args\":[{\"name\":\"id\",\"type\":\"uint128\"}],\"name\":\"get-domain-service-fee-index\",\"access\":\"read_only\",\"outputs\":{\"type\":{\"optional\":{\"tuple\":[{\"name\":\"tokenSymbol\",\"type\":{\"string-ascii\":{\"length\":32}}}]}}}},{\"args\":[],\"name\":\"get-domain-wallet\",\"access\":\"read_only\",\"outputs\":{\"type\":\"principal\"}},{\"args\":[],\"name\":\"get-platform-domain-wallet\",\"access\":\"read_only\",\"outputs\":{\"type\":\"principal\"}},{\"args\":[{\"name\":\"nameSpace\",\"type\":{\"buffer\":{\"length\":48}}},{\"name\":\"domainName\",\"type\":{\"buffer\":{\"length\":48}}}],\"name\":\"get-ref-domainname-manager\",\"access\":\"read_only\",\"outputs\":{\"type\":{\"response\":{\"ok\":{\"tuple\":[{\"name\":\"domainNameFeePerc\",\"type\":\"uint128\"},{\"name\":\"domainNameFeeTokenMint\",\"type\":\"uint128\"},{\"name\":\"domainNameTokenSymbol\",\"type\":{\"string-utf8\":{\"length\":5}}},{\"name\":\"domainNameWallet\",\"type\":\"principal\"},{\"name\":\"referencerFeeTokenMint\",\"type\":\"uint128\"},{\"name\":\"sponsoredDID\",\"type\":{\"string-utf8\":{\"length\":256}}},{\"name\":\"sponsoredFeePerc\",\"type\":\"uint128\"},{\"name\":\"sponsoredUri\",\"type\":{\"string-utf8\":{\"length\":256}}},{\"name\":\"sponsoredWallet\",\"type\":\"principal\"}]},\"error\":\"int128\"}}}}],\"variables\":[{\"name\":\"CONTRACT_OWNER\",\"type\":\"principal\",\"access\":\"constant\"},{\"name\":\"ERR_DOMAINNAME_MANAGER_NOT_FOUND\",\"type\":\"int128\",\"access\":\"constant\"},{\"name\":\"ERR_INSUFFICIENT_FUNDS\",\"type\":\"int128\",\"access\":\"constant\"},{\"name\":\"ERR_NAME_PREORDER_FUNDS_INSUFFICIENT\",\"type\":\"int128\",\"access\":\"constant\"},{\"name\":\"ERR_UNAUTHORIZED\",\"type\":\"int128\",\"access\":\"constant\"},{\"name\":\"domainNameManagerCount\",\"type\":\"uint128\",\"access\":\"variable\"},{\"name\":\"domainServiceFeeCount\",\"type\":\"uint128\",\"access\":\"variable\"},{\"name\":\"domainWallet\",\"type\":\"principal\",\"access\":\"variable\"},{\"name\":\"platformDomainWallet\",\"type\":\"principal\",\"access\":\"variable\"}],\"fungible_tokens\":[],\"non_fungible_tokens\":[]}`;
    const tx1: DbTxRaw = {
      type_id: DbTxTypeId.ContractCall,
      tx_id: '0x8407751d1a8d11ee986aca32a6459d9cd798283a12e048ebafcd4cc7dadb29af',
      anchor_mode: DbTxAnchorMode.Any,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: 2147483647,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      block_height: 1,
      tx_index: 33,
      index_block_hash: '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb663139',
      block_hash: '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb663139',
      burn_block_time: 1637003433,
      parent_burn_block_time: 1637002470,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      post_conditions: '0x01f5',
      fee_rate: 139200n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'SPX3DV9X9CGA8P14B3CMP2X8DBW6ZDXEAXDNPTER',
      origin_hash_mode: 1,
      event_count: 6,
      execution_cost_read_count: 55,
      execution_cost_read_length: 88420,
      execution_cost_runtime: 116256000,
      execution_cost_write_count: 9,
      execution_cost_write_length: 339,
      contract_call_contract_id: 'SP3YK7KWMYRCDMV5M4792T0T7DERQXHJJGGEPV1N8.pg-mdomains-v1',
      contract_call_function_name: 'bns-name-preorder',
      contract_call_function_args: bufferToHexPrefixString(
        createClarityValueArray(bufferCV(Buffer.from('test')), uintCV(1234n))
      ),
    };
    const tx2: DbTxRaw = {
      type_id: DbTxTypeId.ContractCall,
      tx_id: '0x1513739d6a3f86d4597f5296cc536f6890e2affff9aece285e37399be697b43f',
      anchor_mode: DbTxAnchorMode.Any,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: 2147483647,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      block_height: 1,
      tx_index: 33,
      index_block_hash: '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb663139',
      block_hash: '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb663139',
      burn_block_time: 1637003433,
      parent_burn_block_time: 1637002470,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      post_conditions: '0x01f5',
      fee_rate: 139200n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'SPX3DV9X9CGA8P14B3CMP2X8DBW6ZDXEAXDNPTER',
      origin_hash_mode: 1,
      event_count: 6,
      execution_cost_read_count: 55,
      execution_cost_read_length: 88420,
      execution_cost_runtime: 116256000,
      execution_cost_write_count: 9,
      execution_cost_write_length: 339,
      contract_call_contract_id: 'SP000000000000000000002Q6VF78.bns',
      contract_call_function_name: 'name-register',
      contract_call_function_args: bufferToHexPrefixString(
        createClarityValueArray(bufferCV(Buffer.from('test')), uintCV(1234n))
      ),
    };
    const contractCall: DbSmartContract = {
      tx_id: '0x668142abbcabb846e3f83183325325071a8b4882dcf5476a38148cb5b738fc83',
      canonical: true,
      clarity_version: null,
      contract_id: 'SP3YK7KWMYRCDMV5M4792T0T7DERQXHJJGGEPV1N8.pg-mdomains-v1',
      block_height: 1,
      source_code,
      abi,
    };
    const contractCall2: DbSmartContract = {
      tx_id: '0xd8a9a4528ae833e1894eee676af8d218f8facbf95e166472df2c1a64219b5dfb',
      canonical: true,
      clarity_version: null,
      contract_id: 'SP000000000000000000002Q6VF78.bns',
      block_height: 1,
      source_code,
      abi: JSON.stringify(null),
    };
    const dbBlock: DbBlock = {
      block_hash: '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb663139',
      index_block_hash: '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb663139',
      parent_index_block_hash: '',
      parent_block_hash: '',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1637003433,
      burn_block_hash: '0x0000000000000000000342c6f7e9313ffa6f0a92618edaf86351ca265aee1c7a',
      burn_block_height: 1,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 1210,
      execution_cost_read_length: 1919542,
      execution_cost_runtime: 2480886000,
      execution_cost_write_count: 138,
      execution_cost_write_length: 91116,
    };
    const expected = {
      tx_id: '0x8407751d1a8d11ee986aca32a6459d9cd798283a12e048ebafcd4cc7dadb29af',
      nonce: 0,
      fee_rate: '139200',
      sender_address: 'SPX3DV9X9CGA8P14B3CMP2X8DBW6ZDXEAXDNPTER',
      sponsored: false,
      post_condition_mode: 'allow',
      post_conditions: [],
      anchor_mode: 'any',
      is_unanchored: false,
      block_hash: '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb663139',
      parent_block_hash: '0x',
      block_height: 1,
      burn_block_time: 1637003433,
      burn_block_time_iso: '2021-11-15T19:10:33.000Z',
      parent_burn_block_time: 1637002470,
      parent_burn_block_time_iso: '2021-11-15T18:54:30.000Z',
      canonical: true,
      tx_index: 33,
      tx_status: 'success',
      tx_result: {
        hex: '0x0100000000000000000000000000000001',
        repr: 'u1',
      },
      microblock_hash: '0x',
      microblock_sequence: 2147483647,
      microblock_canonical: true,
      event_count: 6,
      events: [],
      execution_cost_read_count: 55,
      execution_cost_read_length: 88420,
      execution_cost_runtime: 116256000,
      execution_cost_write_count: 9,
      execution_cost_write_length: 339,
      tx_type: 'contract_call',
      contract_call: {
        contract_id: 'SP3YK7KWMYRCDMV5M4792T0T7DERQXHJJGGEPV1N8.pg-mdomains-v1',
        function_name: 'bns-name-preorder',
        function_signature:
          '(define-public (bns-name-preorder (hashedSaltedFqn (buff 20)) (stxToBurn uint) (paymentSIP010Trait trait_reference) (reciprocityTokenTrait trait_reference) (referencerWallet principal)))',
        function_args: [
          {
            hex: '0x020000000474657374',
            name: 'hashedSaltedFqn',
            repr: '0x74657374',
            type: '(buff 20)',
          },
          {
            hex: '0x01000000000000000000000000000004d2',
            name: 'stxToBurn',
            repr: 'u1234',
            type: 'uint',
          },
        ],
      },
    };

    const dataStoreUpdate: DataStoreBlockUpdateData = {
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx1,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [{ ...contractCall }],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
        },
        {
          tx: tx2,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [{ ...contractCall2 }],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    };

    await db.update(dataStoreUpdate);

    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${tx1.tx_id}`);
    expect(JSON.parse(searchResult1.text)).toEqual(expected);

    const expected2 = {
      tx_id: '0x1513739d6a3f86d4597f5296cc536f6890e2affff9aece285e37399be697b43f',
      nonce: 0,
      fee_rate: '139200',
      sender_address: 'SPX3DV9X9CGA8P14B3CMP2X8DBW6ZDXEAXDNPTER',
      sponsored: false,
      post_condition_mode: 'allow',
      post_conditions: [],
      anchor_mode: 'any',
      is_unanchored: false,
      block_hash: '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb663139',
      parent_block_hash: '0x',
      block_height: 1,
      burn_block_time: 1637003433,
      burn_block_time_iso: '2021-11-15T19:10:33.000Z',
      parent_burn_block_time: 1637002470,
      parent_burn_block_time_iso: '2021-11-15T18:54:30.000Z',
      canonical: true,
      tx_index: 33,
      tx_status: 'success',
      tx_result: { hex: '0x0100000000000000000000000000000001', repr: 'u1' },
      microblock_hash: '0x',
      microblock_sequence: 2147483647,
      microblock_canonical: true,
      event_count: 6,
      execution_cost_read_count: 55,
      execution_cost_read_length: 88420,
      execution_cost_runtime: 116256000,
      execution_cost_write_count: 9,
      execution_cost_write_length: 339,
      tx_type: 'contract_call',
      contract_call: {
        contract_id: 'SP000000000000000000002Q6VF78.bns',
        function_name: 'name-register',
        function_signature: '',
        function_args: [
          {
            hex: '0x020000000474657374',
            name: '',
            repr: '0x74657374',
            type: '(buff 4)',
          },
          {
            hex: '0x01000000000000000000000000000004d2',
            name: '',
            repr: 'u1234',
            type: 'uint',
          },
        ],
      },
      events: [],
    };
    const searchResult2 = await supertest(api.server).get(`/extended/v1/tx/${tx2.tx_id}`);
    expect(searchResult2.status).toBe(200);
    expect(JSON.parse(searchResult2.text)).toEqual(expected2);

    const expected3 = {
      abi: null,
      block_height: 1,
      canonical: true,
      clarity_version: null,
      contract_id: contractCall2.contract_id,
      source_code: contractCall2.source_code,
      tx_id: contractCall2.tx_id,
    };
    const contractResult1 = await supertest(api.server).get(
      `/extended/v1/contract/${contractCall2.contract_id}`
    );
    expect(contractResult1.status).toBe(200);
    expect(contractResult1.body).toEqual(expected3);

    const expected4 = {
      abi: contractCall.abi,
      block_height: 1,
      canonical: true,
      clarity_version: null,
      contract_id: contractCall.contract_id,
      source_code: contractCall.source_code,
      tx_id: contractCall.tx_id,
    };
    const contractResult2 = await supertest(api.server).get(
      `/extended/v1/contract/${contractCall.contract_id}`
    );
    expect(contractResult2.status).toBe(200);
    expect({ ...contractResult2.body, abi: JSON.parse(contractResult2.body.abi) }).toEqual({
      ...expected4,
      abi: JSON.parse(expected4.abi as string),
    });

    const mempoolTx1: DbMempoolTxRaw = {
      type_id: DbTxTypeId.ContractCall,
      tx_id: '0x4413739d6a3f86d4597f5296cc536f6890e2affff9aece285e37399be697b43f',
      anchor_mode: DbTxAnchorMode.Any,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      status: DbTxStatus.Success,
      post_conditions: '0x01f5',
      fee_rate: 139200n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'SPX3DV9X9CGA8P14B3CMP2X8DBW6ZDXEAXDNPTER',
      origin_hash_mode: 1,
      contract_call_contract_id: 'SP000000000000000000002Q6VF78.bns',
      contract_call_function_name: 'name-register',
      contract_call_function_args: bufferToHexPrefixString(
        createClarityValueArray(bufferCV(Buffer.from('test')), uintCV(1234n))
      ),
      pruned: false,
      receipt_time: 0,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx1] });

    const expectedMempoolResult1 = {
      anchor_mode: 'any',
      contract_call: {
        contract_id: 'SP000000000000000000002Q6VF78.bns',
        function_name: 'name-register',
        function_signature: '',
        function_args: [
          {
            hex: '0x020000000474657374',
            name: '',
            repr: '0x74657374',
            type: '(buff 4)',
          },
          {
            hex: '0x01000000000000000000000000000004d2',
            name: '',
            repr: 'u1234',
            type: 'uint',
          },
        ],
      },
      fee_rate: '139200',
      nonce: 0,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 0,
      receipt_time_iso: '1970-01-01T00:00:00.000Z',
      sender_address: 'SPX3DV9X9CGA8P14B3CMP2X8DBW6ZDXEAXDNPTER',
      sponsored: false,
      tx_id: mempoolTx1.tx_id,
      tx_status: 'success',
      tx_type: 'contract_call',
    };
    const mempoolTxResult1 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx1.tx_id}`);
    expect(mempoolTxResult1.status).toBe(200);
    expect(mempoolTxResult1.body).toEqual(expectedMempoolResult1);

    const mempoolTx2: DbMempoolTxRaw = {
      type_id: DbTxTypeId.ContractCall,
      tx_id: '0x5513739d6a3f86d4597f5296cc536f6890e2affff9aece285e37399be697b43f',
      anchor_mode: DbTxAnchorMode.Any,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      status: DbTxStatus.Success,
      post_conditions: '0x01f5',
      fee_rate: 139200n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'SPX3DV9X9CGA8P14B3CMP2X8DBW6ZDXEAXDNPTER',
      origin_hash_mode: 1,
      contract_call_contract_id: 'SP3YK7KWMYRCDMV5M4792T0T7DERQXHJJGGEPV1N8.pg-mdomains-v1',
      contract_call_function_name: 'bns-name-preorder',
      contract_call_function_args: bufferToHexPrefixString(
        createClarityValueArray(bufferCV(Buffer.from('test')), uintCV(1234n))
      ),
      pruned: false,
      receipt_time: 0,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx2] });

    const expectedMempoolResult2 = {
      anchor_mode: 'any',
      contract_call: {
        contract_id: 'SP3YK7KWMYRCDMV5M4792T0T7DERQXHJJGGEPV1N8.pg-mdomains-v1',
        function_args: [
          {
            hex: '0x020000000474657374',
            name: 'hashedSaltedFqn',
            repr: '0x74657374',
            type: '(buff 20)',
          },
          {
            hex: '0x01000000000000000000000000000004d2',
            name: 'stxToBurn',
            repr: 'u1234',
            type: 'uint',
          },
        ],
        function_name: 'bns-name-preorder',
        function_signature:
          '(define-public (bns-name-preorder (hashedSaltedFqn (buff 20)) (stxToBurn uint) (paymentSIP010Trait trait_reference) (reciprocityTokenTrait trait_reference) (referencerWallet principal)))',
      },
      fee_rate: '139200',
      nonce: 0,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 0,
      receipt_time_iso: '1970-01-01T00:00:00.000Z',
      sender_address: 'SPX3DV9X9CGA8P14B3CMP2X8DBW6ZDXEAXDNPTER',
      sponsored: false,
      tx_id: mempoolTx2.tx_id,
      tx_status: 'success',
      tx_type: 'contract_call',
    };
    const mempoolTxResult2 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx2.tx_id}`);
    expect(mempoolTxResult2.status).toBe(200);
    expect(mempoolTxResult2.body).toEqual(expectedMempoolResult2);
  });

  test('fetch transactions from block', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const tx: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: block.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('coinbase hi')),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: block.parent_microblock_hash,
      parent_block_hash: block.parent_index_block_hash,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.update({
      block,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });
    const result = await supertest(api.server).get(
      `/extended/v1/tx/block/${block.block_hash}?limit=20&offset=0`
    );
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    // fetch all blocks
    const result1 = await supertest(api.server).get(`/extended/v1/block`);
    expect(result1.body.total).toBe(1);
    expect(result1.body.results[0].hash).toBe('0x1234');
    expect(result1.body.results[0].index_block_hash).toBe('0xdeadbeef');
  });

  test('fetch transactions from block', async () => {
    const not_updated_tx_id = '0x1111';
    const tx_not_found = {
      error: `could not find transaction by ID ${not_updated_tx_id}`,
    };
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateBlock(client, block);
    const tx: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('')),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: block.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('coinbase hi')),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: block.parent_index_block_hash,
      parent_block_hash: block.parent_block_hash,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, tx);
    const result1 = await supertest(api.server).get(`/extended/v1/tx/block/${block.block_hash}`);
    expect(result1.status).toBe(200);
    expect(result1.type).toBe('application/json');
    expect(result1.body.limit).toBe(getPagingQueryLimit(ResourceType.Tx));
    expect(result1.body.offset).toBe(0);
    expect(result1.body.total).toBe(1);
    expect(result1.body.results.length).toBe(1);

    const result2 = await supertest(api.server).get(
      `/extended/v1/tx/block/${block.block_hash}?limit=20&offset=15`
    );
    expect(result2.body.limit).toBe(20);
    expect(result2.body.offset).toBe(15);
    expect(result2.body.total).toBe(1);
    expect(result2.body.results.length).toBe(0);

    const result3 = await supertest(api.server).get(
      `/extended/v1/tx/block_height/${block.block_height}`
    );
    expect(result3.status).toBe(200);
    expect(result3.type).toBe('application/json');
    expect(result3.body.limit).toBe(getPagingQueryLimit(ResourceType.Tx));
    expect(result3.body.offset).toBe(0);
    expect(result3.body.total).toBe(1);
    expect(result3.body.results.length).toBe(1);

    const result4 = await supertest(api.server).get(
      `/extended/v1/tx/block_height/${block.block_height}?limit=20&offset=15`
    );
    expect(result4.body.limit).toBe(20);
    expect(result4.body.offset).toBe(15);
    expect(result4.body.total).toBe(1);
    expect(result4.body.results.length).toBe(0);

    // not available tx
    const result5 = await supertest(api.server).get(`/extended/v1/tx/${not_updated_tx_id}`);
    expect(JSON.parse(result5.text)).toEqual(tx_not_found);
  });

  test('paginate transactions by block', async () => {
    let blockBuilder1 = new TestBlockBuilder();
    for (let i = 0; i < 12; i++) {
      blockBuilder1 = blockBuilder1.addTx({
        tx_index: i,
        tx_id: `0x00${i.toString().padStart(2, '0')}`,
      });
    }
    const block1 = blockBuilder1.build();
    // move around some tx insert orders
    const tx1 = block1.txs[1];
    const tx2 = block1.txs[5];
    const tx3 = block1.txs[10];
    const tx4 = block1.txs[11];
    block1.txs[1] = tx4;
    block1.txs[5] = tx3;
    block1.txs[10] = tx2;
    block1.txs[11] = tx1;
    await db.update(block1);

    // Insert some duplicated, non-canonical txs to ensure they don't cause issues with
    // returned tx list or pagination ordering.
    const nonCanonicalTx1: DbTxRaw = { ...tx1.tx, canonical: false, microblock_hash: '0xaa' };
    await db.updateTx(client, nonCanonicalTx1);
    const nonCanonicalTx2: DbTxRaw = {
      ...tx2.tx,
      microblock_canonical: false,
      microblock_hash: '0xbb',
    };
    await db.updateTx(client, nonCanonicalTx2);

    const result1 = await supertest(api.server).get(
      `/extended/v1/tx/block_height/${block1.block.block_height}?limit=4&offset=0`
    );
    expect(result1.status).toBe(200);
    expect(result1.type).toBe('application/json');
    expect(result1.body).toEqual(
      expect.objectContaining({
        total: 12,
        limit: 4,
        offset: 0,
        results: expect.arrayContaining([
          expect.objectContaining({
            tx_id: '0x0011',
            tx_index: 11,
          }),
          expect.objectContaining({
            tx_id: '0x0010',
            tx_index: 10,
          }),
          expect.objectContaining({
            tx_id: '0x0009',
            tx_index: 9,
          }),
          expect.objectContaining({
            tx_id: '0x0008',
            tx_index: 8,
          }),
        ]),
      })
    );

    const result2 = await supertest(api.server).get(
      `/extended/v1/tx/block_height/${block1.block.block_height}?limit=4&offset=4`
    );
    expect(result2.status).toBe(200);
    expect(result2.type).toBe('application/json');
    expect(result2.body).toEqual(
      expect.objectContaining({
        total: 12,
        limit: 4,
        offset: 4,
        results: expect.arrayContaining([
          expect.objectContaining({
            tx_id: '0x0007',
            tx_index: 7,
          }),
          expect.objectContaining({
            tx_id: '0x0006',
            tx_index: 6,
          }),
          expect.objectContaining({
            tx_id: '0x0005',
            tx_index: 5,
          }),
          expect.objectContaining({
            tx_id: '0x0004',
            tx_index: 4,
          }),
        ]),
      })
    );

    const result3 = await supertest(api.server).get(
      `/extended/v1/tx/block_height/${block1.block.block_height}?limit=4&offset=8`
    );
    expect(result3.status).toBe(200);
    expect(result3.type).toBe('application/json');
    expect(result3.body).toEqual(
      expect.objectContaining({
        total: 12,
        limit: 4,
        offset: 8,
        results: expect.arrayContaining([
          expect.objectContaining({
            tx_id: '0x0003',
            tx_index: 3,
          }),
          expect.objectContaining({
            tx_id: '0x0002',
            tx_index: 2,
          }),
          expect.objectContaining({
            tx_id: '0x0001',
            tx_index: 1,
          }),
          expect.objectContaining({
            tx_id: '0x0000',
            tx_index: 0,
          }),
        ]),
      })
    );
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
