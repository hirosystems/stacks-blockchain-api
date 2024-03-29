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
    RosettaCurrency,
    RosettaCurrencyFromJSON,
    RosettaCurrencyFromJSONTyped,
    RosettaCurrencyToJSON,
} from './';

/**
 * Amount is some Value of a Currency. It is considered invalid to specify a Value without a Currency.
 * @export
 * @interface RosettaAmount
 */
export interface RosettaAmount {
    /**
     * Value of the transaction in atomic units represented as an arbitrary-sized signed integer. For example, 1 BTC would be represented by a value of 100000000.
     * @type {string}
     * @memberof RosettaAmount
     */
    value: string;
    /**
     * 
     * @type {RosettaCurrency}
     * @memberof RosettaAmount
     */
    currency: RosettaCurrency;
    /**
     * 
     * @type {object}
     * @memberof RosettaAmount
     */
    metadata?: object;
}

export function RosettaAmountFromJSON(json: any): RosettaAmount {
    return RosettaAmountFromJSONTyped(json, false);
}

export function RosettaAmountFromJSONTyped(json: any, ignoreDiscriminator: boolean): RosettaAmount {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'value': json['value'],
        'currency': RosettaCurrencyFromJSON(json['currency']),
        'metadata': !exists(json, 'metadata') ? undefined : json['metadata'],
    };
}

export function RosettaAmountToJSON(value?: RosettaAmount | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'value': value.value,
        'currency': RosettaCurrencyToJSON(value.currency),
        'metadata': value.metadata,
    };
}

