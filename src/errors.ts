export class StacksMessageParsingError extends Error {
  constructor(message: string) {
    super(message);
    this.message = message;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

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
