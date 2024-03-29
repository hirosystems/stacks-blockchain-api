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
/**
 * POST request that initiates a transfer of tokens to a specified testnet address
 * @export
 * @interface RunFaucetResponse
 */
export interface RunFaucetResponse {
    /**
     * Indicates if the faucet call was successful
     * @type {boolean}
     * @memberof RunFaucetResponse
     */
    success: boolean;
    /**
     * The transaction ID for the faucet call
     * @type {string}
     * @memberof RunFaucetResponse
     */
    txId?: string;
    /**
     * Raw transaction in hex string representation
     * @type {string}
     * @memberof RunFaucetResponse
     */
    txRaw?: string;
}

export function RunFaucetResponseFromJSON(json: any): RunFaucetResponse {
    return RunFaucetResponseFromJSONTyped(json, false);
}

export function RunFaucetResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): RunFaucetResponse {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'success': json['success'],
        'txId': !exists(json, 'txId') ? undefined : json['txId'],
        'txRaw': !exists(json, 'txRaw') ? undefined : json['txRaw'],
    };
}

export function RunFaucetResponseToJSON(value?: RunFaucetResponse | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'success': value.success,
        'txId': value.txId,
        'txRaw': value.txRaw,
    };
}

