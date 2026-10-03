/**
 * Operation executed until it succeeds or retrying stops.
 *
 * @param attemptNumber - Current attempt number, starting at 1.
 *
 * @returns A value or promise-like result. Returning a value or fulfilling
 * the result completes the operation; throwing or rejecting triggers failure handling.
 */
export type InputFunction<T = unknown> = (attemptNumber: number) => PromiseLike<T> | T
