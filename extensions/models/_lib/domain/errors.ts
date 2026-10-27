/**
 * Why a domain rule refused something. The API maps each code to one HTTP
 * status: not_allowed 403, not_found 404, invalid_state 409, invalid_input 422.
 */
export type DomainErrorCode =
  | "not_allowed"
  | "not_found"
  | "invalid_state"
  | "invalid_input";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
