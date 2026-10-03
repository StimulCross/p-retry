import type { Options, RetryContext } from '../src/index.js'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AbortError, makeRetriable, pRetry } from '../src/index.js'

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllTimers()
	vi.useRealTimers()
})

const fixture = Symbol('fixture')
const fixtureError = new Error('fixture')
const delay = async (milliseconds: number) => await new Promise<void>(resolve => setTimeout(resolve, milliseconds))

// Handle rejections before advancing the clock, including errors thrown by hooks.
async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
	const settled = promise.then(
		value => ({ status: 'fulfilled' as const, value }),
		(err: unknown) => ({ status: 'rejected' as const, reason: err }),
	)

	await vi.runAllTimersAsync()

	const result = await settled

	if (result.status === 'rejected') {
		throw result.reason
	}

	return result.value
}

describe('pRetry', () => {
	describe('attempts and results', () => {
		it('numbers attempts from one and stops on the first success', async () => {
			const input = vi.fn((attempt: number) => {
				if (attempt < 3) {
					throw fixtureError
				}

				return fixture
			})
			await expect(pRetry(input, { minTimeout: 0 })).resolves.toBe(fixture)
			expect(input.mock.calls).toEqual([[1], [2], [3]])
		})

		it.each([null, undefined, false, 0, ''])('accepts %s as a successful result', async value => {
			const input = vi.fn(() => value)
			const onFailedAttempt = vi.fn()
			await expect(pRetry(input, { onFailedAttempt })).resolves.toBe(value)
			expect(input).toHaveBeenCalledTimes(1)
			expect(onFailedAttempt).not.toHaveBeenCalled()
		})

		it('awaits an asynchronous input', async () => {
			const input = vi.fn(async (attempt: number) => {
				await delay(20)

				if (attempt === 1) {
					throw fixtureError
				}

				return fixture
			})
			await expect(runWithTimers(pRetry(input, { minTimeout: 0 }))).resolves.toBe(fixture)
			expect(input).toHaveBeenCalledTimes(2)
			expect(performance.now()).toBe(40)
		})

		it.each([0, 1, 3])('allows the initial attempt plus %i retries', async retries => {
			const errors: Error[] = []
			const input = vi.fn(() => {
				const error = new Error(`failure ${errors.length + 1}`)
				errors.push(error)
				throw error
			})
			await expect(pRetry(input, { retries, minTimeout: 0 })).rejects.toThrow(`failure ${retries + 1}`)
			expect(input).toHaveBeenCalledTimes(retries + 1)
		})

		it('defaults to ten retries', async () => {
			const input = vi.fn(() => {
				throw fixtureError
			})
			await expect(pRetry(input, { minTimeout: 0 })).rejects.toBe(fixtureError)
			expect(input).toHaveBeenCalledTimes(11)
		})

		it('supports Infinity without consuming an infinite delay', async () => {
			const contexts: RetryContext[] = []

			await expect(pRetry(attempt => {
				if (attempt === 15) {
					return fixture
				}

				throw fixtureError
			}, {
				retries: Infinity,
				minTimeout: 0,
				onFailedAttempt: context => { contexts.push(context) },
			})).resolves.toBe(fixture)

			expect(contexts).toHaveLength(14)
			expect(contexts.every(context => context.retriesLeft === Infinity)).toBe(true)
			expect(contexts.at(-1)?.retriesConsumed).toBe(13)
		})

		it('preserves the final error identity and stack', async () => {
			const stack = fixtureError.stack

			await expect(pRetry(() => {
				throw fixtureError
			}, { retries: 2, minTimeout: 0 })).rejects.toBe(fixtureError)

			expect(fixtureError.stack).toBe(stack)
		})

		it('does not mutate the supplied options', async () => {
			const options = Object.freeze({ retries: 1, minTimeout: 0, factor: 0 })

			await expect(pRetry(() => {
				throw fixtureError
			}, options)).rejects.toBe(fixtureError)

			expect(options).toEqual({ retries: 1, minTimeout: 0, factor: 0 })
		})
	})

	describe('errors', () => {
		it.each(['failure', 42, null, undefined])('normalizes a non-error rejection: %s', async thrown => {
			const shouldConsumeRetry = vi.fn((_context: RetryContext) => true)
			const onFailedAttempt = vi.fn((_context: RetryContext) => { /* empty */ })
			const shouldRetry = vi.fn(() => true)
			const input = vi.fn(async () => {
				throw thrown
			})

			await expect(pRetry(input, { shouldConsumeRetry, onFailedAttempt, shouldRetry })).rejects.toThrow(
				`Non-error was thrown: "${thrown}". You should only throw errors.`,
			)

			const context = onFailedAttempt.mock.calls[0][0]
			expect(context.error).toBeInstanceOf(TypeError)
			expect(shouldConsumeRetry.mock.calls[0][0].error).toBe(context.error)
			expect(input).toHaveBeenCalledTimes(1)
			expect(shouldRetry).not.toHaveBeenCalled()
		})

		it.each([true, false])('reports a non-network TypeError but never retries it (consume=%s)', async consume => {
			const error = new TypeError('programming error')
			const input = vi.fn(() => {
				throw error
			})
			const shouldConsumeRetry = vi.fn(() => consume)
			const onFailedAttempt = vi.fn()
			const shouldRetry = vi.fn(() => true)
			await expect(pRetry(input, { shouldConsumeRetry, onFailedAttempt, shouldRetry })).rejects.toBe(error)
			expect(input).toHaveBeenCalledTimes(1)
			expect(shouldConsumeRetry).toHaveBeenCalledTimes(1)
			expect(onFailedAttempt).toHaveBeenCalledTimes(1)
			expect(shouldRetry).not.toHaveBeenCalled()
		})

		it.each([
			'network error',
			'Failed to fetch',
			'NetworkError when attempting to fetch resource.',
			'The Internet connection appears to be offline.',
			'Network request failed',
			'fetch failed',
			'terminated',
			' A network error occurred.',
			'Network connection lost',
			'error sending request for url (https://example.com): connection closed',
		])('retries a network TypeError: %s', async message => {
			const error = new TypeError(message)
			const input = vi.fn((attempt: number) => {
				if (attempt < 3) {
					throw error
				}

				return fixture
			})
			await expect(pRetry(input, { minTimeout: 0 })).resolves.toBe(fixture)
			expect(input).toHaveBeenCalledTimes(3)
		})

		it.each(['no stack', 'Sentry', 'regular stack'] as const)('recognizes Safari Load failed with %s', async variant => {
			const error = new TypeError('Load failed')

			if (variant === 'no stack') {
				delete error.stack
			}
			else if (variant === 'Sentry') {
				Object.defineProperty(error, '__sentry_captured__', { value: true })
			}

			const input = vi.fn((attempt: number) => {
				if (attempt === 1) {
					throw error
				}

				return fixture
			})
			const promise = pRetry(input, { minTimeout: 0 })

			if (variant === 'regular stack') {
				await expect(promise).rejects.toBe(error)
				expect(input).toHaveBeenCalledTimes(1)
			}
			else {
				await expect(promise).resolves.toBe(fixture)
				expect(input).toHaveBeenCalledTimes(2)
			}
		})

		it('an explicit AbortError bypasses all failure hooks', async () => {
			const input = vi.fn(() => {
				throw new AbortError('stop')
			})
			const shouldConsumeRetry = vi.fn(() => true)
			const onFailedAttempt = vi.fn()
			const shouldRetry = vi.fn(() => true)
			await expect(pRetry(input, { shouldConsumeRetry, onFailedAttempt, shouldRetry })).rejects.toThrow('stop')
			expect(input).toHaveBeenCalledTimes(1)
			expect(shouldConsumeRetry).not.toHaveBeenCalled()
			expect(onFailedAttempt).not.toHaveBeenCalled()
			expect(shouldRetry).not.toHaveBeenCalled()
		})
	})

	describe('failure hooks and retry consumption', () => {
		it('awaits shouldConsumeRetry, onFailedAttempt, then shouldRetry before the delay', async () => {
			const order: string[] = []
			const timers = vi.spyOn(globalThis, 'setTimeout')

			await expect(runWithTimers(pRetry(() => {
				throw fixtureError
			}, {
				retries: 1,
				minTimeout: 20,
				async shouldConsumeRetry() {
					await Promise.resolve()
					order.push('consume')

					return true
				},
				async onFailedAttempt() {
					await Promise.resolve()
					order.push('failed')
				},
				async shouldRetry() {
					await Promise.resolve()
					expect(timers).not.toHaveBeenCalled()
					order.push('retry')

					return true
				},
			}))).rejects.toBe(fixtureError)

			expect(order).toEqual(['consume', 'failed', 'retry', 'consume', 'failed'])
			expect(timers.mock.calls.map(([, milliseconds]) => milliseconds)).toEqual([20])
		})

		it('provides frozen contexts, including the final failure', async () => {
			const contexts: RetryContext[] = []

			await expect(runWithTimers(pRetry(() => {
				throw fixtureError
			}, {
				retries: 2,
				minTimeout: 10,
				onFailedAttempt: context => { contexts.push(context) },
			}))).rejects.toBe(fixtureError)

			expect(contexts).toEqual([
				{ error: fixtureError, attemptNumber: 1, retriesLeft: 2, retriesConsumed: 0, retryDelay: 10 },
				{ error: fixtureError, attemptNumber: 2, retriesLeft: 1, retriesConsumed: 1, retryDelay: 20 },
				{ error: fixtureError, attemptNumber: 3, retriesLeft: 0, retriesConsumed: 2, retryDelay: 0 },
			])

			expect(contexts.every(Object.isFrozen)).toBe(true)

			expect(() => {
				Object.assign(contexts[0], { retriesLeft: 99 })
			}).toThrow(TypeError)
		})

		it('reports a failure before shouldRetry rejects it', async () => {
			const order: string[] = []
			const input = vi.fn(() => {
				throw fixtureError
			})

			await expect(pRetry(input, {
				onFailedAttempt: () => { order.push('failed') },
				shouldRetry: () => {
					order.push('retry')

					return false
				},
			})).rejects.toBe(fixtureError)

			expect(order).toEqual(['failed', 'retry'])
			expect(input).toHaveBeenCalledTimes(1)
			expect(vi.getTimerCount()).toBe(0)
		})

		it('uses shouldRetry to stop on a later error', async () => {
			const terminalError = new Error('terminal')
			const input = vi.fn((attempt: number) => {
				throw attempt < 3 ? fixtureError : terminalError
			})

			await expect(pRetry(input, {
				minTimeout: 0,
				shouldRetry: async ({ error }) => error !== terminalError,
			})).rejects.toBe(terminalError)

			expect(input).toHaveBeenCalledTimes(3)
		})

		it.each(['shouldConsumeRetry', 'onFailedAttempt', 'shouldRetry'] as const)('propagates errors from %s', async name => {
			const hookError = new Error(`${name} failed`)
			const input = vi.fn(() => {
				throw fixtureError
			})

			await expect(pRetry(input, {
				[name]: async () => { throw hookError },
			})).rejects.toBe(hookError)

			expect(input).toHaveBeenCalledTimes(1)
			expect(vi.getTimerCount()).toBe(0)
		})

		it('awaits onFailedAttempt in addition to the backoff', async () => {
			const starts: number[] = []

			await expect(runWithTimers(pRetry(attempt => {
				starts.push(performance.now())

				if (attempt === 1) {
					throw fixtureError
				}

				return fixture
			}, {
				minTimeout: 100,
				onFailedAttempt: async () => await delay(40),
			}))).resolves.toBe(fixture)

			expect(starts).toEqual([0, 140])
		})

		it.each(['shouldConsumeRetry', 'onFailedAttempt', 'shouldRetry'] as const)('uses defaults when %s is undefined', async name => {
			const input = vi.fn(() => {
				throw fixtureError
			})
			await expect(pRetry(input, { retries: 1, minTimeout: 0, [name]: undefined })).rejects.toBe(fixtureError)
			expect(input).toHaveBeenCalledTimes(2)
		})

		it('skipped consumption preserves retries and backoff but advances attemptNumber', async () => {
			const consumedContexts: RetryContext[] = []
			const failedContexts: RetryContext[] = []
			const timers = vi.spyOn(globalThis, 'setTimeout')

			await expect(runWithTimers(pRetry(() => {
				throw fixtureError
			}, {
				retries: 2,
				minTimeout: 50,
				async shouldConsumeRetry(context) {
					consumedContexts.push(context)

					return context.attemptNumber !== 1 && context.attemptNumber !== 3
				},
				onFailedAttempt: context => { failedContexts.push(context) },
			}))).rejects.toBe(fixtureError)

			expect(failedContexts.map(({ attemptNumber }) => attemptNumber)).toEqual([1, 2, 3, 4, 5])
			expect(failedContexts.map(({ retriesConsumed }) => retriesConsumed)).toEqual([0, 0, 1, 1, 2])
			expect(failedContexts.map(({ retriesLeft }) => retriesLeft)).toEqual([2, 2, 1, 1, 0])
			expect(consumedContexts.map(({ retryDelay }) => retryDelay)).toEqual([50, 50, 100, 100, 0])
			expect(failedContexts.map(({ retryDelay }) => retryDelay)).toEqual([0, 50, 0, 100, 0])
			expect(timers.mock.calls.map(([, milliseconds]) => milliseconds)).toEqual([50, 100])
			expect(consumedContexts.every(Object.isFrozen)).toBe(true)
		})

		it.each([0, 1])('cannot bypass an exhausted budget of %i by skipping consumption', async retries => {
			const input = vi.fn(() => {
				throw fixtureError
			})
			const shouldRetry = vi.fn(() => true)

			await expect(pRetry(input, {
				retries,
				minTimeout: 0,
				shouldConsumeRetry: ({ attemptNumber }) => attemptNumber <= retries,
				shouldRetry,
			})).rejects.toBe(fixtureError)

			expect(input).toHaveBeenCalledTimes(retries + 1)
			expect(shouldRetry).toHaveBeenCalledTimes(retries)
		})

		it('still asks shouldRetry when consumption is skipped', async () => {
			const input = vi.fn(() => {
				throw fixtureError
			})
			const shouldRetry = vi.fn(() => false)
			await expect(pRetry(input, { shouldConsumeRetry: () => false, shouldRetry })).rejects.toBe(fixtureError)
			expect(shouldRetry).toHaveBeenCalledOnce()
			expect(input).toHaveBeenCalledOnce()
			expect(vi.getTimerCount()).toBe(0)
		})
	})

	describe('backoff', () => {
		it.each([
			{ name: 'defaults', options: {}, expected: [1000, 2000, 4000] },
			{ name: 'factor 3', options: { minTimeout: 10, factor: 3 }, expected: [10, 30, 90] },
			{ name: 'factor below one', options: { minTimeout: 100, factor: 0.5 }, expected: [100, 50, 25] },
			{ name: 'small factor', options: { minTimeout: 100, factor: 0.1 }, expected: [100, 10, 1] },
			{ name: 'factor zero becomes one', options: { minTimeout: 10, factor: 0 }, expected: [10, 10, 10] },
			{ name: 'maxTimeout cap', options: { minTimeout: 10, factor: 3, maxTimeout: 20 }, expected: [10, 20, 20] },
			{ name: 'maxTimeout below minTimeout', options: { minTimeout: 100, maxTimeout: 20 }, expected: [20, 20, 20] },
			{ name: 'rounding', options: { minTimeout: 1, factor: 1.5 }, expected: [1, 2, 2] },
		])('schedules actual delays: $name', async ({ options, expected }) => {
			const timers = vi.spyOn(globalThis, 'setTimeout')
			const starts: number[] = []

			await expect(runWithTimers(pRetry(() => {
				starts.push(performance.now())
				throw fixtureError
			}, { ...options, retries: 3 }))).rejects.toBe(fixtureError)

			expect(timers.mock.calls.map(([, milliseconds]) => milliseconds)).toEqual(expected)
			expect(starts.slice(1).map((start, index) => start - starts[index])).toEqual(expected)
		})

		it('does not start a retry before its delay elapses', async () => {
			const input = vi.fn((attempt: number) => {
				if (attempt === 1) {
					throw fixtureError
				}

				return fixture
			})
			const done = expect(pRetry(input, { minTimeout: 100 })).resolves.toBe(fixture)
			await vi.advanceTimersByTimeAsync(99)
			expect(input).toHaveBeenCalledTimes(1)
			await vi.advanceTimersByTimeAsync(1)
			await done
			expect(input).toHaveBeenCalledTimes(2)
		})

		it.each([{ minTimeout: 0 }, { minTimeout: 100, maxTimeout: 0 }])('avoids timers for a zero delay: %j', async options => {
			const timers = vi.spyOn(globalThis, 'setTimeout')

			await expect(pRetry(() => {
				throw fixtureError
			}, { ...options, retries: 3 })).rejects.toBe(fixtureError)

			expect(timers).not.toHaveBeenCalled()
		})

		it('randomizes, rounds, then caps the actual delay', async () => {
			vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.99).mockReturnValue(0.5)
			const timers = vi.spyOn(globalThis, 'setTimeout')

			await expect(runWithTimers(pRetry(() => {
				throw fixtureError
			}, {
				retries: 3,
				minTimeout: 101,
				factor: 1,
				randomize: true,
				maxTimeout: 180,
			}))).rejects.toBe(fixtureError)

			expect(timers.mock.calls.map(([, milliseconds]) => milliseconds)).toEqual([101, 180, 152])
		})

		it('does not randomize when randomize is false', async () => {
			const random = vi.spyOn(Math, 'random')

			await expect(pRetry(() => {
				throw fixtureError
			}, { retries: 2, minTimeout: 0 })).rejects.toBe(fixtureError)

			expect(random).not.toHaveBeenCalled()
		})
	})

	describe('maxRetryTime', () => {
		it('still makes an initial attempt with a zero time budget', async () => {
			const input = vi.fn(() => {
				throw fixtureError
			})
			const shouldConsumeRetry = vi.fn(() => true)
			const onFailedAttempt = vi.fn((_context: RetryContext) => { /* empty */ })
			const shouldRetry = vi.fn(() => true)
			await expect(pRetry(input, { maxRetryTime: 0, shouldConsumeRetry, onFailedAttempt, shouldRetry })).rejects.toBe(fixtureError)
			expect(input).toHaveBeenCalledOnce()
			expect(onFailedAttempt.mock.calls[0][0].retryDelay).toBe(0)
			expect(shouldConsumeRetry).not.toHaveBeenCalled()
			expect(shouldRetry).not.toHaveBeenCalled()
		})

		it('reports an input failure after its time budget has expired', async () => {
			const input = vi.fn(async () => {
				await delay(60)
				throw fixtureError
			})
			const shouldConsumeRetry = vi.fn(() => true)
			const onFailedAttempt = vi.fn((_context: RetryContext) => { /* empty */ })

			await expect(runWithTimers(pRetry(input, {
				maxRetryTime: 50,
				shouldConsumeRetry,
				onFailedAttempt,
			}))).rejects.toBe(fixtureError)

			expect(input).toHaveBeenCalledOnce()
			expect(shouldConsumeRetry).not.toHaveBeenCalled()
			expect(onFailedAttempt.mock.calls[0][0].retryDelay).toBe(0)
		})

		it.each(['shouldConsumeRetry', 'onFailedAttempt', 'shouldRetry'] as const)('counts time spent in %s', async name => {
			const input = vi.fn(() => {
				throw fixtureError
			})
			const shouldRetry = vi.fn(() => true)
			const hook = vi.fn(async () => {
				await delay(60)

				return true
			})

			await expect(runWithTimers(pRetry(input, {
				maxRetryTime: 50,
				minTimeout: 100,
				shouldRetry,
				[name]: hook,
			}))).rejects.toBe(fixtureError)

			expect(input).toHaveBeenCalledOnce()
			expect(hook).toHaveBeenCalledOnce()
			expect(performance.now()).toBe(60)

			if (name !== 'shouldRetry') {
				expect(shouldRetry).not.toHaveBeenCalled()
			}
		})

		it('caps the delay to the budget and permits a final attempt at its boundary', async () => {
			const input = vi.fn(() => {
				throw fixtureError
			})
			const contexts: RetryContext[] = []
			const timers = vi.spyOn(globalThis, 'setTimeout')

			await expect(runWithTimers(pRetry(input, {
				maxRetryTime: 50,
				minTimeout: 100,
				onFailedAttempt: context => { contexts.push(context) },
			}))).rejects.toBe(fixtureError)

			expect(timers.mock.calls.map(([, milliseconds]) => milliseconds)).toEqual([50])
			expect(input).toHaveBeenCalledTimes(2)
			expect(contexts.map(({ retryDelay }) => retryDelay)).toEqual([100, 0])
		})

		it('subtracts callback time from the remaining delay budget', async () => {
			const starts: number[] = []

			await expect(runWithTimers(pRetry(() => {
				starts.push(performance.now())
				throw fixtureError
			}, {
				maxRetryTime: 50,
				minTimeout: 100,
				onFailedAttempt: async () => await delay(20),
			}))).rejects.toBe(fixtureError)

			expect(starts).toEqual([0, 50])
			// Even the final onFailedAttempt is awaited; this is not a hard timeout.
			expect(performance.now()).toBe(70)
		})

		it('limits unconsumed retries by elapsed time', async () => {
			const input = vi.fn(async () => {
				await delay(20)
				throw fixtureError
			})

			await expect(runWithTimers(pRetry(input, {
				maxRetryTime: 50,
				shouldConsumeRetry: () => false,
			}))).rejects.toBe(fixtureError)

			expect(input).toHaveBeenCalledTimes(3)
			expect(performance.now()).toBe(60)
		})

		it('does not interrupt an in-flight successful input', async () => {
			await expect(runWithTimers(pRetry(async () => {
				await delay(100)

				return fixture
			}, { maxRetryTime: 10 }))).resolves.toBe(fixture)

			expect(performance.now()).toBe(100)
		})

		it('uses performance.now even when the wall clock moves backwards', async () => {
			const input = vi.fn(async () => {
				vi.setSystemTime(Date.now() - 100_000)
				await delay(30)
				throw fixtureError
			})
			await expect(runWithTimers(pRetry(input, { maxRetryTime: 50, minTimeout: 0 }))).rejects.toBe(fixtureError)
			expect(input).toHaveBeenCalledTimes(2)
			expect(performance.now()).toBe(60)
		})
	})

	describe('validation', () => {
		it.each([-1, -Infinity, NaN, 0.5, '2', null])('rejects invalid retries: %s', async retries => {
			const input = vi.fn(() => fixture)
			await expect(pRetry(input, { retries } as Options)).rejects.toThrow(TypeError)
			expect(input).not.toHaveBeenCalled()
		})

		it.each(['factor', 'minTimeout', 'maxTimeout', 'maxRetryTime'] as const)('validates %s before input runs', async name => {
			const input = vi.fn(() => fixture)

			for (const value of [-1, -Infinity, NaN, '1']) {
				await expect(pRetry(input, { [name]: value })).rejects.toThrow(TypeError)
			}

			if (name === 'factor' || name === 'minTimeout') {
				await expect(pRetry(input, { [name]: Infinity })).rejects.toThrow(TypeError)
			}
			else {
				await expect(pRetry(input, { [name]: Infinity })).resolves.toBe(fixture)
			}

			expect(input).toHaveBeenCalledTimes(name === 'factor' || name === 'minTimeout' ? 0 : 1)
		})

		it.each(['shouldConsumeRetry', 'onFailedAttempt', 'shouldRetry'] as const)('rejects a non-function %s', async name => {
			const input = vi.fn(() => fixture)

			for (const value of [false, 1, 'callback', {}]) {
				await expect(pRetry(input, { [name]: value })).rejects.toThrow(`Expected \`${name}\` to be a function.`)
			}

			expect(input).not.toHaveBeenCalled()
		})
	})

	describe('unref', () => {
		it.each([false, true])('sets the timer reference state with unref=%s', async unref => {
			const timers = vi.spyOn(globalThis, 'setTimeout')

			await expect(runWithTimers(pRetry(() => {
				throw fixtureError
			}, {
				retries: 1,
				minTimeout: 10,
				unref,
			}))).rejects.toBe(fixtureError)

			expect(timers).toHaveBeenCalledOnce()
			const timeout = timers.mock.results[0].value as ReturnType<typeof setTimeout>
			expect(timeout.hasRef()).toBe(!unref)
		})

		it('supports platforms whose timer handles have no unref method', async () => {
			const schedule = globalThis.setTimeout

			vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, milliseconds, ...args) => {
				schedule(callback, milliseconds, ...args)

				return 1 as unknown as ReturnType<typeof setTimeout>
			})

			await expect(runWithTimers(pRetry(() => {
				throw fixtureError
			}, {
				retries: 1,
				minTimeout: 10,
				unref: true,
			}))).rejects.toBe(fixtureError)
		})
	})

	// eslint-disable-next-line test/prefer-lowercase-title
	describe('AbortError and signals', () => {
		it('supports message, cause, signal and static factories', () => {
			const controller = new AbortController()
			controller.abort(fixtureError)
			const error = new AbortError('stop', { cause: fixtureError, signal: controller.signal })
			expect(error).toBeInstanceOf(Error)
			expect(error).toMatchObject({ name: 'AbortError', message: 'stop', cause: fixtureError, signal: controller.signal })
			expect(AbortError.fromSignal(controller.signal)).toMatchObject({ cause: fixtureError, signal: controller.signal })
			expect(AbortError.fromError(fixtureError, 'wrapped')).toMatchObject({ message: 'wrapped', cause: fixtureError })
			expect(new AbortError('stop').signal).toBeUndefined()
		})

		it('preserves the identity of an explicit AbortError', async () => {
			const error = new AbortError('stop', { cause: fixtureError })

			await expect(pRetry(() => {
				throw error
			})).rejects.toBe(error)
		})

		it.each([new DOMException('cancelled', 'AbortError'), Object.assign(new Error('cancelled'), { name: 'AbortError' })])(
			'wraps a native AbortError and bypasses callbacks: %s',
			async error => {
				const onFailedAttempt = vi.fn()

				await expect(pRetry(() => {
					throw error
				}, { onFailedAttempt })).rejects.toMatchObject({
					name: 'AbortError',
					cause: error,
				})

				expect(onFailedAttempt).not.toHaveBeenCalled()
			},
		)

		it.each([fixtureError, 'cancelled', undefined])('does not invoke input for a pre-aborted signal: %s', async reason => {
			const controller = new AbortController()
			controller.abort(reason)
			const input = vi.fn(() => fixture)

			await expect(pRetry(input, { signal: controller.signal })).rejects.toMatchObject({
				name: 'AbortError',
				cause: controller.signal.reason,
				signal: controller.signal,
			})

			expect(input).not.toHaveBeenCalled()
		})

		it.each(['shouldConsumeRetry', 'onFailedAttempt', 'shouldRetry'] as const)('honors cancellation inside %s', async name => {
			const controller = new AbortController()
			const input = vi.fn(() => {
				throw fixtureError
			})

			await expect(pRetry(input, {
				signal: controller.signal,
				[name]: () => {
					controller.abort('cancelled')

					return true
				},
			})).rejects.toMatchObject({ name: 'AbortError', cause: 'cancelled', signal: controller.signal })

			expect(input).toHaveBeenCalledOnce()
			expect(vi.getTimerCount()).toBe(0)
		})

		it('cancels a waiting retry promptly and removes the timer and listener', async () => {
			const controller = new AbortController()
			const remove = vi.spyOn(controller.signal, 'removeEventListener')
			const input = vi.fn(() => {
				throw fixtureError
			})
			const done = expect(pRetry(input, { signal: controller.signal, minTimeout: 1000 })).rejects.toMatchObject({
				name: 'AbortError',
				cause: fixtureError,
				signal: controller.signal,
			})
			await vi.advanceTimersByTimeAsync(0)
			expect(vi.getTimerCount()).toBe(1)
			controller.abort(fixtureError)
			await done
			expect(input).toHaveBeenCalledOnce()
			expect(vi.getTimerCount()).toBe(0)
			expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
			expect(performance.now()).toBe(0)
		})

		it('removes the abort listener after a successful wait', async () => {
			const controller = new AbortController()
			const add = vi.spyOn(controller.signal, 'addEventListener')
			const remove = vi.spyOn(controller.signal, 'removeEventListener')

			await expect(runWithTimers(pRetry(attempt => {
				if (attempt === 1) {
					throw fixtureError
				}

				return fixture
			}, { signal: controller.signal, minTimeout: 10 }))).resolves.toBe(fixture)

			expect(add).toHaveBeenCalledOnce()
			expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1])
			expect(vi.getTimerCount()).toBe(0)
		})

		it('honors cancellation even when consumption is skipped', async () => {
			const controller = new AbortController()
			const input = vi.fn(() => {
				throw fixtureError
			})

			await expect(pRetry(input, {
				signal: controller.signal,
				shouldConsumeRetry: () => false,
				shouldRetry: () => {
					controller.abort(fixtureError)

					return true
				},
			})).rejects.toMatchObject({ name: 'AbortError', cause: fixtureError })

			expect(input).toHaveBeenCalledOnce()
		})

		it('recognizes a TypeError from another realm without retrying', async () => {
			const error: Error = runInNewContext('new TypeError("programming error")')
			const input = vi.fn(() => {
				throw error
			})
			await expect(pRetry(input)).rejects.toBe(error)
			expect(input).toHaveBeenCalledOnce()
		})
	})
})

