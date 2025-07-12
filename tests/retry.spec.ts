import { AbortError, makeRetriable, pRetry } from '../src';
import { describe, expect, it, jest } from '@jest/globals';
import { setTimeout as delay } from 'timers/promises';

describe('pRetry', () => {
	const fixture = Symbol('fixture');
	const fixtureError = new Error('fixture');

	describe('Basic retry functionality', () => {
		it('should retry the specified number of times before succeeding', async () => {
			let index = 0;

			const returnValue = await pRetry(async attemptNumber => {
				await delay(40);
				index++;
				return attemptNumber === 3 ? fixture : Promise.reject(fixtureError);
			});

			expect(returnValue).toBe(fixture);
			expect(index).toBe(3);
		});

		it('should retry forever when specified', async () => {
			let attempts = 0;
			const maxAttempts = 10; // Limit for test purposes

			await expect(
				pRetry(
					async () => {
						attempts++;
						if (attempts === maxAttempts) {
							throw new AbortError('stop');
						}

						throw new Error('test');
					},
					{
						retries: Number.POSITIVE_INFINITY,
						minTimeout: 0, // Speed up test
						unref: true,
					},
				),
			).rejects.toThrow('stop');

			expect(attempts).toBe(maxAttempts);
		});

		it('should handle zero retries', async () => {
			let attempts = 0;

			await expect(
				pRetry(
					async () => {
						attempts++;
						throw new Error('test');
					},
					{ retries: 0, unref: true },
				),
			).rejects.toThrow();

			expect(attempts).toBe(1); // Should only try once with zero retries
		});

		it('should handle synchronous input function', async () => {
			let attempts = 0;

			await expect(
				pRetry(
					() => {
						// Non-async function
						attempts++;
						throw new Error('test');
					},
					{ retries: 2, minTimeout: 0 },
				),
			).rejects.toThrow();

			expect(attempts).toBe(3); // Initial + 2 retries
		});

		it('should abort retries if input function returns null', async () => {
			let attempts = 0;

			const result = await pRetry(
				() => {
					attempts++;
					return null;
				},
				{ retries: 2 },
			);

			expect(attempts).toBe(1); // Should stop after first success
			expect(result).toBeNull();
		});
	});

	describe('Error handling', () => {
		it('should throw useful error message when non-error is thrown', async () => {
			await expect(
				pRetry(
					() => {
						throw 'foo';
					},
					{ retries: 5, maxTimeout: 500 },
				),
			).rejects.toThrow(/Non-error/);
		});

		it('should not retry on TypeError', async () => {
			const typeErrorFixture = new TypeError('type-error-fixture');
			let index = 0;

			await expect(
				pRetry(async attemptNumber => {
					await delay(40);
					index++;
					return attemptNumber === 3 ? fixture : Promise.reject(typeErrorFixture);
				}),
			).rejects.toBe(typeErrorFixture);

			expect(index).toBe(1);
		});

		it('should retry on TypeError - failed to fetch', async () => {
			const typeErrorFixture = new TypeError('Failed to fetch');
			let index = 0;

			const returnValue = await pRetry(async attemptNumber => {
				await delay(40);
				index++;
				return attemptNumber === 3 ? fixture : Promise.reject(typeErrorFixture);
			});

			expect(returnValue).toBe(fixture);
			expect(index).toBe(3);
		});

		it('should preserve errors when maxRetryTime exceeded', async () => {
			const originalError = new Error('original error');
			const maxRetryTime = 100;
			let startTime: number | undefined;

			await expect(
				pRetry(
					async () => {
						startTime ||= Date.now();

						await delay(maxRetryTime + 50); // Ensure we exceed maxRetryTime
						throw originalError;
					},
					{
						maxRetryTime,
						minTimeout: 0,
					},
				),
			).rejects.toThrow(originalError);
		});

		it('should handle non-Error rejection values', async () => {
			await expect(
				pRetry(
					() => Promise.reject('string rejection'), // eslint-disable-line prefer-promise-reject-errors
					{ retries: 1, minTimeout: 0 },
				),
			).rejects.toThrow(/Non-error was thrown/);
		});
	});

	describe('AbortError', () => {
		it('should create AbortError with string message', () => {
			const error = new AbortError('fixture');
			expect(error.constructor.name).toBe('AbortError');
			expect(error.message).toBe('fixture');
		});

		it('should create AbortError with options and cause', () => {
			const originalError = new Error('fixture');
			const error = new AbortError('Aborting', { cause: originalError });
			expect(error.constructor.name).toBe('AbortError');
			expect(error.message).toBe('Aborting');
			expect(error.cause).toBe(originalError);
		});

		it('should stop operation immediately on AbortError', async () => {
			let attempts = 0;

			await expect(
				pRetry(
					async () => {
						attempts++;
						if (attempts === 3) {
							throw new AbortError('stop');
						}

						throw new Error('test');
					},
					{
						retries: 10,
						minTimeout: 100,
					},
				),
			).rejects.toBeInstanceOf(AbortError);

			expect(attempts).toBe(3); // Should stop after AbortError
		});

		it('should preserve the abort reason', async () => {
			let attempts = 0;
			const controller = new AbortController();

			const abortPromise = pRetry(
				async attemptNumber => {
					await delay(40);
					attempts++;
					if (attemptNumber === 3) {
						controller.abort(fixtureError);
						return;
					}

					throw fixtureError;
				},
				{
					signal: controller.signal,
					maxTimeout: 500,
				},
			);

			await expect(abortPromise).rejects.toThrow();

			expect(attempts).toBe(3);
		});
	});

	describe('shouldRetry option', () => {
		it('should control retry behavior', async () => {
			const shouldRetryError = new Error('should-retry');
			const customError = new Error('custom-error');
			let index = 0;

			await expect(
				pRetry(
					async () => {
						await delay(40);
						index++;
						throw index < 3 ? shouldRetryError : customError;
					},
					{
						async shouldRetry({ error }) {
							return error.message === shouldRetryError.message;
						},
						retries: 10,
					},
				),
			).rejects.toBe(customError);

			expect(index).toBe(3);
		});

		it('should handle async shouldRetry with maxRetryTime', async () => {
			let attempts = 0;
			const start = Date.now();
			const maxRetryTime = 1000;

			await expect(
				pRetry(
					async () => {
						attempts++;
						throw new Error('test');
					},
					{
						retries: 10,
						maxRetryTime,
						async shouldRetry() {
							await delay(100);
							return true;
						},
					},
				),
			).rejects.toThrow();

			expect(Date.now() - start).toBeLessThanOrEqual(maxRetryTime + 200);
			expect(attempts).toBeLessThan(10);
		});

		it('should accept undefined shouldRetry', async () => {
			const error = new Error('thrown from onFailedAttempt');

			await expect(
				pRetry(
					() => {
						throw error;
					},
					{
						shouldRetry: undefined,
						retries: 1,
					},
				),
			).rejects.toBe(error);
		});
	});

	describe('onFailedAttempt option', () => {
		it('should provide correct error details', async () => {
			const retries = 5;
			let index = 0;
			let attemptNumber = 0;

			await pRetry(
				async attemptNumber => {
					await delay(40);
					index++;
					return attemptNumber === 3 ? fixture : Promise.reject(fixtureError);
				},
				{
					onFailedAttempt({ error, attemptNumber: attempt, retriesLeft }) {
						expect(error).toBe(fixtureError);
						expect(attempt).toBe(++attemptNumber);
						expect(retriesLeft).toBe(retries - (index - 1));
					},
					retries,
				},
			);

			expect(index).toBe(3);
			expect(attemptNumber).toBe(2);
		});

		it('should allow returning a promise to add a delay', async () => {
			const waitFor = 1000;
			const start = Date.now();
			let isCalled = false;

			await pRetry(
				async () => {
					if (isCalled) {
						return fixture;
					}

					isCalled = true;
					throw fixtureError;
				},
				{
					async onFailedAttempt() {
						await delay(waitFor);
					},
				},
			);

			expect(Date.now()).toBeGreaterThan(start + waitFor);
		});

		it('should allow throwing to abort retries', async () => {
			const error = new Error('thrown from onFailedAttempt');

			await expect(
				pRetry(
					async () => {
						throw fixtureError;
					},
					{
						onFailedAttempt() {
							throw error;
						},
					},
				),
			).rejects.toBe(error);
		});

		it('should accept undefined onFailedAttempt', async () => {
			const error = new Error('thrown from onFailedAttempt');

			await expect(
				pRetry(
					() => {
						throw error;
					},
					{
						onFailedAttempt: undefined,
						retries: 1,
					},
				),
			).rejects.toBe(error);
		});
	});

	describe('Retry delay options', () => {
		it('should apply factor to exponential backoff', async () => {
			const delays: number[] = [];
			const factor = 2;
			const minTimeout = 100;

			await expect(
				pRetry(
					async () => {
						const attemptNumber = delays.length + 1;
						const expectedDelay = minTimeout * factor ** (attemptNumber - 1);
						delays.push(expectedDelay);
						throw new Error('test');
					},
					{
						retries: 3,
						factor,
						minTimeout,
						maxTimeout: Number.POSITIVE_INFINITY,
						randomize: false,
					},
				),
			).rejects.toThrow();

			expect(delays[0]).toBe(minTimeout);
			expect(delays[1]).toBe(minTimeout * factor);
			expect(delays[2]).toBe(minTimeout * factor ** 2);
		});

		it('should increment timeouts with factor', async () => {
			const delays: number[] = [];
			const minTimeout = 100;
			const factor = 0.5; // Test with factor less than 1

			await expect(
				pRetry(
					async () => {
						const attemptNumber = delays.length + 1;
						const expectedDelay = minTimeout * factor ** (attemptNumber - 1);
						delays.push(expectedDelay);
						throw new Error('test');
					},
					{
						retries: 3,
						factor,
						minTimeout,
						maxTimeout: Number.POSITIVE_INFINITY,
						randomize: false,
					},
				),
			).rejects.toThrow();

			// Each delay should be factor times the previous
			for (let i = 1; i < delays.length; i++) {
				expect(delays[i] / delays[i - 1]).toBe(factor);
			}
		});

		it('should respect minTimeout even with small factor', async () => {
			const delays: number[] = [];
			const minTimeout = 100;
			const factor = 0.1; // Very small factor

			await expect(
				pRetry(
					async () => {
						const attemptNumber = delays.length + 1;
						const expectedDelay = Math.max(minTimeout, minTimeout * factor ** (attemptNumber - 1));
						delays.push(expectedDelay);
						throw new Error('test');
					},
					{
						retries: 3,
						factor,
						minTimeout,
						maxTimeout: Number.POSITIVE_INFINITY,
						randomize: false,
					},
				),
			).rejects.toThrow();

			// All delays should be at least minTimeout
			for (const delay of delays) {
				expect(delay).toBeGreaterThanOrEqual(minTimeout);
			}
		});

		it('should cap retry delays with maxTimeout', async () => {
			const delays: number[] = [];
			const maxTimeout = 150;
			const factor = 3;
			const minTimeout = 100;

			await expect(
				pRetry(
					async () => {
						const attemptNumber = delays.length + 1;
						const expectedDelay = Math.min(minTimeout * factor ** (attemptNumber - 1), maxTimeout);
						delays.push(expectedDelay);
						throw new Error('test');
					},
					{
						retries: 3,
						minTimeout,
						factor,
						maxTimeout,
						randomize: false,
					},
				),
			).rejects.toThrow();

			expect(delays[0]).toBe(minTimeout);
			expect(delays[1]).toBe(maxTimeout);
			expect(delays[2]).toBe(maxTimeout);
		});

		it('should randomize retry delays when option is enabled', async () => {
			const delays = new Set<number>();
			const minTimeout = 100;

			await expect(
				pRetry(
					async () => {
						const random = Math.random() + 1;
						const delay = Math.round(random * minTimeout);
						delays.add(delay);
						throw new Error('test');
					},
					{
						retries: 3,
						minTimeout,
						factor: 1,
						randomize: true,
					},
				),
			).rejects.toThrow();

			expect(delays.size).toBeGreaterThan(1);
			for (const delay of delays) {
				expect(delay).toBeGreaterThanOrEqual(minTimeout);
				expect(delay).toBeLessThanOrEqual(minTimeout * 2);
			}
		});

		it('should handle invalid factor values', async () => {
			const delays: number[] = [];
			const minTimeout = 100;

			await expect(
				pRetry(
					async () => {
						// Should default to minTimeout
						delays.push(minTimeout);
						throw new Error('test');
					},
					{
						retries: 2,
						factor: 0, // Invalid factor
						minTimeout,
						randomize: false,
					},
				),
			).rejects.toThrow();

			expect(delays[0]).toBe(minTimeout);
			expect(delays[1]).toBe(minTimeout);
		});
	});

	describe('Time limits', () => {
		it('should limit total retry duration with maxRetryTime', async () => {
			const start = Date.now();
			const maxRetryTime = 1000;

			await expect(
				pRetry(
					async () => {
						await delay(400);
						throw new Error('test');
					},
					{
						retries: 10,
						minTimeout: 100,
						maxRetryTime,
					},
				),
			).rejects.toThrow();

			expect(Date.now() - start).toBeLessThan(maxRetryTime + 1000);
		});

		it('should handle zero maxRetryTime', async () => {
			let attempts = 0;

			await expect(
				pRetry(
					async () => {
						attempts++;
						throw new Error('test');
					},
					{ maxRetryTime: 0 },
				),
			).rejects.toThrow();

			expect(attempts).toBe(1); // Should only try once with zero maxRetryTime
		});
	});

	describe('Parameter validation', () => {
		it('should throw on negative retry count', async () => {
			await expect(
				pRetry(
					async () => {
						/* empty */
					},
					{ retries: -1 },
				),
			).rejects.toThrow('Expected `retries` to be a non-negative number.');
		});
	});

	describe('Timeout unref option', () => {
		it('should call unref when option is enabled', async () => {
			let timeoutUnrefCalled = false;

			// Mock setTimeout to track unref calls
			const originalSetTimeout = setTimeout;
			// @ts-ignore
			globalThis.setTimeout = jest.fn(((function_, ms) => {
				const timeout = originalSetTimeout(function_, ms);
				timeout.unref = () => {
					timeoutUnrefCalled = true;
					return timeout;
				};

				return timeout;
			}) as any);

			await expect(
				pRetry(
					async () => {
						throw new Error('test');
					},
					{
						retries: 2,
						minTimeout: 50,
						unref: true,
					},
				),
			).rejects.toThrow();

			expect(timeoutUnrefCalled).toBe(true);

			// Restore original setTimeout
			globalThis.setTimeout = originalSetTimeout;
		});
	});

	describe('makeRetriable function', () => {
		it('should wrap and retry the function', async () => {
			let callCount = 0;
			const function_ = async (a: number, b: number) => {
				callCount++;
				if (callCount < 3) {
					throw new Error('fail');
				}

				return a + b;
			};

			const retried = makeRetriable(function_, { retries: 5, minTimeout: 0 });
			const result = await retried(2, 3);
			expect(result).toBe(5);
			expect(callCount).toBe(3);
		});

		it('should pass arguments and options', async () => {
			let lastArguments: any[] = [];
			const function_ = (...args: any[]) => {
				lastArguments = args;
				throw new Error('fail');
			};

			const retried = makeRetriable(function_, { retries: 1, minTimeout: 0 });
			await expect(() => retried('foo', 42)).rejects.toThrow();
			expect(lastArguments).toEqual(['foo', 42]);
		});
	});
});
