export type FileName = "index.html" | "style.css" | "README.md";
export const FILE_NAMES: readonly FileName[] = ["index.html", "style.css", "README.md"];
export type Files = Readonly<Partial<Record<FileName, string>>>;
export type Hash = string;
export type BranchName = string;

export type Parents = readonly [] | readonly [Hash] | readonly [Hash, Hash];

export interface Commit {
  readonly hash: Hash;
  readonly parents: Parents;
  readonly message: string;
  readonly files: Files;
}

export interface Repo {
  readonly commits: ReadonlyMap<Hash, Commit>;
  readonly branches: ReadonlyMap<BranchName, Hash>;
  readonly head: BranchName;
  readonly worktree: Files;
}

export type Op =
  | { readonly kind: "edit"; readonly file: FileName; readonly content: string }
  | { readonly kind: "commit"; readonly hash: Hash; readonly message: string }
  | { readonly kind: "switch"; readonly branch: BranchName; readonly create: boolean }
  | { readonly kind: "merge-ff"; readonly branch: BranchName }
  | { readonly kind: "merge"; readonly branch: BranchName; readonly hash: Hash; readonly message: string }
  | { readonly kind: "merge-squash"; readonly branch: BranchName; readonly hash: Hash; readonly message: string }
  | { readonly kind: "rebase"; readonly onto: BranchName; readonly hashes: readonly Hash[] }
  | { readonly kind: "delete-branch"; readonly branch: BranchName; readonly force: boolean };

export class GitModelError extends Error {
  override readonly name = "GitModelError";
}

export function emptyRepo(): Repo {
  return { commits: new Map(), branches: new Map(), head: "main", worktree: {} };
}

export function commitOf(repo: Repo, hash: Hash): Commit {
  const commit = repo.commits.get(hash);
  if (commit === undefined) throw new GitModelError(`unknown commit ${hash}`);
  return commit;
}

export function tipOf(repo: Repo, branch: BranchName): Hash {
  const tip = repo.branches.get(branch);
  if (tip === undefined) throw new GitModelError(`unknown branch ${branch}`);
  return tip;
}

export function headCommit(repo: Repo): Commit | null {
  const tip = repo.branches.get(repo.head);
  return tip === undefined ? null : commitOf(repo, tip);
}

export function changedFiles(before: Files, after: Files): readonly FileName[] {
  return FILE_NAMES.filter((name) => before[name] !== after[name]);
}

export function isDirty(repo: Repo): boolean {
  return changedFiles(headCommit(repo)?.files ?? {}, repo.worktree).length > 0;
}

export function ancestors(repo: Repo, hash: Hash): ReadonlySet<Hash> {
  const seen = new Set<Hash>();
  const queue: Hash[] = [hash];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...commitOf(repo, next).parents);
  }
  return seen;
}

export function reachable(repo: Repo): ReadonlySet<Hash> {
  const all = new Set<Hash>();
  for (const tip of repo.branches.values()) for (const hash of ancestors(repo, tip)) all.add(hash);
  return all;
}

function mergeBase(repo: Repo, ours: Hash, theirs: Hash): Commit {
  const ourAncestors = ancestors(repo, ours);
  const queue: Hash[] = [theirs];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (ourAncestors.has(next)) return commitOf(repo, next);
    queue.push(...commitOf(repo, next).parents);
  }
  throw new GitModelError(`no common ancestor between ${ours} and ${theirs}`);
}

function threeWay(base: Files, ours: Files, theirs: Files): Files {
  const merged: Partial<Record<FileName, string>> = { ...ours };
  for (const name of changedFiles(base, theirs)) {
    if (ours[name] !== base[name] && ours[name] !== theirs[name]) {
      throw new GitModelError(`conflict on ${name}`);
    }
    const content = theirs[name];
    if (content === undefined) delete merged[name];
    else merged[name] = content;
  }
  return merged;
}

function withBranch(repo: Repo, branch: BranchName, hash: Hash): ReadonlyMap<BranchName, Hash> {
  return new Map(repo.branches).set(branch, hash);
}

function addCommit(repo: Repo, commit: Commit): ReadonlyMap<Hash, Commit> {
  if (repo.commits.has(commit.hash)) throw new GitModelError(`duplicate commit ${commit.hash}`);
  return new Map(repo.commits).set(commit.hash, commit);
}

