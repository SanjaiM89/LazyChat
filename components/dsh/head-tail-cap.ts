/**
 * Head/tail cap metrics for a capped list, ported from DeepSeek Harness
 * (`packages/client/ui-primitives/src/head-tail-cap.ts`).
 *
 * Long shell output collapses from the middle: the head shows how the command
 * started, the tail shows how it ended, and the middle — usually the bulk of an
 * `npm install` or a build log — is one click away.
 */

/** The head/tail split metrics for a capped list. */
export interface HeadTailCap {
  /** Rows beyond the cap (list length − maxLines); ≤ 0 means nothing is hidden. */
  hidden: number;
  /** Whether the list is over the cap and not expanded, so it shows a head/tail slice. */
  capped: boolean;
  /** Head-slice row count: `ceil(maxLines / 2)`. */
  headLines: number;
  /** Tail-slice row count: the remainder after the head. */
  tailLines: number;
}

/**
 * Compute the head/tail cap metrics for a list of `total` rows against `maxLines`,
 * given whether the surface is expanded.
 * @returns the split metrics.
 */
export function headTailCap(
  total: number,
  maxLines: number,
  expanded: boolean,
): HeadTailCap {
  const hidden = total - maxLines;
  const headLines = Math.ceil(maxLines / 2);
  return {
    hidden,
    capped: hidden > 0 && !expanded,
    headLines,
    tailLines: maxLines - headLines,
  };
}