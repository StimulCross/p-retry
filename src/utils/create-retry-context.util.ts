import { type RetryContext } from '../types';

export function createRetryContext(error: Error, attemptNumber: number, retries: number): RetryContext {
	// Minus 1 from attemptNumber because the first attempt does not count as a retry
	const retriesLeft = retries - (attemptNumber - 1);

	return Object.freeze({
		error,
		attemptNumber,
		retriesLeft,
	});
}
