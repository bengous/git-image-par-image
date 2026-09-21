import type { Hash, Op } from "./model.ts";

export interface Command {
  readonly typed: string;
  readonly output?: string;
}

export interface Alternative {
  readonly label: string;
  readonly command: Command;
  readonly title: string;
  readonly text: string;
  readonly focus: Hash;
  readonly after: Step["id"];
  readonly ops: readonly Op[];
}

export interface Step {
  readonly id: string;
  readonly chapter: 1 | 2 | 3;
  readonly command: Command | null;
  readonly title: string;
  readonly text: string;
  readonly focus: Hash | null;
  readonly ops: readonly Op[];
  readonly alternative?: Alternative;
}

export const CHAPTERS: Readonly<Record<Step["chapter"], string>> = {
  1: "Les commits",
  2: "Les branches",
  3: "Fusion linéaire",
};

const README = `# Crêpes du dimanche

Le site de notre recette de crêpes, en une page.`;

function indexHtml(page: { readonly ingredients: boolean; readonly stylesheet: boolean; readonly toppings: readonly string[] }): string {
  const head = [
    "<!doctype html>",
    '<html lang="fr">',
    "<head>",
    '  <meta charset="utf-8">',
    "  <title>Crêpes du dimanche</title>",
    ...(page.stylesheet ? ['  <link rel="stylesheet" href="style.css">'] : []),
    "</head>",
    "<body>",
    "  <h1>Crêpes du dimanche</h1>",
    "  <p>La recette de la famille, pour 4 personnes.</p>",
  ];
  const ingredients = page.ingredients
    ? [
        "  <h2>Ingrédients</h2>",
        "  <ul>",
        "    <li>250 g de farine</li>",
        "    <li>4 œufs</li>",
        "    <li>50 cl de lait</li>",
        "    <li>1 pincée de sel</li>",
        "  </ul>",
      ]
    : [];
  const toppings =
    page.toppings.length === 0
      ? []
      : ["  <h2>Garnitures</h2>", "  <ul>", ...page.toppings.map((item) => `    <li>${item}</li>`), "  </ul>"];
  return [...head, ...ingredients, ...toppings, "</body>", "</html>"].join("\n");
}

function styleCss(look: { readonly title: string; readonly background: boolean }): string {
  return [
    "body {",
    "  font-family: Georgia, serif;",
    "  max-width: 40rem;",
    "  margin: 0 auto;",
    "  padding: 1rem;",
    ...(look.background ? ["  background: #fdf8ec;"] : []),
    "}",
    "h1 {",
    "  margin-top: 0;",
    `  color: ${look.title};`,
    "}",
  ].join("\n");
}

const BROWN = "#7a4b1c";
const BLUE = "#2b5ea7";

const index = {
  first: indexHtml({ ingredients: false, stylesheet: false, toppings: [] }),
  ingredients: indexHtml({ ingredients: true, stylesheet: false, toppings: [] }),
  styled: indexHtml({ ingredients: true, stylesheet: true, toppings: [] }),
  toppings: indexHtml({ ingredients: true, stylesheet: true, toppings: ["Sucre", "Confiture"] }),
  chocolate: indexHtml({ ingredients: true, stylesheet: true, toppings: ["Sucre", "Confiture", "Chocolat"] }),
};
const style = {
  brown: styleCss({ title: BROWN, background: false }),
  blue: styleCss({ title: BLUE, background: false }),
  blueOnLight: styleCss({ title: BLUE, background: true }),
};

const commit = (hash: Hash, message: string): Op => ({ kind: "commit", hash, message });
const addAndCommit = (file: string, message: string): Command => ({ typed: `git add ${file}\ngit commit -m "${message}"` });