function requireClean(repo: Repo, action: string): void {
  if (isDirty(repo)) throw new GitModelError(`${action} with uncommitted changes`);
}

function headTip(repo: Repo): Hash {
  return tipOf(repo, repo.head);
}

function rebase(repo: Repo, onto: BranchName, hashes: readonly Hash[]): Repo {
  requireClean(repo, "rebase");
  const target = tipOf(repo, onto);
  const upstream = ancestors(repo, target);
  const replayed: Commit[] = [];
  for (let hash: Hash | undefined = headTip(repo); hash !== undefined && !upstream.has(hash); ) {
    const commit = commitOf(repo, hash);
    if (commit.parents.length > 1) throw new GitModelError(`cannot replay merge commit ${hash}`);
    replayed.unshift(commit);
    hash = commit.parents[0];
  }
  if (replayed.length === 0) throw new GitModelError(`${repo.head} is already on top of ${onto}`);
  if (replayed.length !== hashes.length) {
    throw new GitModelError(`rebase replays ${replayed.length} commits, ${hashes.length} hashes given`);
  }
  let commits = repo.commits;
  let base = commitOf(repo, target);
  replayed.forEach((original, index) => {
    const oldParent = original.parents[0];
    const before = oldParent === undefined ? {} : commitOf(repo, oldParent).files;
    const files: Partial<Record<FileName, string>> = { ...base.files };
    for (const name of changedFiles(before, original.files)) {
      if (base.files[name] !== before[name]) throw new GitModelError(`conflict on ${name}`);
      const content = original.files[name];
      if (content === undefined) delete files[name];
      else files[name] = content;
    }
    const hash = hashes[index];
    if (hash === undefined) throw new GitModelError("missing rebase hash");
    const copy: Commit = { hash, parents: [base.hash], message: original.message, files };
    commits = addCommit({ ...repo, commits }, copy);
    base = copy;
  });
  return { ...repo, commits, branches: withBranch(repo, repo.head, base.hash), worktree: base.files };
}

export function apply(repo: Repo, op: Op): Repo {
  switch (op.kind) {
    case "edit":
      return { ...repo, worktree: { ...repo.worktree, [op.file]: op.content } };

    case "commit": {
      if (!isDirty(repo)) throw new GitModelError("nothing to commit");
      const parent = repo.branches.get(repo.head);
      const commit: Commit = {
        hash: op.hash,
        parents: parent === undefined ? [] : [parent],
        message: op.message,
        files: repo.worktree,
      };
      return { ...repo, commits: addCommit(repo, commit), branches: withBranch(repo, repo.head, op.hash) };
    }

    case "switch": {
      requireClean(repo, "switch");
      if (op.create) {
        if (repo.branches.has(op.branch)) throw new GitModelError(`branch ${op.branch} already exists`);
        return { ...repo, branches: withBranch(repo, op.branch, headTip(repo)), head: op.branch };
      }
      const tip = tipOf(repo, op.branch);
      return { ...repo, head: op.branch, worktree: commitOf(repo, tip).files };
    }

    case "merge-ff": {
      requireClean(repo, "merge");
      const tip = tipOf(repo, op.branch);
      if (!ancestors(repo, tip).has(headTip(repo))) {
        throw new GitModelError(`${op.branch} is not a fast-forward of ${repo.head}`);
      }
      return { ...repo, branches: withBranch(repo, repo.head, tip), worktree: commitOf(repo, tip).files };
    }

    case "merge":
    case "merge-squash": {
      requireClean(repo, "merge");
      const ours = headTip(repo);
      const theirs = tipOf(repo, op.branch);
      if (ancestors(repo, ours).has(theirs)) throw new GitModelError(`${op.branch} is already merged`);
      const base = mergeBase(repo, ours, theirs);
      const files = threeWay(base.files, commitOf(repo, ours).files, commitOf(repo, theirs).files);
      const commit: Commit = {
        hash: op.hash,
        parents: op.kind === "merge" ? [ours, theirs] : [ours],
        message: op.message,
        files,
      };
      return {
        ...repo,
        commits: addCommit(repo, commit),
        branches: withBranch(repo, repo.head, op.hash),
        worktree: files,
      };
    }

    case "rebase":
      return rebase(repo, op.onto, op.hashes);

    case "delete-branch": {
      const tip = tipOf(repo, op.branch);
      if (op.branch === repo.head) throw new GitModelError(`cannot delete the current branch ${op.branch}`);
      if (!op.force && !ancestors(repo, headTip(repo)).has(tip)) {
        throw new GitModelError(`${op.branch} is not merged into ${repo.head}`);
      }
      const branches = new Map(repo.branches);
      branches.delete(op.branch);
      return { ...repo, branches };
    }
  }
}

