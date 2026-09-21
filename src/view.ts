import { changedFiles, commitOf, FILE_NAMES, headCommit, lineDiff, type Files, type Hash, type Slot } from "./model.ts";
import {
  initialState,
  sceneOf,
  shownOf,
  transition,
  type FrameTarget,
  type Scene,
  type Shown,
  type Tab,
  type ViewEvent,
  type ViewState,
} from "./navigation.ts";
import { CHAPTERS, steps } from "./scenario.ts";

const FRAME_W = 168;
const FRAME_H = 116;
const LANE_H = 210;
const TOP = 64;
const LEFT = 48;
const CAPTION_H = 56;
const SVG_NS = "http://www.w3.org/2000/svg";

const TAPE_CLASS: Readonly<Record<string, string>> = { main: "main", garnitures: "a", couleurs: "b" };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  node.append(...children);
  return node;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Readonly<Record<string, string>>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function byId<T extends Element>(id: string, type: abstract new (...args: never[]) => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`missing #${id}`);
  return node;
}

function inline(text: string): readonly Node[] {
  return text.split("`").map((part, index) => (index % 2 === 1 ? el("code", "", [part]) : document.createTextNode(part)));
}

const SITE_BASE =
  ":host{display:block;background:#fff;color:#222;overflow:hidden}" +
  ".page{box-sizing:border-box;min-height:100%;padding:8px;font-family:serif;line-height:1.3}";

function renderSite(host: HTMLElement, files: Files): void {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const source = new DOMParser().parseFromString(files["index.html"] ?? "", "text/html");
  const linked = source.querySelector('link[rel="stylesheet"][href="style.css"]') !== null;
  const css = linked ? (files["style.css"] ?? "").replaceAll(/\bbody\b/g, ".page") : "";
  const page = el("div", "page", [...source.body.childNodes].map((node) => document.importNode(node, true)));
  root.replaceChildren(el("style", "", [SITE_BASE + css]), page);
}

function origin(slot: Slot): { readonly x: number; readonly y: number } {
  return { x: LEFT + slot.column * FRAME_W, y: TOP + slot.lane * LANE_H };
}

function linkPath(from: Slot, to: Slot): string | null {
  if (from.lane === to.lane && to.column === from.column + 1) return null;
  const a = origin(from);
  const b = origin(to);
  if (to.lane > from.lane) {
    const sx = a.x + FRAME_W - 6;
    const sy = a.y + FRAME_H;
    const ey = b.y + FRAME_H / 2;
    const r = Math.min(12, b.x - sx, ey - sy);
    return `M ${sx} ${sy} L ${sx} ${ey - r} Q ${sx} ${ey} ${sx + r} ${ey} L ${b.x} ${ey}`;
  }
  if (to.lane < from.lane) {
    const sx = a.x + FRAME_W;
    const sy = a.y + FRAME_H / 2;
    const ex = b.x + 6;
    const ey = b.y + FRAME_H;
    const r = Math.min(12, ex - sx, sy - ey);
    return `M ${sx} ${sy} L ${ex - r} ${sy} Q ${ex} ${sy} ${ex} ${sy - r} L ${ex} ${ey}`;
  }
  return `M ${a.x + FRAME_W} ${a.y + FRAME_H / 2} L ${b.x} ${b.y + FRAME_H / 2}`;
}

function ellipseAround(slots: readonly Slot[]): Readonly<Record<string, string>> | null {
  const points = slots.map(origin);
  if (points.length === 0) return null;
  const left = Math.min(...points.map((p) => p.x));
  const right = Math.max(...points.map((p) => p.x)) + FRAME_W;
  const top = Math.min(...points.map((p) => p.y));
  const bottom = Math.max(...points.map((p) => p.y)) + FRAME_H;
  const halfW = (right - left) / 2;
  const halfH = (bottom - top) / 2;
  const ry = halfH + 30;
  const rx = halfW / Math.sqrt(1 - (halfH * halfH) / (ry * ry)) + 8;
  const cx = left + halfW;
  const cy = top + halfH;
  return {
    cx: `${cx}`,
    cy: `${cy}`,
    rx: `${rx}`,
    ry: `${ry}`,
    transform: `rotate(-2 ${cx} ${cy})`,
    pathLength: "1",
    class: "pencil",
  };
}

