import { AbortError } from './errors';
import { type InputFunction, type Options } from './types';
import { calculateDelay, createRetryContext, isNetworkError } from './utils';

/**
 * Returns a `Promise` that is fulfilled when calling `input` returns a fulfilled promise.
 * If calling `input` returns a rejected promise, `input` is called again until the max retries are reached,
 * it then rejects with the last rejection reason.
 *
 * Does not retry on most `TypeErrors`, with the exception of network errors. This is done on a best case basis as
 * different browsers have different [messages](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#Checking_that_the_fetch_was_successful)
 * to indicate this. See [whatwg/fetch#526 (comment)](https://github.com/whatwg/fetch/issues/526#issuecomment-554604080)
 *
 * @param input - Receives the number of attempts as the first argument and is expected to return a `Promise` or any value.
 * @param options - Options for configuring the retry behavior.
 *
 * @example
 *```js
 * import pRetry, { AbortError } from '@stimulcross/p-retry';
 *
 * const run = async () => {
 * 	 const response = await fetch('https://sindresorhus.com/unicorn');
 *
 * 	 // Abort retrying if the resource doesn't exist
 * 	 if (response.status === 404) {
 * 		throw new AbortError(response.statusText);
 * 	 }
 *
 * 	 return response.blob();
 * };
 *
 * console.log(await pRetry(run, {retries: 5}));
 *```
 */
export async function pRetry<T>(input: InputFunction<T>, options: Options = {}): Promise<T> {
	const mergedOptions = {
		retries: options.retries ?? 10,
		factor: options.factor ?? 2,
		minTimeout: options.minTimeout ?? 1000,
		maxTimeout: options.maxTimeout ?? Number.POSITIVE_INFINITY,
		maxRetryTime: options.maxRetryTime ?? Number.POSITIVE_INFINITY,
		randomize: options.randomize ?? false,
		onFailedAttempt: options.onFailedAttempt ?? (() => {}),
		shouldRetry: options.shouldRetry ?? (() => true),
		signal: options.signal,
		unref: options.unref ?? false,
	};

	if (typeof options.retries === 'number' && mergedOptions.retries < 0) {
		throw new TypeError('Expected `retries` to be a non-negative number.');
	}

	mergedOptions.signal?.throwIfAborted();

	let attemptNumber = 0;
	const startTime = Date.now();

	const maxRetryTime = mergedOptions.maxRetryTime ?? Number.POSITIVE_INFINITY;

	while (attemptNumber < mergedOptions.retries + 1) {
		attemptNumber++;

		try {
			mergedOptions.signal?.throwIfAborted();

			const result = await input(attemptNumber);

			mergedOptions.signal?.throwIfAborted();

			return result;
		} catch (e) {
			const error: Error =
				e instanceof Error ? e : new TypeError(`Non-error was thrown: "${e}". You should only throw errors.`);

			if (e instanceof AbortError || (e instanceof TypeError && !isNetworkError(error))) {
				throw e;
			}

			const context = createRetryContext(error, attemptNumber, mergedOptions.retries);

			// Always call onFailedAttempt
			await mergedOptions.onFailedAttempt(context);

			const currentTime = Date.now();

			if (
				currentTime - startTime >= maxRetryTime ||
				attemptNumber >= mergedOptions.retries + 1 ||
				!(await mergedOptions.shouldRetry(context))
			) {
				throw error; // Do not retry, throw the original error
			}

			// Calculate delay before next attempt
			const delayTime = calculateDelay(attemptNumber, mergedOptions);

			// Ensure that delay does not exceed maxRetryTime
			const timeLeft = maxRetryTime - (currentTime - startTime);

			/* istanbul ignore if */
			if (timeLeft <= 0) {
				throw error; // Max retry time exceeded
			}

			const finalDelay = Math.min(delayTime, timeLeft);

			// Introduce delay
			if (finalDelay > 0) {
				await new Promise((resolve, reject) => {
					const timeoutToken = setTimeout(resolve, finalDelay);

					if (mergedOptions.unref) {
						timeoutToken.unref?.();
					}

					mergedOptions.signal?.addEventListener(
						'abort',
						() => {
							clearTimeout(timeoutToken);
							reject(mergedOptions.signal?.reason ?? new Error('Operation aborted by user'));
						},
						{ once: true },
					);
				});
			}

			mergedOptions.signal?.throwIfAborted();
		}
	}

	// Should not reach here, but in case it does, throw an error
	/* istanbul ignore next */
	throw new Error('Retry attempts exhausted without throwing an error.');
}