export const steps: readonly Step[] = [
  {
    id: "init",
    chapter: 1,
    command: { typed: "git init" },
    title: "Un dépôt vide",
    text: "`git init` transforme le dossier du projet en dépôt Git. L'historique est vide : aucune image sur la table. La branche `main` existera dès le premier commit.",
    focus: null,
    ops: [],
  },
  {
    id: "first-files",
    chapter: 1,
    command: null,
    title: "On écrit les premiers fichiers",
    text: "On crée `README.md` et `index.html` dans le dossier. Git voit ces fichiers, mais ne les a pas encore enregistrés : l'image en pointillé attend son commit.",
    focus: null,
    ops: [
      { kind: "edit", file: "README.md", content: README },
      { kind: "edit", file: "index.html", content: index.first },
    ],
  },
  {
    id: "first-commit",
    chapter: 1,
    command: addAndCommit(".", "Crée la page de la recette"),
    title: "Le premier commit",
    text: "`git add` choisit les fichiers à enregistrer, `git commit` les enregistre. Un commit est une photo complète du projet à cet instant, avec un identifiant imprimé sur le bord : `3f9a1c2`. Le ruban `main` se colle sur cette image.",
    focus: "3f9a1c2",
    ops: [commit("3f9a1c2", "Crée la page de la recette")],
  },
  {
    id: "edit-ingredients",
    chapter: 1,
    command: null,
    title: "On modifie index.html",
    text: "On ajoute la liste des ingrédients. Le fichier change dans le dossier, mais l'historique ne bouge pas : le changement surligné n'est encore dans aucun commit.",
    focus: null,
    ops: [{ kind: "edit", file: "index.html", content: index.ingredients }],
  },
  {
    id: "commit-ingredients",
    chapter: 1,
    command: addAndCommit("index.html", "Ajoute les ingrédients"),
    title: "Un deuxième commit",
    text: "Le nouveau commit pointe vers le précédent, son parent. Le ruban `main` avance tout seul sur la nouvelle image : une branche suit toujours son dernier commit.",
    focus: "8b04e7d",
    ops: [commit("8b04e7d", "Ajoute les ingrédients")],
  },
  {
    id: "commit-style",
    chapter: 1,
    command: addAndCommit(".", "Ajoute une feuille de style"),
    title: "Un commit peut toucher plusieurs fichiers",
    text: "Ce commit crée `style.css` et ajoute une ligne dans `index.html`. Dans la miniature, le titre devient brun. Chaque image garde l'état exact de tous les fichiers.",
    focus: "c52d19a",
    ops: [
      { kind: "edit", file: "style.css", content: style.brown },
      { kind: "edit", file: "index.html", content: index.styled },
      commit("c52d19a", "Ajoute une feuille de style"),
    ],
  },
  {
    id: "log",
    chapter: 1,
    command: {
      typed: "git log --oneline",
      output: [
        "c52d19a (HEAD -> main) Ajoute une feuille de style",
        "8b04e7d Ajoute les ingrédients",
        "3f9a1c2 Crée la page de la recette",
      ].join("\n"),
    },
    title: "Revenir sur une version",
    text: "`git log` liste les commits, du plus récent au plus ancien. Rien ne change dans le projet. Cliquez une image de la table pour voir les fichiers tels qu'ils étaient à ce commit.",
    focus: "c52d19a",
    ops: [],
  },
  {
    id: "branch-toppings",
    chapter: 2,
    command: { typed: "git switch -c garnitures" },
    title: "Une branche est une étiquette",
    text: "`git switch -c` crée la branche `garnitures` et s'y place. Git ne copie aucun fichier : il colle un deuxième ruban sur la même image. `HEAD` indique la branche sur laquelle on travaille.",
    focus: "c52d19a",
    ops: [{ kind: "switch", branch: "garnitures", create: true }],
  },
  {
    id: "commit-toppings",
    chapter: 2,
    command: addAndCommit("index.html", "Ajoute la section garnitures"),
    title: "Travailler sur une branche",
    text: "Le commit part sur `garnitures`, puisque `HEAD` est dessus. Son ruban avance, et `main` reste sur l'image d'avant.",
    focus: "1e7b3f0",
    ops: [{ kind: "edit", file: "index.html", content: index.toppings }, commit("1e7b3f0", "Ajoute la section garnitures")],
  },
  {
    id: "commit-chocolate",
    chapter: 2,
    command: addAndCommit("index.html", "Ajoute la garniture chocolat"),
    title: "Encore un commit sur garnitures",
    text: "La branche `garnitures` compte maintenant deux commits que `main` n'a pas.",
    focus: "94ac6d8",
    ops: [
      { kind: "edit", file: "index.html", content: index.chocolate },
      commit("94ac6d8", "Ajoute la garniture chocolat"),
    ],
  },
  {
    id: "switch-main",
    chapter: 2,
    command: { typed: "git switch main" },
    title: "Changer de branche change les fichiers",
    text: "`HEAD` revient sur `main`, et Git remet les fichiers dans l'état de son commit : la section garnitures disparaît de `index.html`. Elle n'est pas perdue, elle reste dans les commits de `garnitures`.",
    focus: "c52d19a",
    ops: [{ kind: "switch", branch: "main", create: false }],
  },
  {
    id: "branch-colors",
    chapter: 2,
    command: { typed: "git switch -c couleurs" },
    title: "Une deuxième branche",
    text: "On crée `couleurs` à partir de `main`. Elle part de la même image que `garnitures` : les deux branches ne savent rien l'une de l'autre.",
    focus: "c52d19a",
    ops: [{ kind: "switch", branch: "couleurs", create: true }],
  },
  {
    id: "commit-blue",
    chapter: 2,
    command: addAndCommit("style.css", "Passe le titre en bleu"),
    title: "L'historique bifurque",
    text: "Ce commit a le même parent que le premier commit de `garnitures`. Deux bandes partent maintenant de la même image : l'historique a deux chemins.",
    focus: "d0e5a47",
    ops: [{ kind: "edit", file: "style.css", content: style.blue }, commit("d0e5a47", "Passe le titre en bleu")],
  },
  {
    id: "commit-background",
    chapter: 2,
    command: addAndCommit("style.css", "Ajoute un fond clair"),
    title: "Deux branches prêtes",
    text: "Chaque branche a deux commits. Il faut maintenant les ramener dans `main`, en gardant un historique en ligne droite.",
    focus: "6a3f9b1",
    ops: [{ kind: "edit", file: "style.css", content: style.blueOnLight }, commit("6a3f9b1", "Ajoute un fond clair")],
  },
  {
    id: "ff-toppings",
    chapter: 3,
    command: { typed: "git switch main\ngit merge --ff-only garnitures" },
    title: "Le fast-forward : main avance",
    text: "`main` n'a pas bougé depuis la création de `garnitures`, donc Git n'a rien à combiner : il fait glisser le ruban `main` jusqu'au bout de `garnitures`. Aucun nouveau commit, l'historique reste droit. `--ff-only` refuse la fusion si ce glissement est impossible.",
    focus: "94ac6d8",
    ops: [
      { kind: "switch", branch: "main", create: false },
      { kind: "merge-ff", branch: "garnitures" },
    ],
  },
  {
    id: "switch-colors",
    chapter: 3,
    command: { typed: "git switch couleurs" },
    title: "couleurs est en retard",
    text: "`couleurs` part encore de l'ancienne position de `main`. Le ruban `main` ne peut pas glisser jusqu'à elle : `main` a avancé sur un autre chemin.",
    focus: "6a3f9b1",
    ops: [{ kind: "switch", branch: "couleurs", create: false }],
  },
  {
    id: "rebase",
    chapter: 3,
    command: { typed: "git rebase main" },
    title: "Les commits de `couleurs` sont rejoués au bout de `main`",
    text: "Git reprend chaque commit de `couleurs` et le rejoue après le dernier commit de `main`. Le changement est le même, mais le parent a changé : Git lui donne donc un nouvel identifiant. Les anciennes copies restent en pointillé, car plus aucune branche ne les désigne.",
    focus: "f71b4d3",
    ops: [{ kind: "rebase", onto: "main", hashes: ["2c8e05f", "f71b4d3"] }],
    alternative: {
      label: "Voir avec un merge classique",
      command: { typed: "git switch main\ngit merge couleurs" },
      title: "Le merge classique",
      text: "Sans rebase, `git merge couleurs` crée un commit de fusion, `5d2c8a0`, qui a deux parents. Les deux chemins restent visibles : l'historique n'est plus une ligne droite. On rebase d'abord pour éviter cette bifurcation.",
      focus: "5d2c8a0",
      after: "switch-colors",
      ops: [
        { kind: "switch", branch: "main", create: false },
        { kind: "merge", branch: "couleurs", hash: "5d2c8a0", message: "Merge branch 'couleurs'" },
      ],
    },
  },
  {
    id: "ff-colors",
    chapter: 3,
    command: { typed: "git switch main\ngit merge --ff-only couleurs" },
    title: "Un deuxième fast-forward",
    text: "Après le rebase, `couleurs` part du bout de `main`. Le ruban `main` peut de nouveau glisser jusqu'au bout : il ne reste qu'une bande de film.",
    focus: "f71b4d3",
    ops: [
      { kind: "switch", branch: "main", create: false },
      { kind: "merge-ff", branch: "couleurs" },
    ],
  },
  {
    id: "cleanup",
    chapter: 3,
    command: { typed: "git branch -d garnitures couleurs" },
    title: "Un historique en ligne droite",
    text: "Les deux branches sont dans `main` : on retire leurs rubans, et les commits restent. L'historique se lit d'un trait, du premier commit au dernier.",
    focus: "f71b4d3",
    ops: [
      { kind: "delete-branch", branch: "garnitures", force: false },
      { kind: "delete-branch", branch: "couleurs", force: false },
    ],
    alternative: {
      label: "Et avec un squash ?",
      command: {
        typed: [
          "git switch main",
          "git merge --squash garnitures",
          'git commit -m "Ajoute les garnitures"',
          "git branch -D garnitures",
          "git switch couleurs",
          "git rebase main",
          "git switch main",
          "git merge --ff-only couleurs",
          "git branch -d couleurs",
        ].join("\n"),
      },
      title: "La variante squash",
      text: "`git merge --squash` regroupe les deux commits de `garnitures` en un seul, `b83e1f6`. L'historique reste droit, mais il compte 6 images au lieu de 7 : le détail de `garnitures` disparaît. Git ne voit plus `garnitures` comme fusionnée, d'où `-D` pour la supprimer.",
      focus: "b83e1f6",
      after: "commit-background",
      ops: [
        { kind: "switch", branch: "main", create: false },
        { kind: "merge-squash", branch: "garnitures", hash: "b83e1f6", message: "Ajoute les garnitures" },
        { kind: "delete-branch", branch: "garnitures", force: true },
        { kind: "switch", branch: "couleurs", create: false },
        { kind: "rebase", onto: "main", hashes: ["0a9d7e2", "e46c3b5"] },
        { kind: "switch", branch: "main", create: false },
        { kind: "merge-ff", branch: "couleurs" },
        { kind: "delete-branch", branch: "couleurs", force: false },
      ],
    },
  },
];
