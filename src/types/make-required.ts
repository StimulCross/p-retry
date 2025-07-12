export type MakeRequired<T, K extends keyof T> = Partial<T> & Required<Pick<T, K>>;
