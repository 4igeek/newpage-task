/**
 * Errors thrown by services. They describe *what* went wrong in domain terms;
 * the HTTP layer decides how each code maps to a status code.
 */
export type DomainErrorCode =
  | 'UNSUPPORTED_FILE_TYPE'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'NOT_FOUND'
  | 'NO_EXTRACTABLE_TEXT'
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_AUTH_FAILED'
  | 'LLM_RATE_LIMITED'
  | 'LLM_UNAVAILABLE';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** A failure that retrying cannot fix (e.g. a scanned PDF with no text layer). */
export class PermanentIngestionError extends DomainError {
  override name = 'PermanentIngestionError';
}

/** The language model could not be reached or rejected the request. */
export class LLMError extends DomainError {
  override name = 'LLMError';
}
