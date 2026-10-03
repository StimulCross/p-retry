import type { Options } from '../types/index.js'
import { AbortError } from '../errors/index.js'
import { throwIfAborted } from './throw-if-aborted.util.js'

/** @internal */
export async function delayForRetry(delay: number, options: Options): Promise<void> {
	throwIfAborted(options.signal)

	if (delay <= 0)
		return

	const signal = options.signal

	await new Promise<void>((resolve, reject) => {
		const cleanup = (): void => {
			// eslint-disable-next-line ts/no-use-before-define
			clearTimeout(timeoutToken)
			// eslint-disable-next-line ts/no-use-before-define
			signal?.removeEventListener('abort', abortHandler)
		}

		const abortHandler = (): void => {
			cleanup()
			// eslint-disable-next-line ts/no-non-null-assertion
			reject(AbortError.fromSignal(signal!))
		}

		const timeoutToken = setTimeout(() => {
			cleanup()
			resolve()
		}, delay)

		if (options.unref)
			// eslint-disable-next-line ts/no-unnecessary-condition
			timeoutToken.unref?.()

		if (signal) {
			if (signal.aborted) {
				abortHandler()

				return
			}

			signal.addEventListener('abort', abortHandler, { once: true })
		}
	})
}
