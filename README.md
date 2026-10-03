This is a fork of the popular [p-retry](https://github.com/sindresorhus/p-retry) library with support for both ESM and CommonJS module systems.

> [!NOTE]
> **Difference from the original library:**  
> This fork includes a modified implementation of the `AbortError` class, as well as improved integration with `AbortController`.
>
> - `AbortError` now fully supports the standard [`cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) property. You can pass an error cause via the second constructor argument:
>
>   ```ts
>   throw new AbortError('Operation aborted', { cause: originalError })
>   ```
>
> - The `pRetry` function throws an instance of `AbortError` directly when aborted, instead of throwing the original error. If you need access to the original error, you can retrieve it via the `cause` property.
> - When `AbortController.abort(reason)` is used, the thrown `AbortError` will have:
>   - `cause` set to `signal.reason`, if available,
>   - `signal` set to the corresponding `AbortSignal`, allowing consumers to inspect it:
>
>     ```ts
>     const controller = new AbortController()
>     controller.abort(new Error('Database unavailable'))
>
>     try {
>     	await pRetry(fn, { signal: controller.signal })
>     }
>     catch (err) {
>     	if (err instanceof AbortError) {
>     		console.error('Aborted because:', err.cause) // → Error('Database unavailable')
>     		console.log(err.signal.aborted) // → true
>     	}
>     }
>     ```
> - The `AbortError` class also exposes two static helper methods for convenience:
>
>   ```ts
>   AbortError.fromSignal(signal, 'Aborted by signal') // → includes signal and cause
>   AbortError.fromError(originalError, 'Aborted by error') // → wraps an error as cause
>   ```

---

# p-retry

> Retry a promise-returning or async function

It does exponential backoff and supports custom retry strategies for failed operations.

## Install

```sh
npm install @stimulcross/p-retry
```

```sh
yarn add @stimulcross/p-retry
```

```sh
pnpm add @stimulcross/p-retry
```

## Usage

```js
import { AbortError, pRetry } from '@stimulcross/p-retry'

async function run() {
	try {
		// your logic that may throw
		throw new ValidationError()
	}
	catch (err) {
		if (err instanceof ValidationError) {
			// Abort all retries and preserve the original cause
			throw new AbortError('Aborting due to validation error.', { cause: err })
		}

		// Other errors will be retried by the library.
		throw err
	}
}

try {
	await pRetry(run, { retries: 5 })
}
catch (err) {
	if (err instanceof AbortError) {
		console.error('Aborted with message:', err.message)
		console.error('Original cause:', err.cause)
	}
}

console.log(await pRetry(run, { retries: 5 }))
```

## API

### pRetry(input, options?)

Returns a `Promise` that is fulfilled when calling `input` returns a fulfilled promise. If calling `input` returns a rejected promise, `input` is called again until the max retries are reached, it then rejects with the last rejection reason.

Does not retry on most `TypeErrors`, with the exception of network errors. This is done on a best case basis as different browsers have different [messages](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#Checking_that_the_fetch_was_successful) to indicate this. See [whatwg/fetch#526 (comment)](https://github.com/whatwg/fetch/issues/526#issuecomment-554604080)

#### input

Type: `Function`

Receives the number of attempts as the first argument and is expected to return a `Promise` or any value.

#### options

Type: `object`

##### onFailedAttempt(context)

Type: `Function`

Callback invoked on each failure, including the final failure and non-network `TypeError`s. Receives a context object containing the error and retry state information.

The callback order is `shouldConsumeRetry` → `onFailedAttempt` → `shouldRetry`. No callbacks are called for abort errors. If `maxRetryTime` has already expired, only `onFailedAttempt` is called, with `retryDelay: 0`.

```js
import { pRetry } from '@stimulcross/p-retry'

async function run() {
	const response = await fetch('https://sindresorhus.com/unicorn')

	if (!response.ok) {
		throw new Error(response.statusText)
	}

	return response.json()
}

const result = await pRetry(run, {
	onFailedAttempt: ({ attemptNumber, retriesLeft, retriesConsumed, retryDelay, error }) => {
		console.log(
			`Attempt ${attemptNumber} failed. Planned delay: ${retryDelay}ms. There are ${retriesLeft} retries left.`,
		)
		// 1st request => Attempt 1 failed. There are 5 retries left.
		// 2nd request => Attempt 2 failed. There are 4 retries left.
		// …
	},
	retries: 5,
})

console.log(result)
```

The context is frozen and contains:

- `error`: the normalized error.
- `attemptNumber`: the current attempt, starting at 1.
- `retriesLeft`: the remaining retry budget before this failure is consumed.
- `retriesConsumed`: the number of retries consumed before the current failure.
- `retryDelay`: the planned backoff delay in milliseconds. This is 0 when consumption is skipped, the retry budget is exhausted, or the time limit has already expired. The actual wait is capped by the remaining `maxRetryTime`. A later `shouldRetry` decision can still prevent the retry.

The `onFailedAttempt` function can return a promise. For example, to add a [delay](https://github.com/sindresorhus/delay):

```js
import { pRetry } from '@stimulcross/p-retry'
import delay from 'delay'

async function run() { /* code */ }

const result = await pRetry(run, {
	onFailedAttempt: async () => {
		console.log('Waiting for 1 second before retrying')
		await delay(1000)
	}
})
```

If the `onFailedAttempt` function throws, all retries will be aborted and the original promise will reject with the thrown error.

##### shouldRetry(context)

Type: `Function`

Decide if a retry should occur based on the context. Returning true triggers a retry, false aborts with the error.

Called after `shouldConsumeRetry` and `onFailedAttempt`. It is not called for non-network `TypeError`s, abort errors, or when the retry/time budget is exhausted. If it throws, retries stop and the promise rejects with that error.

```js
import { pRetry } from '@stimulcross/p-retry'

async function run() { /* code */ }

const result = await pRetry(run, {
	shouldRetry: ({ error }) => !(error instanceof CustomError),
})
```

In the example above, the operation will be retried unless the error is an instance of `CustomError`.

##### shouldConsumeRetry(context)

Type: `Function`

Decide whether a failure consumes a retry from the `retries` budget. Returning `false` skips the built-in backoff and leaves `retriesConsumed` and the backoff sequence unchanged. `attemptNumber` still advances.

Called before `onFailedAttempt` and `shouldRetry`, except on abort errors or when `maxRetryTime` has already expired. The operation is still subject to `shouldRetry`, `maxRetryTime`, and the remaining retry budget. Non-network `TypeError`s always stop retrying. If this callback throws, retries stop.

```js
import { pRetry } from '@stimulcross/p-retry'

await pRetry(run, {
	retries: 2,
	shouldConsumeRetry: ({ error }) => !(error instanceof RateLimitError),
})
```

If skipped failures need a delay, add it in `onFailedAttempt`; no built-in timer is scheduled for them.

##### retries

Type: `number`\
Default: `10`

The maximum amount of times to retry the operation. Must be a non-negative integer or `Infinity`.

##### factor

Type: `number`\
Default: `2`

The exponential factor to use. Must be finite and non-negative; `0` is treated as `1`.

##### minTimeout

Type: `number`\
Default: `1000`

The number of milliseconds before starting the first retry. Set this to `0` to retry immediately without scheduling a timer.

##### maxTimeout

Type: `number`\
Default: `Infinity`

The maximum number of milliseconds between two retries.

##### randomize

Type: `boolean`\
Default: `false`

Randomizes the timeouts by multiplying with a factor between 1 and 2.

##### maxRetryTime

Type: `number`\
Default: `Infinity`

The maximum time (in milliseconds) for retrying. Measured with the monotonic clock `performance.now()`, so system clock adjustments do not affect the limit. Time spent in `input` and callbacks counts toward the budget.

This is a retry budget, not a hard timeout: it does not interrupt an in-flight `input` or callback. Pass an `AbortSignal` to cancellable operations when they need to stop while running.

##### signal

Type: [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)

You can abort retrying using [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController).

```js
import { AbortError, pRetry } from '@stimulcross/p-retry'

async function run() { /* code */ }
const controller = new AbortController()

cancelButton.addEventListener('click', () => {
	controller.abort(new Error('User clicked cancel button'))
})

try {
	await pRetry(run, { signal: controller.signal })
}
catch (err) {
	if (err instanceof AbortError) {
		console.log(err.cause) // Error('User clicked cancel button')
		console.log(err.signal === controller.signal) // true
	}
}
```

##### unref

Type: `boolean`\
Default: `false`

Prevents retry timeouts from keeping the process alive.

Only affects platforms with a `.unref()` method on timeouts, such as Node.js.

### makeRetriable(function, options?)

Wrap a function so that each call is automatically retried on failure. Options are optional, and the wrapper preserves `this` and all arguments on each attempt.

```js
import { makeRetriable } from '@stimulcross/p-retry'

const fetchWithRetry = makeRetriable(fetch, { retries: 5 })

const response = await fetchWithRetry('https://sindresorhus.com/unicorn')
```

### AbortError(message, {cause})

Abort retrying and reject with this `AbortError` instance. No retry callbacks are called. Unlike upstream, this fork does not unwrap `cause` as the rejection reason.

Native errors named `AbortError`, including `DOMException`, are wrapped with `AbortError.fromError` and retained as `cause`.

#### message

Type: `string`

An error message.

#### errorOptions

Type: `object`

Options with `cause` property.

## Tip

You can pass arguments to the function being retried by wrapping it in an inline arrow function:

```js
import { pRetry } from '@stimulcross/p-retry'

async function run(emoji) {
	// …
}

// Without arguments
await pRetry(run, { retries: 5 })

// With arguments
await pRetry(() => run('🦄'), { retries: 5 })
```

## FAQ

### How do I mock timers when testing with this package?

The package uses `setTimeout` and `clearTimeout` from the global scope, so you can use the [Node.js test timer mocking](https://nodejs.org/api/test.html#class-mocktimers) or a package like [`sinon`](https://github.com/sinonjs/sinon).

### How do I stop retries when the process receives SIGINT (Ctrl+C)?

Use an [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) to signal cancellation on SIGINT, and pass its `signal` to `pRetry`:

```js
import { pRetry } from '@stimulcross/p-retry'

const controller = new AbortController()

process.once('SIGINT', () => {
	controller.abort(new Error('SIGINT received'))
})

try {
	await pRetry(run, { signal: controller.signal })
}
catch (err) {
	console.log('Retry stopped due to:', err.message)
}
```

The package does not handle process signals itself to avoid global side effects.

## Compatibility

This fork follows the retry behavior of upstream `p-retry` 8.0.1, while retaining named exports, TypeScript sources, ESM/CommonJS builds, no runtime dependencies, and Node.js 20 support. The custom abort contract described above remains unchanged.

For synchronization details and migration notes, see [UPSTREAM_SYNC.md](./UPSTREAM_SYNC.md).

## Related

- [p-timeout](https://github.com/sindresorhus/p-timeout) - Timeout a promise after a specified amount of time
- [More…](https://github.com/sindresorhus/promise-fun)
