import { expect, test } from "bun:test";
import { commitOf, layout, reachable, type Hash, type Repo } from "./model.ts";
import { pages, type Page, type Variant } from "./navigation.ts";
import { steps } from "./scenario.ts";

function firstParentChain(repo: Repo, tip: Hash): readonly Hash[] {
  const chain: Hash[] = [];
  for (let hash: Hash | undefined = tip; hash !== undefined; hash = commitOf(repo, hash).parents[0]) chain.push(hash);
  return chain;
}

function pageOf(id: string): Page {
  const page = pages.find((candidate) => candidate.step.id === id);
  if (page === undefined) throw new Error(`no step ${id}`);
  return page;
}

function variantOf(id: string): Variant {
  const { variant } = pageOf(id);
  if (variant === null) throw new Error(`step ${id} has no variant`);
  return variant;
}

test("step ids are unique", () => {
  expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
});

test("every step replays and its focus exists", () => {
  expect(pages).toHaveLength(steps.length);
  for (const { step, repo } of pages) if (step.focus !== null) expect(reachable(repo).has(step.focus)).toBe(true);
});

test("the story ends on a straight history of 7 commits on main alone", () => {
  const last = pages.at(-1);
  if (last === undefined) throw new Error("no page");
  const { repo } = last;
  expect([...repo.branches.keys()]).toEqual(["main"]);
  const live = reachable(repo);
  expect(live.size).toBe(7);
  for (const hash of live) expect(commitOf(repo, hash).parents.length).toBeLessThanOrEqual(1);
  expect(firstParentChain(repo, "f71b4d3")).toHaveLength(7);
});

test("the rebase step shows the two abandoned commits as ghosts", () => {
  const { repo, before } = pageOf("rebase");
  const { frames } = layout(repo, before);
  expect(frames.filter((frame) => frame.ghost).map((frame) => frame.hash)).toEqual(["d0e5a47", "6a3f9b1"]);
});

test("the classic merge variant joins two paths in one commit", () => {
  const { alternative, repo } = variantOf("rebase");
  expect(commitOf(repo, alternative.focus).parents).toEqual(["94ac6d8", "6a3f9b1"]);
  const lanes = new Set(layout(repo, null).frames.map((frame) => frame.lane));
  expect(lanes.size).toBe(2);
});

test("the squash variant ends on a straight history of 6 commits", () => {
  const { repo } = variantOf("cleanup");
  expect([...repo.branches.keys()]).toEqual(["main"]);
  expect(reachable(repo).size).toBe(6);
  expect(firstParentChain(repo, "e46c3b5")).toHaveLength(6);
});

test("only the rebase and cleanup steps carry a variant", () => {
  expect(pages.filter((page) => page.variant !== null).map((page) => page.step.id)).toEqual(["rebase", "cleanup"]);
});
