/** The hours of the day the job agent's runs start at (this fork): `hour`, then every 24 / perDay hours, in order. */
export const runHours = (hour: number, perDay: number) =>
  Array.from({ length: perDay }, (_, index) => (hour + Math.round((index * 24) / perDay)) % 24).toSorted((a, b) => a - b);