export interface Placed {
  readonly hash: Hash;
  readonly lane: number;
  readonly column: number;
  readonly ghost: boolean;
}
export interface Link {
  readonly from: Hash;
  readonly to: Hash;
  readonly ghost: boolean;
}
export interface Slot {
  readonly lane: number;
  readonly column: number;
}
export interface Layout {
  readonly frames: readonly Placed[];
  readonly links: readonly Link[];
  readonly tapes: ReadonlyMap<Hash, readonly BranchName[]>;
  readonly pending: Slot | null;
}

export function layout(repo: Repo, previous: Repo | null): Layout {
  const columns = new Map<Hash, number>();
  const columnOf = (hash: Hash): number => {
    const known = columns.get(hash);
    if (known !== undefined) return known;
    const parents = commitOf(repo, hash).parents;
    const column = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(columnOf));
    columns.set(hash, column);
    return column;
  };

  const live = reachable(repo);
  const lanes = new Map<Hash, number>();
  let laneCount = 0;
  const placeChain = (tip: Hash): void => {
    const chain: Hash[] = [];
    for (let hash: Hash | undefined = tip; hash !== undefined && !lanes.has(hash); ) {
      chain.push(hash);
      hash = commitOf(repo, hash).parents[0];
    }
    if (chain.length === 0) return;
    for (const hash of chain) lanes.set(hash, laneCount);
    laneCount += 1;
  };
  for (const tip of repo.branches.values()) placeChain(tip);
  const orphanTips = [...live].filter(
    (hash) =>
      !lanes.has(hash) &&
      ![...live].some((other) => !lanes.has(other) && commitOf(repo, other).parents.some((parent) => parent === hash)),
  );
  for (const tip of orphanTips) placeChain(tip);

  const ghosts = previous === null ? [] : [...reachable(previous)].filter((hash) => !live.has(hash));
  const ghostLane = laneCount;

  const frames: Placed[] = [
    ...[...live].map((hash) => ({ hash, lane: lanes.get(hash) ?? 0, column: columnOf(hash), ghost: false })),
    ...ghosts.map((hash) => ({ hash, lane: ghostLane, column: columnOf(hash), ghost: true })),
  ].sort((a, b) => a.column - b.column || a.lane - b.lane);

  const shown = new Set(frames.map((frame) => frame.hash));
  const links: Link[] = frames.flatMap((frame) =>
    commitOf(repo, frame.hash)
      .parents.filter((parent) => shown.has(parent))
      .map((parent) => ({ from: parent, to: frame.hash, ghost: frame.ghost })),
  );

  const tapes = new Map<Hash, BranchName[]>();
  for (const [branch, tip] of repo.branches) tapes.set(tip, [...(tapes.get(tip) ?? []), branch]);

  return { frames, links, tapes, pending: isDirty(repo) ? pendingSlot(repo, frames) : null };
}

function pendingSlot(repo: Repo, frames: readonly Placed[]): Slot {
  const head = headCommit(repo);
  const tip = head === null ? undefined : frames.find((frame) => frame.hash === head.hash);
  if (tip === undefined) return { lane: 0, column: 0 };
  const column = tip.column + 1;
  const taken = (lane: number): boolean => frames.some((frame) => frame.lane === lane && frame.column === column);
  let lane = tip.lane;
  while (taken(lane)) lane += 1;
  return { lane, column };
}

export type DiffLine = { readonly text: string; readonly kind: "same" | "added" | "removed" };

export function lineDiff(before: string, after: string): readonly DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const common: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  const at = (i: number, j: number): number => common[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = common[i];
    if (row === undefined) continue;
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];
    if (left !== undefined && right !== undefined && left === right) {
      lines.push({ text: left, kind: "same" });
      i += 1;
      j += 1;
    } else if (left !== undefined && (right === undefined || at(i + 1, j) >= at(i, j + 1))) {
      lines.push({ text: left, kind: "removed" });
      i += 1;
    } else if (right !== undefined) {
      lines.push({ text: right, kind: "added" });
      j += 1;
    }
  }
  return lines;
}
