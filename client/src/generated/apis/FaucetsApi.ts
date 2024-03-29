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


import * as runtime from '../runtime';
import {
    InlineObject,
    InlineObjectFromJSON,
    InlineObjectToJSON,
    InlineResponse403,
    InlineResponse403FromJSON,
    InlineResponse403ToJSON,
    RunFaucetResponse,
    RunFaucetResponseFromJSON,
    RunFaucetResponseToJSON,
} from '../models';

export interface RunFaucetBtcRequest {
    address: string;
    inlineObject?: InlineObject;
}

export interface RunFaucetStxRequest {
    address: string;
    stacking?: boolean;
}

/**
 * FaucetsApi - interface
 * 
 * @export
 * @interface FaucetsApiInterface
 */
export interface FaucetsApiInterface {
    /**
     * Add 1 BTC token to the specified testnet BTC address.  The endpoint returns the transaction ID, which you can use to view the transaction in a testnet Bitcoin block explorer. The tokens are delivered once the transaction has been included in a block.  **Note:** This is a testnet only endpoint. This endpoint will not work on the mainnet. 
     * @summary Add testnet BTC tokens to address
     * @param {string} address A valid testnet BTC address
     * @param {InlineObject} [inlineObject] 
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     * @memberof FaucetsApiInterface
     */
    runFaucetBtcRaw(requestParameters: RunFaucetBtcRequest, initOverrides?: RequestInit): Promise<runtime.ApiResponse<RunFaucetResponse>>;

    /**
     * Add 1 BTC token to the specified testnet BTC address.  The endpoint returns the transaction ID, which you can use to view the transaction in a testnet Bitcoin block explorer. The tokens are delivered once the transaction has been included in a block.  **Note:** This is a testnet only endpoint. This endpoint will not work on the mainnet. 
     * Add testnet BTC tokens to address
     */
    runFaucetBtc(requestParameters: RunFaucetBtcRequest, initOverrides?: RequestInit): Promise<RunFaucetResponse>;

    /**
     * Add 500 STX tokens to the specified testnet address. Testnet STX addresses begin with `ST`. If the `stacking` parameter is set to `true`, the faucet will add the required number of tokens for individual stacking to the specified testnet address.  The endpoint returns the transaction ID, which you can use to view the transaction in the [Stacks Explorer](https://explorer.hiro.so/?chain=testnet). The tokens are delivered once the transaction has been included in an anchor block.  A common reason for failed faucet transactions is that the faucet has run out of tokens. If you are experiencing failed faucet transactions to a testnet address, you can get help in [Discord](https://stacks.chat).  **Note:** This is a testnet only endpoint. This endpoint will not work on the mainnet. 
     * @summary Get STX testnet tokens
     * @param {string} address A valid testnet STX address
     * @param {boolean} [stacking] Request the amount of STX tokens needed for individual address stacking
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     * @memberof FaucetsApiInterface
     */
    runFaucetStxRaw(requestParameters: RunFaucetStxRequest, initOverrides?: RequestInit): Promise<runtime.ApiResponse<RunFaucetResponse>>;

    /**
     * Add 500 STX tokens to the specified testnet address. Testnet STX addresses begin with `ST`. If the `stacking` parameter is set to `true`, the faucet will add the required number of tokens for individual stacking to the specified testnet address.  The endpoint returns the transaction ID, which you can use to view the transaction in the [Stacks Explorer](https://explorer.hiro.so/?chain=testnet). The tokens are delivered once the transaction has been included in an anchor block.  A common reason for failed faucet transactions is that the faucet has run out of tokens. If you are experiencing failed faucet transactions to a testnet address, you can get help in [Discord](https://stacks.chat).  **Note:** This is a testnet only endpoint. This endpoint will not work on the mainnet. 
     * Get STX testnet tokens
     */
    runFaucetStx(requestParameters: RunFaucetStxRequest, initOverrides?: RequestInit): Promise<RunFaucetResponse>;

}

/**
 * 
 */
export class FaucetsApi extends runtime.BaseAPI implements FaucetsApiInterface {

