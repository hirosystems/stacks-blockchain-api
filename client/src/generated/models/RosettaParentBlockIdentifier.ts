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
 * The block_identifier uniquely identifies a block in a particular network.
 * @export
 * @interface RosettaParentBlockIdentifier
 */
export interface RosettaParentBlockIdentifier {
    /**
     * This is also known as the block height.
     * @type {number}
     * @memberof RosettaParentBlockIdentifier
     */
    index: number;
    /**
     * Block hash
     * @type {string}
     * @memberof RosettaParentBlockIdentifier
     */
    hash: string;
}

export function RosettaParentBlockIdentifierFromJSON(json: any): RosettaParentBlockIdentifier {
    return RosettaParentBlockIdentifierFromJSONTyped(json, false);
}

export function RosettaParentBlockIdentifierFromJSONTyped(json: any, ignoreDiscriminator: boolean): RosettaParentBlockIdentifier {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'index': json['index'],
        'hash': json['hash'],
    };
}

export function RosettaParentBlockIdentifierToJSON(value?: RosettaParentBlockIdentifier | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'index': value.index,
        'hash': value.hash,
    };
}

