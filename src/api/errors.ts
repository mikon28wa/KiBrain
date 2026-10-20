/**
 * Application-level HTTP error carrying a client-safe status code and message.
 * Thrown by route handlers and mapped to a JSON response in the central error
 * handler registered in `src/api/index.ts`.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