describe('makeRetriable', () => {
	it('forwards arguments unchanged on every attempt', async () => {
		const object = { value: 42 }
		const input = vi.fn((text: string, argument: typeof object) => {
			if (input.mock.calls.length < 3) {
				throw fixtureError
			}

			return `${text}:${argument.value}`
		})
		const wrapped = makeRetriable(input, { minTimeout: 0 })
		await expect(wrapped('value', object)).resolves.toBe('value:42')
		expect(input.mock.calls).toEqual([['value', object], ['value', object], ['value', object]])
	})

	it('preserves this', async () => {
		const receiver = {
			value: 42,
			calls: 0,
			run: makeRetriable(function (this: { value: number, calls: number }, add: number) {
				this.calls++

				if (this.calls === 1) {
					throw fixtureError
				}

				return this.value + add
			}, { minTimeout: 0 }),
		}
		await expect(receiver.run(8)).resolves.toBe(50)
		expect(receiver.calls).toBe(2)
	})

	it('allows omitted options', async () => {
		await expect(makeRetriable((value: number) => value * 2)(3)).resolves.toBe(6)
	})

	it('starts with a fresh retry budget on each call', async () => {
		const input = vi.fn(() => {
			throw fixtureError
		})
		const wrapped = makeRetriable(input, { retries: 1, minTimeout: 0 })
		await expect(wrapped()).rejects.toBe(fixtureError)
		await expect(wrapped()).rejects.toBe(fixtureError)
		expect(input).toHaveBeenCalledTimes(4)
	})
})
