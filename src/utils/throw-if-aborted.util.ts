import { AbortError } from '../errors';

/** @internal */
export function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) {
		return;
	}

	throw AbortError.fromSignal(signal);
}
