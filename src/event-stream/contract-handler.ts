import { DbBnsName, DbBnsNamespace } from './../../src/datastore/common';
import {
  BnsContractIdentifier,
  nameFunctions,
  namespaceReadyFunction,
  printTopic,
} from './../../src/bns-constants';
import { SmartContractEvent } from './core-node-message';
import { addressToString } from '@stacks/transactions';
import {
  getFunctionName,
  parseNameRawValue,
  parseNamespaceRawValue,
} from './../../src/bns-helpers';

export interface SmartContractEventExtracts {
  event: SmartContractEvent;
  functionName: string;
  block_height: number;
  index_block_hash: string;
}

export function handleContractEvent(extracts: SmartContractEventExtracts) {
  const { topic, contract_identifier, raw_value } = extracts.event.contract_event;
  const { txid } = extracts.event;

  if (
    topic === printTopic &&
    (contract_identifier === BnsContractIdentifier.mainnet ||
      contract_identifier === BnsContractIdentifier.testnet)
  ) {
    const { functionName, block_height, index_block_hash } = extracts;
    handleBnsEvent(functionName, raw_value, block_height, index_block_hash, txid);
  } else {
    // todo add condition for token contract identifiers etc.
    handleTokenEvent();
  }
}

function handleBnsEvent(
  bnsFunctionName: string,
  bnsRawValue: string,
  block_height: number,
  index_block_hash: string,
  txid: string
) {
  if (nameFunctions.includes(bnsFunctionName)) {
    //todo change name functions variable name
    // const attachment = parseNameRawValue(event.contract_event.raw_value);
    const attachment = parseNameRawValue(bnsRawValue);
    const name: DbBnsName = {
      name: attachment.attachment.metadata.name.concat(
        '.',
        attachment.attachment.metadata.namespace
      ),
      namespace_id: attachment.attachment.metadata.namespace,
      address: addressToString(attachment.attachment.metadata.tx_sender),
      expire_block: 0,
      registered_at: block_height,
      zonefile_hash: attachment.attachment.hash,
      zonefile: '', //zone file will be updated in  /attachments/new
      latest: true,
      tx_id: txid,
      status: attachment.attachment.metadata.op,
      index_block_hash: index_block_hash,
      canonical: true,
      atch_resolved: false, //saving an unresoved BNS name
    };
    // dbTx.names.push(name);
  }
  if (bnsFunctionName === namespaceReadyFunction) {
    //event received for namespaces
    const namespace: DbBnsNamespace | undefined = parseNamespaceRawValue(
      bnsRawValue,
      block_height,
      txid,
      index_block_hash
    );
    if (namespace != undefined) {
      // dbTx.namespaces.push(namespace);
    }
  }
}

function handleTokenEvent() {
  throw Error('not yet implmented');
}
