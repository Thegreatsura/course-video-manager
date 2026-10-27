/**
 * A unified, line-based diff of `before` against `after`, every line of both
 * kept: ` ` for a line in both, `-` for one only in `before`, `+` for one only
 * in `after`, in the first column, as GitHub shows a diff. Where lines are
 * replaced, the removals come before the additions. It aligns the two on
 * their longest common subsequence, which is plenty for the few dozen lines
 * it is given.
 */
export const unifiedLineDiff = (before: string[], after: string[]): string => {
  // common[i][j]: the longest common subsequence of before[i..] and after[j..].
  const common = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0)
  );
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      common[i]![j] =
        before[i] === after[j]
          ? common[i + 1]![j + 1]! + 1
          : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }

  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      lines.push(` ${before[i]}`);
      i++;
      j++;
    } else if (
      i < before.length &&
      (j === after.length || common[i + 1]![j]! >= common[i]![j + 1]!)
    ) {
      lines.push(`-${before[i]}`);
      i++;
    } else {
      lines.push(`+${after[j]}`);
      j++;
    }
  }
  return lines.join("\n");
};
