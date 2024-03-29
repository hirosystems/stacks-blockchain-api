/* tslint:disable */
/* eslint-disable */
/**
 * Stacks Blockchain API
 * Welcome to the API reference overview for the <a href=\"https://docs.hiro.so/get-started/stacks-blockchain-api\">Stacks Blockchain API</a>.  <a href=\"https://hirosystems.github.io/stacks-blockchain-api/collection.json\" download=\"stacks-api-collection.json\">Download Postman collection</a> 
 *
 * The version of the OpenAPI document: STACKS_API_VERSION
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { exists, mapValues } from '../runtime';
import {
    RosettaAccountBalanceResponseMetadata,
    RosettaAccountBalanceResponseMetadataFromJSON,
    RosettaAccountBalanceResponseMetadataFromJSONTyped,
    RosettaAccountBalanceResponseMetadataToJSON,
    RosettaAmount,
    RosettaAmountFromJSON,
    RosettaAmountFromJSONTyped,
    RosettaAmountToJSON,
    RosettaCoin,
    RosettaCoinFromJSON,
    RosettaCoinFromJSONTyped,
    RosettaCoinToJSON,
} from './';

/**
 * An AccountBalanceResponse is returned on the /account/balance endpoint. If an account has a balance for each AccountIdentifier describing it (ex: an ERC-20 token balance on a few smart contracts), an account balance request must be made with each AccountIdentifier.
 * @export
 * @interface RosettaAccountBalanceResponse
 */
export interface RosettaAccountBalanceResponse {
    /**
     * The block_identifier uniquely identifies a block in a particular network.
     * @type {object}
     * @memberof RosettaAccountBalanceResponse
     */
    block_identifier: object | null;
    /**
     * A single account balance may have multiple currencies
     * @type {Array<RosettaAmount>}
     * @memberof RosettaAccountBalanceResponse
     */
    balances: Array<RosettaAmount>;
    /**
     * If a blockchain is UTXO-based, all unspent Coins owned by an account_identifier should be returned alongside the balance. It is highly recommended to populate this field so that users of the Rosetta API implementation don't need to maintain their own indexer to track their UTXOs.
     * @type {Array<RosettaCoin>}
     * @memberof RosettaAccountBalanceResponse
     */
    coins?: Array<RosettaCoin>;
    /**
     * 
     * @type {RosettaAccountBalanceResponseMetadata}
     * @memberof RosettaAccountBalanceResponse
     */
    metadata?: RosettaAccountBalanceResponseMetadata;
}

export function RosettaAccountBalanceResponseFromJSON(json: any): RosettaAccountBalanceResponse {
    return RosettaAccountBalanceResponseFromJSONTyped(json, false);
}

export function RosettaAccountBalanceResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): RosettaAccountBalanceResponse {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'block_identifier': json['block_identifier'],
        'balances': ((json['balances'] as Array<any>).map(RosettaAmountFromJSON)),
        'coins': !exists(json, 'coins') ? undefined : ((json['coins'] as Array<any>).map(RosettaCoinFromJSON)),
        'metadata': !exists(json, 'metadata') ? undefined : RosettaAccountBalanceResponseMetadataFromJSON(json['metadata']),
    };
}

export function RosettaAccountBalanceResponseToJSON(value?: RosettaAccountBalanceResponse | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'block_identifier': value.block_identifier,
        'balances': ((value.balances as Array<any>).map(RosettaAmountToJSON)),
        'coins': value.coins === undefined ? undefined : ((value.coins as Array<any>).map(RosettaCoinToJSON)),
        'metadata': RosettaAccountBalanceResponseMetadataToJSON(value.metadata),
    };
}

