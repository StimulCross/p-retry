/** @internal */
export function isError(value: unknown): value is Error {
	return (
		value instanceof Error
		|| ['[object Error]', '[object DOMException]'].includes(Object.prototype.toString.call(value))
	)
}
