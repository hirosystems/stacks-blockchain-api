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
    NetworkIdentifier,
    NetworkIdentifierFromJSON,
    NetworkIdentifierFromJSONTyped,
    NetworkIdentifierToJSON,
    RosettaOptions,
    RosettaOptionsFromJSON,
    RosettaOptionsFromJSONTyped,
    RosettaOptionsToJSON,
    RosettaPublicKey,
    RosettaPublicKeyFromJSON,
    RosettaPublicKeyFromJSONTyped,
    RosettaPublicKeyToJSON,
} from './';

/**
 * A ConstructionMetadataRequest is utilized to get information required to construct a transaction. The Options object used to specify which metadata to return is left purposely unstructured to allow flexibility for implementers. Optionally, the request can also include an array of PublicKeys associated with the AccountIdentifiers returned in ConstructionPreprocessResponse.
 * @export
 * @interface RosettaConstructionMetadataRequest
 */
export interface RosettaConstructionMetadataRequest {
    /**
     * 
     * @type {NetworkIdentifier}
     * @memberof RosettaConstructionMetadataRequest
     */
    network_identifier: NetworkIdentifier;
    /**
     * 
     * @type {RosettaOptions}
     * @memberof RosettaConstructionMetadataRequest
     */
    options: RosettaOptions;
    /**
     * 
     * @type {Array<RosettaPublicKey>}
     * @memberof RosettaConstructionMetadataRequest
     */
    public_keys?: Array<RosettaPublicKey>;
}

export function RosettaConstructionMetadataRequestFromJSON(json: any): RosettaConstructionMetadataRequest {
    return RosettaConstructionMetadataRequestFromJSONTyped(json, false);
}

export function RosettaConstructionMetadataRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): RosettaConstructionMetadataRequest {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'network_identifier': NetworkIdentifierFromJSON(json['network_identifier']),
        'options': RosettaOptionsFromJSON(json['options']),
        'public_keys': !exists(json, 'public_keys') ? undefined : ((json['public_keys'] as Array<any>).map(RosettaPublicKeyFromJSON)),
    };
}

export function RosettaConstructionMetadataRequestToJSON(value?: RosettaConstructionMetadataRequest | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'network_identifier': NetworkIdentifierToJSON(value.network_identifier),
        'options': RosettaOptionsToJSON(value.options),
        'public_keys': value.public_keys === undefined ? undefined : ((value.public_keys as Array<any>).map(RosettaPublicKeyToJSON)),
    };
}

