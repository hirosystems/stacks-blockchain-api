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
 * Request to fetch fee for a transaction
 * @export
 * @interface FeeRateRequest
 */
export interface FeeRateRequest {
    /**
     * A serialized transaction
     * @type {string}
     * @memberof FeeRateRequest
     */
    transaction: string;
}

export function FeeRateRequestFromJSON(json: any): FeeRateRequest {
    return FeeRateRequestFromJSONTyped(json, false);
}

export function FeeRateRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): FeeRateRequest {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'transaction': json['transaction'],
    };
}

export function FeeRateRequestToJSON(value?: FeeRateRequest | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'transaction': value.transaction,
    };
}

