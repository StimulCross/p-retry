/**
 * Additional options for customizing an {@link AbortError}.
 */
export interface AbortErrorOptions extends ErrorOptions {
	/**
	 * An optional AbortSignal that triggered the abort.
	 *
	 * This helps trace where the cancellation request came from,
	 * especially when multiple layers or sources may abort the operation.
	 */
	readonly signal?: AbortSignal;
}

/**
 * An error used to signal that a retry operation should be aborted immediately.
 *
 * When thrown inside a retried function, retrying will stop and the promise will be rejected with the provided error.
 *
 * Supports all standard {@link ErrorOptions}, including the `cause` property.
 *
 * Useful when further attempts are known to be futile, for example, in HTTP 404 or fatal validation failures.
 *
 * @param message - An optional error message or Error instance to explain the reason for aborting.
 * @param options - Optional {@link AbortErrorOptions} used to customize the error, such as providing a `cause`.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause
 */
export class AbortError extends Error {
	/**
	 * Optional signal that triggered the abort.
	 */
	public readonly signal?: AbortSignal;

	/** @internal */
	constructor(message?: string, options?: AbortErrorOptions) {
		super(message, options);

		this.name = new.target.name;
		this.signal = options?.signal;

		Object.setPrototypeOf(this, new.target.prototype);

		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, new.target);
		}
	}

	public static fromSignal(signal: AbortSignal, message: string = 'Aborted by signal'): AbortError {
		return new AbortError(message, { signal, cause: signal.reason });
	}

	public static fromError(error: Error, message: string = 'Aborted by error'): AbortError {
		return new AbortError(message, { cause: error });
	}
}
