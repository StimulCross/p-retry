import type { RetryContext } from './retry-context.interface.js'

export interface Options {
	/**
	 *	Callback invoked on each failure, including the final failure and non-network TypeErrors.
	 *	Called after shouldConsumeRetry and before shouldRetry, except on abort errors.
	 *
	 *	@example
	 *	```js
	 *	import { pRetry } from '@stimulcross/p-retry';
	 *
	 *	const run = async () => {
	 *		const response = await fetch('https://sindresorhus.com/unicorn');
	 *
	 *		if (!response.ok) {
	 *			throw new Error(response.statusText);
	 *		}
	 *
	 *		return response.json();
	 *	};
	 *
	 *	const result = await pRetry(run, {
	 *		onFailedAttempt: ({error, attemptNumber, retriesLeft}) => {
	 *			console.log(`Attempt ${attemptNumber} failed. There are ${retriesLeft} retries left.`);
	 *			// 1st request => Attempt 1 failed. There are 5 retries left.
	 *			// 2nd request => Attempt 2 failed. There are 4 retries left.
	 *			// …
	 *		},
	 *		retries: 5
	 *	});
	 *
	 *	console.log(result);
	 *	```
	 *
	 *	The `onFailedAttempt` function can return a promise. For example, to add a [delay](https://github.com/sindresorhus/delay):
	 *
	 *	@example
	 *	```js
	 *	import { pRetry } from '@stimulcross/p-retry';
	 *	import delay from 'delay';
	 *
	 *	const run = async () => { … };
	 *
	 *	const result = await pRetry(run, {
	 *		onFailedAttempt: async () => {
	 *			console.log('Waiting for 1 second before retrying');
	 *			await delay(1000);
	 *		}
	 *	});
	 *	```
	 *
	 *	If the `onFailedAttempt` function throws, all retries will be aborted and the original promise will reject with the thrown error.
	 */
	onFailedAttempt?: (context: RetryContext) => void | Promise<void>

	/**
	 *	Decide if a retry should occur based on the context. Returning true triggers a retry, false aborts with the error.
	 *
	 *	Called after shouldConsumeRetry and onFailedAttempt.
	 *	Not called for non-network TypeErrors, abort errors, or exhausted retry/time budgets.
	 *	If this callback throws, retries stop and the promise rejects with the thrown error.
	 *
	 *	@example
	 *	```js
	 *	import { pRetry } from '@stimulcross/p-retry';
	 *
	 *	const run = async () => { … };
	 *
	 *	const result = await pRetry(run, {
	 *		shouldRetry: ({error, attemptNumber, retriesLeft}) => !(error instanceof CustomError);
	 *	});
	 *	```
	 *
	 *	In the example above, the operation will be retried unless the error is an instance of `CustomError`.
	 */
	shouldRetry?: (context: RetryContext) => boolean | Promise<boolean>

	/**
	 * Decide whether this failure consumes a retry from the retries budget.
	 * Returning `false` skips the backoff delay and does not advance `retriesConsumed`.
	 * The failure still goes through `onFailedAttempt` and `shouldRetry`, and is subject to
	 * `maxRetryTime` and the remaining retry budget.
	 *
	 * Called before `onFailedAttempt` and `shouldRetry`, except on abort errors or when
	 * `maxRetryTime` is already exhausted. If this callback throws, retries stop.
	 */
	shouldConsumeRetry?: (context: RetryContext) => boolean | Promise<boolean>

	/**
	 *	The maximum amount of times to retry the operation. A non-negative integer or Infinity.
	 *
	 *	@default 10
	 */
	retries?: number

	/**
	 *	The exponential factor to use.
	 *
	 *	@default 2
	 */
	factor?: number

	/**
	 * The number of milliseconds before starting the first retry.
	 *
	 * Set this to `0` to retry immediately without scheduling a timer.
	 *
	 * @default 1000
	 */
	minTimeout?: number

	/**
	 *	The maximum number of milliseconds between two retries.
	 *
	 *	@default Infinity
	 */
	maxTimeout?: number

	/**
	 *	Randomizes the timeouts by multiplying with a factor between 1 and 2.
	 *
	 *	@default false
	 */
	randomize?: boolean

	/**
	 *	The maximum time (in milliseconds) for retrying.
	 *
	 *	Includes time spent in callbacks. Does not interrupt an in-flight input or callback.
	 *
	 *	@default Infinity
	 */
	maxRetryTime?: number

	/**
	 *	You can abort retrying using [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController).
	 *
	 *	```js
	 *	import { AbortError, pRetry } from '@stimulcross/p-retry';
	 *
	 *	const run = async () => { … };
	 *	const controller = new AbortController();
	 *
	 *	cancelButton.addEventListener('click', () => {
	 *		controller.abort(new Error('User clicked cancel button'));
	 *	});
	 *
	 *	try {
	 *		await pRetry(run, {signal: controller.signal});
	 *	} catch (error) {
	 *		if (error instanceof AbortError) {
	 *			console.log(error.cause); // Error('User clicked cancel button')
	 *			console.log(error.signal === controller.signal); // true
	 *		}
	 *	}
	 *	```
	 */
	signal?: AbortSignal

	/**
	 *	Prevents retry timeouts from keeping the process alive.
	 *
	 *	Only affects platforms with a `.unref()` method on timeouts, such as Node.js.
	 *
	 *	@default false
	 */
	unref?: boolean

	/**
	 * Called after a retry is approved, before its delay, including unconsumed retries.
	 * Receives the context of the failed attempt.
	 *
	 * The callback is awaited. Throwing or rejecting stops retrying with that error.
	 * Cancellation or an exhausted time budget can still prevent the next attempt.
	 */
	onRetry?: (context: RetryContext) => void | Promise<void>

	/**
	 * Checks the signal after the input completes successfully, before returning its result.
	 * If `true` and the signal is aborted, rejects with AbortError instead of returning the result.
	 *
	 * The input has already finished: side effects, such as resource updates, are not rolled back.
	 * Set to `false` to preserve successful results when cancellation arrives during completed work.
	 *
	 * Does not interrupt the running input or affect abort checks before attempts or during retry delays.
	 *
	 * @default true
	 */
	abortOnSuccess?: boolean
}
