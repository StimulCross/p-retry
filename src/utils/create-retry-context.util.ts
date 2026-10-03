import type { RetryContext } from '../types/index.js'

/** @internal */
export function createRetryContext(
	error: Error,
	attemptNumber: number,
	retriesLeft: number,
	retriesConsumed: number,
	retryDelay: number,
): RetryContext {
	return Object.freeze({
		error,
		attemptNumber,
		retriesLeft,
		retriesConsumed,
		retryDelay,
	})
}
