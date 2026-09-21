import { apply, commitOf, emptyRepo, headCommit, isDirty, layout, type FileName, type Files, type Hash, type Layout, type Repo } from "./model.ts";
import { steps, type Alternative, type Command, type Step } from "./scenario.ts";

export interface Variant {
  readonly alternative: Alternative;
  readonly before: Repo;
  readonly repo: Repo;
}

export interface Page {
  readonly index: number;
  readonly step: Step;
  readonly repo: Repo;
  readonly before: Repo;
  readonly variant: Variant | null;
}

export type Position =
  | { readonly kind: "step"; readonly page: Page }
  | { readonly kind: "variant"; readonly page: Page; readonly variant: Variant };

export type FrameTarget = { readonly kind: "commit"; readonly hash: Hash } | { readonly kind: "pending" };
export type Inspection = { readonly kind: "auto" } | { readonly kind: "picked"; readonly target: FrameTarget };
export type Tab = FileName | "preview";

export interface ViewState {
  readonly position: Position;
  readonly inspection: Inspection;
  readonly tab: Tab | null;
}

export type ViewEvent =
  | { readonly type: "next"; readonly wrap: boolean }
  | { readonly type: "back" }
  | { readonly type: "chapter"; readonly chapter: Step["chapter"] }
  | { readonly type: "toggle-variant" }
  | { readonly type: "pick"; readonly target: FrameTarget }
  | { readonly type: "tab"; readonly tab: Tab };

export interface Scene {
  readonly position: Position;
  readonly command: Command | null;
  readonly title: string;
  readonly text: string;
  readonly focus: Hash | null;
  readonly repo: Repo;
  readonly layout: Layout;
  readonly circled: readonly FrameTarget[];
}

export type Shown =
  | { readonly kind: "commit"; readonly hash: Hash; readonly files: Files; readonly before: Files }
  | { readonly kind: "worktree"; readonly files: Files; readonly before: Files }
  | { readonly kind: "none" };

function variantOf(step: Step, earlier: readonly Page[]): Variant | null {
  const { alternative } = step;
  if (alternative === undefined) return null;
  const base = earlier.find((page) => page.step.id === alternative.after);
  if (base === undefined) {
    throw new Error(`the alternative of ${step.id} starts from ${alternative.after}, which is not an earlier step`);
  }
  return { alternative, before: base.repo, repo: alternative.ops.reduce(apply, base.repo) };
}

function buildPages(all: readonly Step[]): readonly Page[] {
  const built: Page[] = [];
  let before = emptyRepo();
  all.forEach((step, index) => {
    const repo = step.ops.reduce(apply, before);
    built.push({ index, step, repo, before, variant: variantOf(step, built) });
    before = repo;
  });
  return built;
}

export const pages: readonly Page[] = buildPages(steps);

const firstPage = pages[0];
if (firstPage === undefined) throw new Error("the scenario has no step");

function at(position: Position): ViewState {
  return { position, inspection: { kind: "auto" }, tab: null };
}

function onStep(page: Page): ViewState {
  return at({ kind: "step", page });
}

export const initialState: ViewState = onStep(firstPage);

function displays(position: Position, target: FrameTarget): boolean {
  const repo = position.kind === "variant" ? position.variant.repo : position.page.repo;
  return target.kind === "pending" ? isDirty(repo) : repo.commits.has(target.hash);
}

export function transition(state: ViewState, event: ViewEvent): ViewState {
  const { position } = state;
  const { page } = position;
  switch (event.type) {
    case "next": {
      const following = pages[page.index + 1] ?? (event.wrap ? firstPage : undefined);
      return following === undefined ? state : onStep(following);
    }
    case "back": {
      if (position.kind === "variant") return onStep(page);
      const preceding = pages[page.index - 1];
      return preceding === undefined ? state : onStep(preceding);
    }
    case "chapter": {
      const first = pages.find((candidate) => candidate.step.chapter === event.chapter);
      return first === undefined ? state : onStep(first);
    }
    case "toggle-variant": {
      if (position.kind === "variant") return onStep(page);
      return page.variant === null ? state : at({ kind: "variant", page, variant: page.variant });
    }
    case "pick":
      return displays(position, event.target) ? { ...state, inspection: { kind: "picked", target: event.target }, tab: null } : state;
    case "tab":
      return { ...state, tab: event.tab };
  }
}

function circledOf(repo: Repo, before: Repo, focus: Hash | null, view: Layout): readonly FrameTarget[] {
  const added = view.frames.filter((frame) => !frame.ghost && !before.commits.has(frame.hash));
  if (added.length > 0) return added.map((frame) => ({ kind: "commit", hash: frame.hash }));
  if (view.pending !== null) return [{ kind: "pending" }];
  return focus === null ? [] : [{ kind: "commit", hash: focus }];
}

export function sceneOf(position: Position): Scene {
  if (position.kind === "variant") {
    const { alternative, before, repo } = position.variant;
    const view = layout(repo, null);
    return {
      position,
      command: alternative.command,
      title: alternative.title,
      text: alternative.text,
      focus: alternative.focus,
      repo,
      layout: view,
      circled: circledOf(repo, before, alternative.focus, view),
    };
  }
  const { step, repo, before } = position.page;
  const view = layout(repo, before);
  return {
    position,
    command: step.command,
    title: step.title,
    text: step.text,
    focus: step.focus,
    repo,
    layout: view,
    circled: circledOf(repo, before, step.focus, view),
  };
}

export function shownOf(scene: Scene, inspection: Inspection): Shown {
  const { repo } = scene;
  const worktree = (): Shown => ({ kind: "worktree", files: repo.worktree, before: headCommit(repo)?.files ?? {} });
  const commit = (hash: Hash): Shown => {
    const found = commitOf(repo, hash);
    const parent = found.parents[0];
    return { kind: "commit", hash, files: found.files, before: parent === undefined ? {} : commitOf(repo, parent).files };
  };
  if (inspection.kind === "picked") {
    return inspection.target.kind === "pending" ? worktree() : commit(inspection.target.hash);
  }
  if (isDirty(repo)) return worktree();
  if (scene.focus !== null) return commit(scene.focus);
  const head = headCommit(repo);
  return head === null ? { kind: "none" } : commit(head.hash);
}
