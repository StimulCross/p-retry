/**
 * Immutable snapshot of a failed attempt, passed to retry callbacks.
 */
export interface RetryContext {
	/**
	 * The failure error. Non-error throws are normalized to `TypeError`.
	 */
	readonly error: Error

	/**
	 * Number of the failed attempt, starting at `1`.
	 */
	readonly attemptNumber: number

	/**
	 * Remaining retry budget before the current failure consumes a retry.
	 *
	 * `Infinity` when retries are unlimited.
	 */
	readonly retriesLeft: number

	/**
	 * Number of retries consumed before the current failure.
	 *
	 * Failures with skipped consumption do not increase this count.
	 */
	readonly retriesConsumed: number

	/**
	 * Planned backoff delay in milliseconds.
	 *
	 * `0` when consumption is skipped or earlier checks rule out retrying.
	 *
	 * The actual delay may be capped by `maxRetryTime`.
	 *
	 * This value does not guarantee that another attempt will occur.
	 */
	readonly retryDelay: number
}
