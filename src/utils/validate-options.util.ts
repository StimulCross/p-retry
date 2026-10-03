/** @internal */
export function validateRetries(retries: unknown): void {
	if (typeof retries === 'number') {
		if (retries < 0)
			throw new TypeError('Expected `retries` to be a non-negative number.')

		if (Number.isNaN(retries))
			throw new TypeError('Expected `retries` to be a valid number or Infinity, got NaN.')

		if (Number.isFinite(retries) && !Number.isInteger(retries))
			throw new TypeError('Expected `retries` to be a non-negative integer or Infinity.')
	}
	else if (retries !== undefined) {
		throw new TypeError('Expected `retries` to be a number or Infinity.')
	}
}

/** @internal */
export function validateNumberOption(name: string, value: unknown, allowInfinity: boolean = false): void {
	if (value === undefined)
		return

	if (typeof value !== 'number' || Number.isNaN(value))
		throw new TypeError(`Expected \`${name}\` to be a number${allowInfinity ? ' or Infinity' : ''}.`)

	if (!allowInfinity && !Number.isFinite(value))
		throw new TypeError(`Expected \`${name}\` to be a finite number.`)

	if (value < 0)
		throw new TypeError(`Expected \`${name}\` to be ≥ 0.`)
}

/** @internal */
export function validateFunctionOption(name: string, value: unknown): void {
	if (value !== undefined && typeof value !== 'function')
		throw new TypeError(`Expected \`${name}\` to be a function.`)
}
