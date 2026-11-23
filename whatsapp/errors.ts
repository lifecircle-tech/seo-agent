// An error with the HTTP status and machine-readable code the API returns
// for it: { success: false, code, error, details }.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
