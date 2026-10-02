import { AbortError } from '../errors/index.js';

/** @internal */
export function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) {
		return;
	}

	throw AbortError.fromSignal(signal);
}
