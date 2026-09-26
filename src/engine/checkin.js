// Check-ins: a dated snapshot of the plan's headline numbers, and what changed since the last one.

/** The numbers worth tracking over time, from a plan result. Same net worth as "Where you stand today". */
export function snapshotOf(result, date) {
  const t = result.target;
  return {
    date,
    fireCorpus: Math.round(result.inputs.fireCorpus),
    netWorth: Math.round(result.balance.today.netWorth),
    required: Math.round(t.required),
    targetAge: t.age,
    earliestFireAge: result.earliestAge == null ? null : +result.earliestAge.toFixed(1),
    chance: Math.round(result.chance.atTarget * 100),
    confidence: result.confidence.score,
  };
}

/** Adds a snapshot, replacing one from the same day, oldest first. */
export function withSnapshot(snaps = [], snap) {
  return [...snaps.filter((s) => s.date !== snap.date), snap].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * What changed between each check-in and the one before. A change in the answers themselves
 * (more detail, a new target age) moves the numbers too, so it's flagged: the difference is
 * then not all progress.
 */
export function progress(snaps = []) {
  const list = [...snaps].sort((a, b) => a.date.localeCompare(b.date));
  return list.map((s, i) => {
    const p = list[i - 1];
    if (!p) return { ...s, change: null };
    const diff = (k) => (s[k] != null && p[k] != null ? s[k] - p[k] : null);
    const days = Math.round((Date.parse(s.date) - Date.parse(p.date)) / 864e5);
    const answersChanged = (s.targetAge != null && p.targetAge != null && s.targetAge !== p.targetAge) ||
      (s.confidence != null && p.confidence != null && Math.abs(s.confidence - p.confidence) >= 5);
    return { ...s, change: { days, fireCorpus: diff("fireCorpus"), netWorth: diff("netWorth"),
      earliestFireAge: diff("earliestFireAge") == null ? null : +diff("earliestFireAge").toFixed(1),
      chance: diff("chance"), answersChanged } };
  });
}
