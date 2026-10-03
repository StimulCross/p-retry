import type { Options } from './types/index.js'
import { pRetry } from './p-retry.js'

/**
 * Wrap a function so that each call is automatically retried on failure.
 *
 * @example
 * ```js
 * import { makeRetriable } from '@stimulcross/p-retry';
 *
 * const fetchWithRetry = makeRetriable(fetch, {retries: 5});
 *
 * const response = await fetchWithRetry('https://sindresorhus.com/unicorn');
 * ```
 */
export function makeRetriable<Args extends readonly unknown[], Res, This = unknown>(
	fn: (this: This, ...args: Args) => Res | PromiseLike<Res>,
	options?: Options,
): (this: This, ...args: Args) => Promise<Res> {
	return async function (this: This, ...args: Args) {
		return await pRetry<Res>(() => fn.call(this, ...args), options)
	}
}
