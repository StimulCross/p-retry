import type { MakeRequired, Options } from '../types/index.js'

/** @internal */
export function calculateDelay(
	retriesConsumed: number,
	options: MakeRequired<Options, 'factor' | 'minTimeout' | 'maxTimeout'>,
): number {
	const attempt = Math.max(1, retriesConsumed + 1)
	const random = options.randomize ? Math.random() + 1 : 1

	let timeout = Math.round(random * options.minTimeout * options.factor ** (attempt - 1))
	timeout = Math.min(timeout, options.maxTimeout)

	return timeout
}
