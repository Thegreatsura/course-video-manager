/**
 * THE STORAGE ROOT FILTER (#2431): which Storage Roots the Storage pages
 * show. Every root is shown unless the URL hides it (`?hide=<root>`, once
 * per hidden root), so a reload or a link keeps the filter, and the links
 * between the Storage page and a per-bucket page carry it. Any other
 * location a scan counted (export scratch) is filtered the same way. Pure:
 * the reducers and selectors apply it to the cached scan or listing, with
 * no drive I/O.
 */

export const HIDE_PARAM = "hide";

/** The hidden roots, sorted and without repeats. */
export const hiddenRootsOf = (params: URLSearchParams): string[] =>
  [...new Set(params.getAll(HIDE_PARAM))].sort();

/** Whether the filter shows this location. */
export const isShown = (hidden: readonly string[], location: string) =>
  !hidden.includes(location);

/** The params with `location` hidden, or shown again if it was hidden. */
export const withRootToggled = (
  params: URLSearchParams,
  location: string
): URLSearchParams => {
  const hidden = hiddenRootsOf(params);
  const next = new URLSearchParams(params);
  next.delete(HIDE_PARAM);
  const after = hidden.includes(location)
    ? hidden.filter((l) => l !== location)
    : [...hidden, location].sort();
  for (const l of after) next.append(HIDE_PARAM, l);
  return next;
};

/** A Storage page link that keeps the filter. */
export const withRootFilter = (
  path: string,
  hidden: readonly string[]
): string => {
  if (hidden.length === 0) return path;
  const params = new URLSearchParams();
  for (const l of hidden) params.append(HIDE_PARAM, l);
  return `${path}?${params}`;
};

/** Whether two URLs differ only in the filter: nothing to load again. */
export const onlyRootFilterChanged = (current: URL, next: URL): boolean => {
  if (current.pathname !== next.pathname) return false;
  const rest = (url: URL) => {
    const params = new URLSearchParams(url.search);
    params.delete(HIDE_PARAM);
    params.sort();
    return params.toString();
  };
  return (
    rest(current) === rest(next) &&
    hiddenRootsOf(current.searchParams).join("\0") !==
      hiddenRootsOf(next.searchParams).join("\0")
  );
};

/** One toggle chip: a location, what it holds, and whether it is shown. */
export type RootChip = {
  location: string;
  /** Rows (buckets or files) with anything there, filter or not. */
  items: number;
  shown: boolean;
  /** Nothing there to show or hide; a hidden one can always be shown. */
  disabled: boolean;
};

/**
 * The chips, one per location in order, or none when there is only one.
 * `itemsAt` counts rows with anything at each location, unfiltered.
 */
export const rootChips = (
  locations: readonly string[],
  itemsAt: Readonly<Record<string, number>>,
  hidden: readonly string[]
): RootChip[] => {
  const all = [...new Set([...locations, ...Object.keys(itemsAt)])];
  if (all.length < 2) return [];
  return all.map((location) => {
    const items = itemsAt[location] ?? 0;
    const shown = isShown(hidden, location);
    return { location, items, shown, disabled: items === 0 && shown };
  });
};

/** Just the entries of `byLocation` the filter shows. */
export const shownEntries = <T>(
  byLocation: Readonly<Record<string, T>>,
  hidden: readonly string[]
): Record<string, T> =>
  hidden.length === 0
    ? { ...byLocation }
    : Object.fromEntries(
        Object.entries(byLocation).filter(([l]) => isShown(hidden, l))
      );
