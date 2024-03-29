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
 * 
 * @export
 * @interface StxBalance
 */
export interface StxBalance {
    /**
     * 
     * @type {string}
     * @memberof StxBalance
     */
    balance: string;
    /**
     * 
     * @type {string}
     * @memberof StxBalance
     */
    total_sent: string;
    /**
     * 
     * @type {string}
     * @memberof StxBalance
     */
    total_received: string;
    /**
     * 
     * @type {string}
     * @memberof StxBalance
     */
    total_fees_sent: string;
    /**
     * 
     * @type {string}
     * @memberof StxBalance
     */
    total_miner_rewards_received: string;
    /**
     * The transaction where the lock event occurred. Empty if no tokens are locked.
     * @type {string}
     * @memberof StxBalance
     */
    lock_tx_id: string;
    /**
     * The amount of locked STX, as string quoted micro-STX. Zero if no tokens are locked.
     * @type {string}
     * @memberof StxBalance
     */
    locked: string;
    /**
     * The STX chain block height of when the lock event occurred. Zero if no tokens are locked.
     * @type {number}
     * @memberof StxBalance
     */
    lock_height: number;
    /**
     * The burnchain block height of when the lock event occurred. Zero if no tokens are locked.
     * @type {number}
     * @memberof StxBalance
     */
    burnchain_lock_height: number;
    /**
     * The burnchain block height of when the tokens unlock. Zero if no tokens are locked.
     * @type {number}
     * @memberof StxBalance
     */
    burnchain_unlock_height: number;
}

export function StxBalanceFromJSON(json: any): StxBalance {
    return StxBalanceFromJSONTyped(json, false);
}

export function StxBalanceFromJSONTyped(json: any, ignoreDiscriminator: boolean): StxBalance {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'balance': json['balance'],
        'total_sent': json['total_sent'],
        'total_received': json['total_received'],
        'total_fees_sent': json['total_fees_sent'],
        'total_miner_rewards_received': json['total_miner_rewards_received'],
        'lock_tx_id': json['lock_tx_id'],
        'locked': json['locked'],
        'lock_height': json['lock_height'],
        'burnchain_lock_height': json['burnchain_lock_height'],
        'burnchain_unlock_height': json['burnchain_unlock_height'],
    };
}

export function StxBalanceToJSON(value?: StxBalance | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'balance': value.balance,
        'total_sent': value.total_sent,
        'total_received': value.total_received,
        'total_fees_sent': value.total_fees_sent,
        'total_miner_rewards_received': value.total_miner_rewards_received,
        'lock_tx_id': value.lock_tx_id,
        'locked': value.locked,
        'lock_height': value.lock_height,
        'burnchain_lock_height': value.burnchain_lock_height,
        'burnchain_unlock_height': value.burnchain_unlock_height,
    };
}

