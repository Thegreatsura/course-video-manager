/** A command the recorder will not do, with the reason the client is told. */
export class Refusal extends Error {}

/** The first item whose name contains `wanted`, ignoring case. */
export const findByName = <T>(
  items: T[],
  name: (t: T) => string,
  wanted: string
) => items.find((t) => name(t).toLowerCase().includes(wanted.toLowerCase()));
