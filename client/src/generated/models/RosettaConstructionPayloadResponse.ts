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
    SigningPayload,
    SigningPayloadFromJSON,
    SigningPayloadFromJSONTyped,
    SigningPayloadToJSON,
} from './';

/**
 * RosettaConstructionPayloadResponse is returned by /construction/payloads. It contains an unsigned transaction blob (that is usually needed to construct the a network transaction from a collection of signatures) and an array of payloads that must be signed by the caller.
 * @export
 * @interface RosettaConstructionPayloadResponse
 */
export interface RosettaConstructionPayloadResponse {
    /**
     * This is an unsigned transaction blob (that is usually needed to construct the a network transaction from a collection of signatures)
     * @type {string}
     * @memberof RosettaConstructionPayloadResponse
     */
    unsigned_transaction: string;
    /**
     * An array of payloads that must be signed by the caller
     * @type {Array<SigningPayload>}
     * @memberof RosettaConstructionPayloadResponse
     */
    payloads: Array<SigningPayload>;
}

export function RosettaConstructionPayloadResponseFromJSON(json: any): RosettaConstructionPayloadResponse {
    return RosettaConstructionPayloadResponseFromJSONTyped(json, false);
}

export function RosettaConstructionPayloadResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): RosettaConstructionPayloadResponse {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'unsigned_transaction': json['unsigned_transaction'],
        'payloads': ((json['payloads'] as Array<any>).map(SigningPayloadFromJSON)),
    };
}

export function RosettaConstructionPayloadResponseToJSON(value?: RosettaConstructionPayloadResponse | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'unsigned_transaction': value.unsigned_transaction,
        'payloads': ((value.payloads as Array<any>).map(SigningPayloadToJSON)),
    };
}

