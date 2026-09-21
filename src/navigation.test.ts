import { describe, expect, test } from "bun:test";
import { initialState, pages, sceneOf, shownOf, transition, type Page, type ViewEvent, type ViewState } from "./navigation.ts";

function pageOf(id: string): Page {
  const page = pages.find((candidate) => candidate.step.id === id);
  if (page === undefined) throw new Error(`no step ${id}`);
  return page;
}

function on(id: string): ViewState {
  return { position: { kind: "step", page: pageOf(id) }, inspection: { kind: "auto" }, tab: null };
}

function run(state: ViewState, ...events: readonly ViewEvent[]): ViewState {
  return events.reduce(transition, state);
}

const last = pages.at(-1);
if (last === undefined) throw new Error("no page");
const lastId = last.step.id;

describe("moving between steps", () => {
  test("next moves one step and forgets the picked frame and the tab", () => {
    const picked = run(on("first-commit"), { type: "pick", target: { kind: "commit", hash: "3f9a1c2" } }, { type: "tab", tab: "README.md" });
    const moved = transition(picked, { type: "next", wrap: false });
    expect(moved.position.page.step.id).toBe("edit-ingredients");
    expect(moved.inspection).toEqual({ kind: "auto" });
    expect(moved.tab).toBeNull();
  });

  test("next at the last step wraps only when asked", () => {
    const end = on(lastId);
    expect(transition(end, { type: "next", wrap: false })).toBe(end);
    expect(transition(end, { type: "next", wrap: true }).position.page.index).toBe(0);
  });

  test("back at the first step changes nothing", () => {
    expect(transition(initialState, { type: "back" })).toBe(initialState);
  });

  test("a chapter opens on its first step", () => {
    expect(transition(on(lastId), { type: "chapter", chapter: 2 }).position.page.step.id).toBe("branch-toppings");
  });
});

describe("variants", () => {
  test("a step without a variant ignores the toggle", () => {
    const plain = on("switch-colors");
    expect(transition(plain, { type: "toggle-variant" })).toBe(plain);
  });

  test("the toggle opens the step's variant and closes it", () => {
    const opened = transition(on("rebase"), { type: "toggle-variant" });
    expect(opened.position.kind).toBe("variant");
    const closed = transition(opened, { type: "toggle-variant" });
    expect(closed.position).toEqual({ kind: "step", page: pageOf("rebase") });
  });

  test("back from a variant returns to its own step, as the button and the arrow key both do", () => {
    const opened = transition(on("rebase"), { type: "toggle-variant" });
    expect(transition(opened, { type: "back" }).position).toEqual({ kind: "step", page: pageOf("rebase") });
  });

  test("next from a variant goes to the following step", () => {
    const opened = transition(on("rebase"), { type: "toggle-variant" });
    expect(transition(opened, { type: "next", wrap: false }).position.page.step.id).toBe("ff-colors");
  });
});

describe("picking a frame", () => {
  test("the pending frame can be picked only while changes wait", () => {
    const clean = on("first-commit");
    expect(transition(clean, { type: "pick", target: { kind: "pending" } })).toBe(clean);
    const dirty = on("edit-ingredients");
    expect(transition(dirty, { type: "pick", target: { kind: "pending" } }).inspection.kind).toBe("picked");
  });

  test("a commit the scene does not hold cannot be picked", () => {
    const early = on("first-commit");
    expect(transition(early, { type: "pick", target: { kind: "commit", hash: "f71b4d3" } })).toBe(early);
  });

  test("a ghost of the rebase can be picked and shows its own files", () => {
    const picked = transition(on("rebase"), { type: "pick", target: { kind: "commit", hash: "6a3f9b1" } });
    const shown = shownOf(sceneOf(picked.position), picked.inspection);
    expect(shown.kind === "commit" && shown.hash).toBe("6a3f9b1");
  });
});

describe("what the files pane shows by default", () => {
  test("the working copy while changes wait", () => {
    const state = on("edit-ingredients");
    expect(shownOf(sceneOf(state.position), state.inspection).kind).toBe("worktree");
  });

  test("the step's focus, against its parent", () => {
    const state = on("rebase");
    const shown = shownOf(sceneOf(state.position), state.inspection);
    expect(shown.kind === "commit" && shown.hash).toBe("f71b4d3");
  });

  test("nothing before the first file", () => {
    expect(shownOf(sceneOf(initialState.position), initialState.inspection).kind).toBe("none");
  });

  test("the circle follows the commits a step adds, or the waiting changes", () => {
    expect(sceneOf(on("rebase").position).circled).toEqual([
      { kind: "commit", hash: "2c8e05f" },
      { kind: "commit", hash: "f71b4d3" },
    ]);
    expect(sceneOf(on("edit-ingredients").position).circled).toEqual([{ kind: "pending" }]);
    expect(sceneOf(on("ff-toppings").position).circled).toEqual([{ kind: "commit", hash: "94ac6d8" }]);
  });
});
