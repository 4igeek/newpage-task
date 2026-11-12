/**
 * Errors thrown by services. They describe *what* went wrong in domain terms;
 * the HTTP layer decides how each code maps to a status code.
 */
export type DomainErrorCode =
  | 'UNSUPPORTED_FILE_TYPE'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'NOT_FOUND'
  | 'NO_EXTRACTABLE_TEXT';

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
