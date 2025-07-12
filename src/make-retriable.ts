import { pRetry } from './p-retry';
import { type Options } from './types';

/**
 *  Wrap a function so that each call is automatically retried on failure.
 *
 * @example
 * ```
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
	return (...args: Args) => pRetry<Res>(() => fn(...args), options);
}
