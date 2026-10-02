import type { Options } from './types/index.js'
import { pRetry } from './p-retry.js'

/**
 *  Wrap a function so that each call is automatically retried on failure.
 *
 * @example
 * ```js
 * import {makeRetriable} from '@stimulcorss/p-retry';
 *
 * const fetchWithRetry = makeRetriable(fetch, {retries: 5});
 *
 * const response = await fetchWithRetry('https://sindresorhus.com/unicorn');
 * ```
 */
export function makeRetriable<Args extends readonly unknown[], Res>(
	fn: (...args: Args) => Res | PromiseLike<Res>,
	options: Options,
): (...args: Args) => Promise<Res> {
	return async (...args: Args) => await pRetry<Res>(() => fn(...args), options)
}
