import type { Departure } from "../../types";

/** Group departures by platform (Gleis), sorted numerically ("2" before "10"). */
export function groupByPlatform(deps: Departure[]): [string, Departure[]][] {
  const groups = new Map<string, Departure[]>();
  for (const dep of deps) {
    const key = dep.platform.trim();
    const list = groups.get(key);
    if (list) list.push(dep);
    else groups.set(key, [dep]);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
}
