export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.message = message;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// This class and enum are to throw errors that are supposed to be sent to the client
export enum InvalidRequestErrorType {
  invalid_hash = 'Invalid hash',
  bad_request = 'Bad request',
  invalid_param = 'Invalid param',
  invalid_address = 'Invalid address',
  invalid_query = 'Invalid query',
}
export class InvalidRequestError extends Error {
  type: InvalidRequestErrorType;
  status: number;
  constructor(msg: string, type: InvalidRequestErrorType, status: number = 400) {
    super(msg);
    this.type = type;
    this.status = status;
  }
}

export class BtcFaucetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
