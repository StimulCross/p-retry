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
 * @param options - Optional {@link ErrorOptions} used to customize the error, such as providing a `cause`.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause
 */
export class AbortError extends Error {
	constructor(message?: string, options?: ErrorOptions) {
		super(message, options);
		this.name = new.target.name;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}