export function start(): void {
  const chapters = byId("chapters", HTMLOListElement);
  const table = byId("table", HTMLElement);
  const sheet = byId("sheet", HTMLDivElement);
  const marks = byId("marks", SVGSVGElement);
  const empty = byId("empty", HTMLParagraphElement);
  const where = byId("where", HTMLParagraphElement);
  const term = byId("term", HTMLPreElement);
  const title = byId("step-title", HTMLHeadingElement);
  const text = byId("step-text", HTMLParagraphElement);
  const prev = byId("prev", HTMLButtonElement);
  const next = byId("next", HTMLButtonElement);
  const alt = byId("alt", HTMLButtonElement);
  const filesWhere = byId("files-where", HTMLSpanElement);
  const filesHint = byId("files-hint", HTMLSpanElement);
  const tabs = byId("tabs", HTMLDivElement);
  const fileView = byId("file-view", HTMLDivElement);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const frames = new Map<Hash, HTMLButtonElement>();
  let pendingFrame: HTMLButtonElement | null = null;
  const preview = el("div", "preview");
  let state: ViewState = initialState;
  let circled: { readonly position: ViewState["position"]; readonly ellipse: SVGEllipseElement } | null = null;

  const send = (event: ViewEvent): void => {
    const following = transition(state, event);
    if (following === state) return;
    state = following;
    render();
  };

  for (const chapter of [1, 2, 3] as const) {
    const button = el("button", "", [`${chapter}. ${CHAPTERS[chapter]}`]);
    button.type = "button";
    button.dataset["chapter"] = `${chapter}`;
    button.addEventListener("click", () => send({ type: "chapter", chapter }));
    chapters.append(el("li", "", [button]));
  }

  prev.addEventListener("click", () => send({ type: "back" }));
  next.addEventListener("click", () => send({ type: "next", wrap: true }));
  alt.addEventListener("click", () => send({ type: "toggle-variant" }));
  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "ArrowRight") send({ type: "next", wrap: false });
    if (event.key === "ArrowLeft") send({ type: "back" });
  });

  function newFrame(target: FrameTarget): HTMLButtonElement {
    const frame = el("button", "frame develop", [
      el("span", "rebate", [el("span", "tapes"), el("span", "shot", [el("span", "site")]), el("span", "hash")]),
      el("span", "msg"),
    ]);
    frame.type = "button";
    frame.addEventListener("click", () => send({ type: "pick", target }));
    frame.addEventListener("animationend", () => frame.classList.remove("develop"), { once: true });
    sheet.append(frame);
    return frame;
  }

  function part(frame: HTMLElement, selector: string): HTMLElement {
    const found = frame.querySelector(selector);
    if (!(found instanceof HTMLElement)) throw new Error(`frame without ${selector}`);
    return found;
  }

  function place(frame: HTMLElement, slot: Slot): void {
    const { x, y } = origin(slot);
    frame.style.transform = `translate(${x}px, ${y}px)`;
  }

  function renderTapes(frame: HTMLElement, branches: readonly string[], head: string): void {
    part(frame, ".tapes").replaceChildren(
      ...branches.map((branch) =>
        el("span", `tape ${TAPE_CLASS[branch] ?? "a"}`, branch === head ? [el("span", "head", ["HEAD → "]), branch] : [branch]),
      ),
    );
  }

  function isPicked(target: FrameTarget): boolean {
    const { inspection } = state;
    if (inspection.kind !== "picked") return false;
    const picked = inspection.target;
    return picked.kind === "pending" ? target.kind === "pending" : target.kind === "commit" && target.hash === picked.hash;
  }

  function renderTable(scene: Scene): void {
    const { repo, layout: view } = scene;
    const slots = new Map<Hash, Slot>();

    for (const placed of view.frames) {
      const commit = commitOf(repo, placed.hash);
      const target: FrameTarget = { kind: "commit", hash: placed.hash };
      let frame = frames.get(placed.hash);
      if (frame === undefined) {
        frame = newFrame(target);
        renderSite(part(frame, ".site"), commit.files);
        part(frame, ".hash").textContent = commit.hash;
        frames.set(placed.hash, frame);
      }
      part(frame, ".msg").textContent = placed.ghost ? `${commit.message} (ancienne copie)` : commit.message;
      frame.setAttribute(
        "aria-label",
        `${placed.ghost ? "Ancienne copie du commit" : "Commit"} ${commit.hash} : ${commit.message}. Voir les fichiers.`,
      );
      frame.classList.toggle("ghost", placed.ghost);
      frame.classList.toggle("inspected", isPicked(target));
      renderTapes(frame, view.tapes.get(placed.hash) ?? [], repo.head);
      place(frame, placed);
      slots.set(placed.hash, placed);
    }
    for (const [hash, frame] of frames) {
      if (slots.has(hash)) continue;
      frame.remove();
      frames.delete(hash);
    }

    if (view.pending === null) {
      pendingFrame?.remove();
      pendingFrame = null;
    } else {
      pendingFrame ??= newFrame({ kind: "pending" });
      pendingFrame.classList.add("pending");
      pendingFrame.classList.toggle("inspected", isPicked({ kind: "pending" }));
      renderSite(part(pendingFrame, ".site"), repo.worktree);
      part(pendingFrame, ".msg").textContent = "Pas encore enregistré";
      pendingFrame.setAttribute("aria-label", "Modifications pas encore enregistrées. Voir les fichiers.");
      place(pendingFrame, view.pending);
    }

    const all = [...slots.values(), ...(view.pending === null ? [] : [view.pending])];
    const columns = Math.max(0, ...all.map((slot) => slot.column + 1));
    const lanes = Math.max(0, ...all.map((slot) => slot.lane + 1));
    sheet.style.width = `${LEFT + columns * FRAME_W + 80}px`;
    sheet.style.height = lanes === 0 ? "" : `${TOP + (lanes - 1) * LANE_H + FRAME_H + CAPTION_H}px`;
    empty.hidden = all.length > 0;

    const drawn = new Map<string, SVGPathElement>();
    for (const path of marks.querySelectorAll("path")) drawn.set(path.getAttribute("data-key") ?? "", path);
    const linkFor = (from: Slot, to: Slot, name: string, ghost: boolean): readonly SVGPathElement[] => {
      const d = linkPath(from, to);
      if (d === null) return [];
      const key = `${name}|${ghost}|${d}`;
      const reused = drawn.get(key);
      if (reused !== undefined) {
        reused.classList.remove("fresh");
        return [reused];
      }
      return [svg("path", { d, "data-key": key, class: ghost ? "link ghost fresh" : "link fresh" })];
    };
    const paths = view.links.flatMap((link) => {
      const from = slots.get(link.from);
      const to = slots.get(link.to);
      return from === undefined || to === undefined ? [] : linkFor(from, to, `${link.from}>${link.to}`, link.ghost);
    });
    const head = headCommit(repo);
    const headSlot = head === null ? undefined : slots.get(head.hash);
    if (view.pending !== null && headSlot !== undefined) paths.push(...linkFor(headSlot, view.pending, "pending", true));

    const marked = scene.circled.flatMap((target) => {
      const slot = target.kind === "pending" ? view.pending : slots.get(target.hash);
      return slot === null || slot === undefined ? [] : [slot];
    });
    if (circled?.position !== state.position) {
      const attributes = ellipseAround(marked);
      circled = attributes === null ? null : { position: state.position, ellipse: svg("ellipse", attributes) };
    }
    marks.replaceChildren(...paths, ...(circled === null ? [] : [circled.ellipse]));

    if (circled !== null) {
      const box = circled.ellipse.getBBox();
      const left = box.x - 16;
      const right = box.x + box.width + 16;
      if (left < table.scrollLeft || right > table.scrollLeft + table.clientWidth) {
        table.scrollTo({ left: Math.max(0, right - table.clientWidth), behavior: reducedMotion.matches ? "auto" : "smooth" });
      }
    }
  }

  function renderStep(scene: Scene): void {
    const { position } = scene;
    const { step } = position.page;
    const inChapter = steps.filter((other) => other.chapter === step.chapter);
    where.textContent =
      position.kind === "variant"
        ? `Chapitre ${step.chapter}, variante`
        : `Chapitre ${step.chapter}, étape ${inChapter.indexOf(step) + 1} sur ${inChapter.length}`;

    const { command } = scene;
    const lines: (Node | string)[] =
      command === null
        ? [el("span", "note", ["Aucune commande : on écrit dans les fichiers."])]
        : command.typed.split("\n").flatMap((line, lineIndex) => [
            ...(lineIndex > 0 ? ["\n"] : []),
            el("span", "prompt", ["$ "]),
            line,
          ]);
    const output = command?.output === undefined ? [] : ["\n", el("span", "output", [command.output])];
    term.replaceChildren(...lines, ...output);

    title.replaceChildren(...inline(scene.title));
    text.replaceChildren(...inline(scene.text));

    for (const button of chapters.querySelectorAll("button")) {
      if (button.dataset["chapter"] === `${step.chapter}`) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    }
    prev.disabled = transition(state, { type: "back" }) === state;
    next.textContent = transition(state, { type: "next", wrap: false }) === state ? "Recommencer" : "Suivant";
    const { variant } = position.page;
    alt.hidden = variant === null;
    alt.textContent = position.kind === "variant" ? "Revenir au scénario" : (variant?.alternative.label ?? "");
    alt.classList.toggle("on", position.kind === "variant");
  }

  function renderFiles(shown: Shown): void {
    if (shown.kind === "none") {
      filesWhere.replaceChildren("Le dossier est vide.");
      filesHint.replaceChildren();
      tabs.replaceChildren();
      fileView.replaceChildren(el("p", "files-empty", ["Aucun fichier pour l'instant."]));
      return;
    }
    filesWhere.replaceChildren(
      ...(shown.kind === "commit"
        ? ["Le projet au commit ", el("code", "", [shown.hash])]
        : ["Le dossier de travail, pas encore enregistré"]),
    );
    filesHint.replaceChildren(
      shown.kind === "commit" ? "Surligné : ce que ce commit change" : "Surligné : ce qui n'est pas encore dans un commit",
    );

    const names = FILE_NAMES.filter((name) => shown.files[name] !== undefined);
    const changed = new Set(changedFiles(shown.before, shown.files));
    const tab: Tab = state.tab ?? names.find((name) => changed.has(name)) ?? names[0] ?? "preview";

    const tabButton = (value: Tab, label: string, dot: boolean): HTMLButtonElement => {
      const button = el("button", "", [label, ...(dot ? [el("span", "dot", [])] : [])]);
      button.type = "button";
      button.setAttribute("aria-pressed", `${value === tab}`);
      if (dot) button.title = "Modifié par ce commit";
      button.addEventListener("click", () => send({ type: "tab", tab: value }));
      return button;
    };
    tabs.replaceChildren(
      ...names.map((name) => tabButton(name, name, changed.has(name))),
      tabButton("preview", "Aperçu", false),
    );

    if (tab === "preview") {
      renderSite(preview, shown.files);
      fileView.replaceChildren(preview);
      return;
    }
    let number = 0;
    const rows = lineDiff(shown.before[tab] ?? "", shown.files[tab] ?? "").map((line) => {
      if (line.kind !== "removed") number += 1;
      const label = line.kind === "removed" ? "−" : `${number}`;
      const kind = line.kind === "added" ? "add" : line.kind === "removed" ? "del" : "";
      return el("span", `line ${kind}`.trim(), [el("span", "ln", [label]), line.text === "" ? " " : line.text]);
    });
    fileView.replaceChildren(el("pre", "code", rows));
  }

  function render(): void {
    const scene = sceneOf(state.position);
    renderStep(scene);
    renderTable(scene);
    renderFiles(shownOf(scene, state.inspection));
  }

  render();
}