    /**
     * Add 1 BTC token to the specified testnet BTC address.  The endpoint returns the transaction ID, which you can use to view the transaction in a testnet Bitcoin block explorer. The tokens are delivered once the transaction has been included in a block.  **Note:** This is a testnet only endpoint. This endpoint will not work on the mainnet. 
     * Add testnet BTC tokens to address
     */
    async runFaucetBtcRaw(requestParameters: RunFaucetBtcRequest, initOverrides?: RequestInit): Promise<runtime.ApiResponse<RunFaucetResponse>> {
        if (requestParameters.address === null || requestParameters.address === undefined) {
            throw new runtime.RequiredError('address','Required parameter requestParameters.address was null or undefined when calling runFaucetBtc.');
        }

        const queryParameters: any = {};

        if (requestParameters.address !== undefined) {
            queryParameters['address'] = requestParameters.address;
        }

        const headerParameters: runtime.HTTPHeaders = {};

        headerParameters['Content-Type'] = 'application/json';

        const response = await this.request({
            path: `/extended/v1/faucets/btc`,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: InlineObjectToJSON(requestParameters.inlineObject),
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => RunFaucetResponseFromJSON(jsonValue));
    }

    /**
     * Add 1 BTC token to the specified testnet BTC address.  The endpoint returns the transaction ID, which you can use to view the transaction in a testnet Bitcoin block explorer. The tokens are delivered once the transaction has been included in a block.  **Note:** This is a testnet only endpoint. This endpoint will not work on the mainnet. 
     * Add testnet BTC tokens to address
     */
    async runFaucetBtc(requestParameters: RunFaucetBtcRequest, initOverrides?: RequestInit): Promise<RunFaucetResponse> {
        const response = await this.runFaucetBtcRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Add 500 STX tokens to the specified testnet address. Testnet STX addresses begin with `ST`. If the `stacking` parameter is set to `true`, the faucet will add the required number of tokens for individual stacking to the specified testnet address.  The endpoint returns the transaction ID, which you can use to view the transaction in the [Stacks Explorer](https://explorer.hiro.so/?chain=testnet). The tokens are delivered once the transaction has been included in an anchor block.  A common reason for failed faucet transactions is that the faucet has run out of tokens. If you are experiencing failed faucet transactions to a testnet address, you can get help in [Discord](https://stacks.chat).  **Note:** This is a testnet only endpoint. This endpoint will not work on the mainnet. 
     * Get STX testnet tokens
     */
    async runFaucetStxRaw(requestParameters: RunFaucetStxRequest, initOverrides?: RequestInit): Promise<runtime.ApiResponse<RunFaucetResponse>> {
        if (requestParameters.address === null || requestParameters.address === undefined) {
            throw new runtime.RequiredError('address','Required parameter requestParameters.address was null or undefined when calling runFaucetStx.');
        }

        const queryParameters: any = {};

        if (requestParameters.address !== undefined) {
            queryParameters['address'] = requestParameters.address;
        }

        if (requestParameters.stacking !== undefined) {
            queryParameters['stacking'] = requestParameters.stacking;
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/extended/v1/faucets/stx`,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => RunFaucetResponseFromJSON(jsonValue));
    }

    /**
     * Add 500 STX tokens to the specified testnet address. Testnet STX addresses begin with `ST`. If the `stacking` parameter is set to `true`, the faucet will add the required number of tokens for individual stacking to the specified testnet address.  The endpoint returns the transaction ID, which you can use to view the transaction in the [Stacks Explorer](https://explorer.hiro.so/?chain=testnet). The tokens are delivered once the transaction has been included in an anchor block.  A common reason for failed faucet transactions is that the faucet has run out of tokens. If you are experiencing failed faucet transactions to a testnet address, you can get help in [Discord](https://stacks.chat).  **Note:** This is a testnet only endpoint. This endpoint will not work on the mainnet. 
     * Get STX testnet tokens
     */
    async runFaucetStx(requestParameters: RunFaucetStxRequest, initOverrides?: RequestInit): Promise<RunFaucetResponse> {
        const response = await this.runFaucetStxRaw(requestParameters, initOverrides);
        return await response.value();
    }

}
