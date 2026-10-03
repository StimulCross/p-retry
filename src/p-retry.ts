import type { InputFunction, Options } from './types/index.js'
import { AbortError } from './errors/index.js'
import {
	calculateDelay,
	calculateRemainingTime,
	createRetryContext,
	delayForRetry,
	isError,
	isNetworkError,
	throwIfAborted,
	validateFunctionOption,
	validateNumberOption,
	validateRetries,
} from './utils/index.js'

type EffectiveOptions = Required<Omit<Options, 'signal'>> & Pick<Options, 'signal'>

async function onAttemptFailure(
	thrown: unknown,
	attemptNumber: number,
	retriesConsumed: number,
	startTime: number,
	options: EffectiveOptions,
): Promise<boolean> {
	const error = isError(thrown)
		? thrown
		: new TypeError(`Non-error was thrown: "${String(thrown)}". You should only throw errors.`)

	if (error instanceof AbortError)
		throw error

	if (error.name === 'AbortError')
		throw AbortError.fromError(error, 'An abort error occurred.')

	const retriesLeft = Number.isFinite(options.retries)
		? Math.max(0, options.retries - retriesConsumed)
		: options.retries

	const delayTime = calculateDelay(retriesConsumed, options)

	if (calculateRemainingTime(startTime, options.maxRetryTime) <= 0) {
		await options.onFailedAttempt(createRetryContext(error, attemptNumber, retriesLeft, retriesConsumed, 0))

		throw error
	}

	const consumeRetryContext = createRetryContext(
		error,
		attemptNumber,
		retriesLeft,
		retriesConsumed,
		retriesLeft > 0 ? delayTime : 0,
	)

	const shouldConsumeRetry = await options.shouldConsumeRetry(consumeRetryContext)
	const effectiveDelay = shouldConsumeRetry && retriesLeft > 0 ? delayTime : 0
	const context = createRetryContext(error, attemptNumber, retriesLeft, retriesConsumed, effectiveDelay)

	await options.onFailedAttempt(context)

	if (calculateRemainingTime(startTime, options.maxRetryTime) <= 0 || retriesLeft <= 0)
		throw error

	if ((error instanceof TypeError || error.name === 'TypeError') && !isNetworkError(error))
		throw error

	if (!await options.shouldRetry(context))
		throw error

	const remainingTime = calculateRemainingTime(startTime, options.maxRetryTime)

	if (remainingTime <= 0)
		throw error

	throwIfAborted(options.signal)

	if (!shouldConsumeRetry)
		return false

	const finalDelay = Math.min(effectiveDelay, remainingTime)
	await delayForRetry(finalDelay, options)

	throwIfAborted(options.signal)

	return true
}

/**
 * Returns a `Promise` that is fulfilled when calling `input` returns a fulfilled promise.
 * If calling `input` returns a rejected promise, `input` is called again until the max retries are reached,
 * it then rejects with the last rejection reason.
 *
 * Does not retry on most `TypeErrors`, with the exception of network errors. This is done on a best case basis as
 * different browsers have different [messages](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#Checking_that_the_fetch_was_successful)
 * to indicate this. See [whatwg/fetch#526 (comment)](https://github.com/whatwg/fetch/issues/526#issuecomment-554604080)
 * Non-network TypeErrors always stop retries, even if shouldConsumeRetry returns false.
 *
 * @param input - Receives the number of attempts as the first argument and is expected to return a `Promise` or any value.
 * @param options - Options for configuring the retry behavior.
 *
 * @example
 *```js
 * import { pRetry, AbortError } from '@stimulcross/p-retry';
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
	validateRetries(options.retries)

	const mergedOptions: EffectiveOptions = {
		retries: options.retries ?? 10,
		factor: options.factor ?? 2,
		minTimeout: options.minTimeout ?? 1000,
		maxTimeout: options.maxTimeout ?? Number.POSITIVE_INFINITY,
		maxRetryTime: options.maxRetryTime ?? Number.POSITIVE_INFINITY,
		randomize: options.randomize ?? false,
		onFailedAttempt: options.onFailedAttempt ?? (() => { /* empty */ }),
		shouldRetry: options.shouldRetry ?? (() => true),
		shouldConsumeRetry: options.shouldConsumeRetry ?? (() => true),
		signal: options.signal,
		unref: options.unref ?? false,
	}

	validateFunctionOption('onFailedAttempt', mergedOptions.onFailedAttempt)
	validateFunctionOption('shouldRetry', mergedOptions.shouldRetry)
	validateFunctionOption('shouldConsumeRetry', mergedOptions.shouldConsumeRetry)
	validateNumberOption('factor', mergedOptions.factor)
	validateNumberOption('minTimeout', mergedOptions.minTimeout)
	validateNumberOption('maxTimeout', mergedOptions.maxTimeout, true)
	validateNumberOption('maxRetryTime', mergedOptions.maxRetryTime, true)

	if (mergedOptions.factor <= 0)
		mergedOptions.factor = 1

	throwIfAborted(mergedOptions.signal)

	let attemptNumber = 0
	let retriesConsumed = 0
	const startTime = performance.now()

	while (Number.isFinite(mergedOptions.retries) ? retriesConsumed <= mergedOptions.retries : true) {
		attemptNumber += 1

		try {
			throwIfAborted(mergedOptions.signal)

			const result = await input(attemptNumber)

			throwIfAborted(mergedOptions.signal)

			return result
		}
		catch (err) {
			if (await onAttemptFailure(err, attemptNumber, retriesConsumed, startTime, mergedOptions)) {
				retriesConsumed += 1
			}
		}
	}

	// Should not reach here, but in case it does, throw an error
	/* istanbul ignore next */
	throw new Error('Retry attempts exhausted without throwing an error.')
}
