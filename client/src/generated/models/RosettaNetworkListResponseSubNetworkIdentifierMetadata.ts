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
 * Meta data from subnetwork identifier
 * @export
 * @interface RosettaNetworkListResponseSubNetworkIdentifierMetadata
 */
export interface RosettaNetworkListResponseSubNetworkIdentifierMetadata {
    /**
     * producer
     * @type {string}
     * @memberof RosettaNetworkListResponseSubNetworkIdentifierMetadata
     */
    producer: string;
}

export function RosettaNetworkListResponseSubNetworkIdentifierMetadataFromJSON(json: any): RosettaNetworkListResponseSubNetworkIdentifierMetadata {
    return RosettaNetworkListResponseSubNetworkIdentifierMetadataFromJSONTyped(json, false);
}

export function RosettaNetworkListResponseSubNetworkIdentifierMetadataFromJSONTyped(json: any, ignoreDiscriminator: boolean): RosettaNetworkListResponseSubNetworkIdentifierMetadata {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'producer': json['producer'],
    };
}

export function RosettaNetworkListResponseSubNetworkIdentifierMetadataToJSON(value?: RosettaNetworkListResponseSubNetworkIdentifierMetadata | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'producer': value.producer,
    };
}

