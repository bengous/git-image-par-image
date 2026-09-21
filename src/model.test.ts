import { describe, expect, test } from "bun:test";
import { apply, commitOf, emptyRepo, GitModelError, layout, lineDiff, tipOf, type Op, type Repo } from "./model.ts";

const run = (ops: readonly Op[], from: Repo = emptyRepo()): Repo => ops.reduce(apply, from);

const base = run([
  { kind: "edit", file: "index.html", content: "a" },
  { kind: "edit", file: "style.css", content: "s" },
  { kind: "commit", hash: "c1", message: "first" },
]);

const forked = run(
  [
    { kind: "switch", branch: "feature", create: true },
    { kind: "edit", file: "style.css", content: "s2" },
    { kind: "commit", hash: "f1", message: "feature" },
    { kind: "switch", branch: "main", create: false },
    { kind: "edit", file: "index.html", content: "b" },
    { kind: "commit", hash: "c2", message: "main moves" },
  ],
  base,
);

describe("apply", () => {
  test("a commit needs a change", () => {
    expect(() => apply(base, { kind: "commit", hash: "x", message: "empty" })).toThrow(GitModelError);
  });

  test("a switch refuses uncommitted changes", () => {
    const dirty = apply(base, { kind: "edit", file: "index.html", content: "dirty" });
    expect(() => apply(dirty, { kind: "switch", branch: "other", create: true })).toThrow(GitModelError);
  });

  test("a commit moves only the current branch", () => {
    expect(tipOf(forked, "feature")).toBe("f1");
    expect(tipOf(forked, "main")).toBe("c2");
    expect(commitOf(forked, "f1").parents).toEqual(["c1"]);
  });

  test("switching restores the files of the branch", () => {
    const onFeature = apply(forked, { kind: "switch", branch: "feature", create: false });
    expect(onFeature.worktree).toEqual({ "index.html": "a", "style.css": "s2" });
  });

  test("a fast-forward is refused once main moved", () => {
    expect(() => apply(forked, { kind: "merge-ff", branch: "feature" })).toThrow(GitModelError);
  });

  test("a rebase replays each commit with a new hash on top of the target", () => {
    const rebased = run(
      [
        { kind: "switch", branch: "feature", create: false },
        { kind: "rebase", onto: "main", hashes: ["f1b"] },
      ],
      forked,
    );
    const copy = commitOf(rebased, "f1b");
    expect(copy.parents).toEqual(["c2"]);
    expect(copy.message).toBe("feature");
    expect(copy.files).toEqual({ "index.html": "b", "style.css": "s2" });
    expect(tipOf(rebased, "feature")).toBe("f1b");
    expect(rebased.commits.has("f1")).toBe(true);
    expect(apply(apply(rebased, { kind: "switch", branch: "main", create: false }), { kind: "merge-ff", branch: "feature" }).branches.get("main")).toBe("f1b");
  });

  test("a rebase refuses a file changed on both sides", () => {
    const clash = run(
      [
        { kind: "edit", file: "style.css", content: "main style" },
        { kind: "commit", hash: "c3", message: "main style" },
        { kind: "switch", branch: "feature", create: false },
      ],
      forked,
    );
    expect(() => apply(clash, { kind: "rebase", onto: "main", hashes: ["x"] })).toThrow(GitModelError);
  });

  test("a rebase needs one hash per replayed commit", () => {
    const onFeature = apply(forked, { kind: "switch", branch: "feature", create: false });
    expect(() => apply(onFeature, { kind: "rebase", onto: "main", hashes: [] })).toThrow(GitModelError);
  });

  test("a merge commit has two parents and both changes", () => {
    const merged = apply(forked, { kind: "merge", branch: "feature", hash: "m", message: "merge" });
    const commit = commitOf(merged, "m");
    expect(commit.parents).toEqual(["c2", "f1"]);
    expect(commit.files).toEqual({ "index.html": "b", "style.css": "s2" });
  });

  test("a squash makes one commit with a single parent", () => {
    const squashed = apply(forked, { kind: "merge-squash", branch: "feature", hash: "s", message: "squash" });
    expect(commitOf(squashed, "s").parents).toEqual(["c2"]);
    expect(() => apply(squashed, { kind: "delete-branch", branch: "feature", force: false })).toThrow(GitModelError);
    expect(apply(squashed, { kind: "delete-branch", branch: "feature", force: true }).branches.has("feature")).toBe(false);
  });
});

describe("layout", () => {
  test("each branch gets its own lane and columns follow parents", () => {
    const { frames } = layout(forked, null);
    expect(frames).toEqual([
      { hash: "c1", lane: 0, column: 0, ghost: false },
      { hash: "c2", lane: 0, column: 1, ghost: false },
      { hash: "f1", lane: 1, column: 1, ghost: false },
    ]);
  });

  test("the commits a rebase abandons become ghosts below the live lanes", () => {
    const onFeature = apply(forked, { kind: "switch", branch: "feature", create: false });
    const rebased = apply(onFeature, { kind: "rebase", onto: "main", hashes: ["f1b"] });
    const { frames } = layout(rebased, onFeature);
    expect(frames.find((frame) => frame.hash === "f1")).toEqual({ hash: "f1", lane: 2, column: 1, ghost: true });
    expect(frames.find((frame) => frame.hash === "f1b")).toEqual({ hash: "f1b", lane: 1, column: 2, ghost: false });
  });

  test("uncommitted changes wait in the slot after HEAD", () => {
    const dirty = apply(base, { kind: "edit", file: "index.html", content: "next" });
    expect(layout(dirty, null).pending).toEqual({ lane: 0, column: 1 });
    expect(layout(base, null).pending).toBeNull();
  });

  test("tapes group the branches that share a commit", () => {
    const branched = apply(base, { kind: "switch", branch: "feature", create: true });
    expect(layout(branched, null).tapes.get("c1")).toEqual(["main", "feature"]);
  });
});

describe("lineDiff", () => {
  test("marks removed lines before the lines that replace them", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { text: "a", kind: "same" },
      { text: "b", kind: "removed" },
      { text: "B", kind: "added" },
      { text: "c", kind: "same" },
      { text: "d", kind: "added" },
    ]);
  });

  test("a new file is all added", () => {
    expect(lineDiff("", "x\ny").map((line) => line.kind)).toEqual(["added", "added"]);
  });
});
