/** @internal */
export function calculateRemainingTime(startTime: number, maxRetryTime: number): number {
	if (!Number.isFinite(maxRetryTime))
		return maxRetryTime

	return maxRetryTime - (performance.now() - startTime)
}
