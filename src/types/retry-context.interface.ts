export interface RetryContext {
	readonly error: Error;
	readonly attemptNumber: number;
	readonly retriesLeft: number;
}
