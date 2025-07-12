import { type MakeRequired, type Options } from '../types';

export function calculateDelay(
	attempt: number,
	options: MakeRequired<Options, 'factor' | 'minTimeout' | 'maxTimeout'>,
) {
	const random = options.randomize ? Math.random() + 1 : 1;

	let timeout = Math.round(random * Math.max(options.minTimeout, 1) * options.factor ** (attempt - 1));
	timeout = Math.min(timeout, options.maxTimeout);

	return timeout;
}
