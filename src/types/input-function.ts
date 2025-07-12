export type InputFunction<T = unknown> = (attemptNumber: number) => PromiseLike<T> | T;
