export interface Success<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Failure<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Success<T> | Failure<E>;

export type DomainError<
  Domain extends string = string,
  Code extends string = string,
  Details extends object = object,
> = {
  readonly domain: Domain;
  readonly code: Code;
  readonly message: string;
} & Readonly<Details>;

export function success<T>(value: T): Success<T> {
  return { ok: true, value };
}

export function failure<E>(error: E): Failure<E> {
  return { ok: false, error };
}
