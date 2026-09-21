# Git, image par image

Une page interactive pour comprendre Git sur un tout petit projet, une recette de crêpes en une page. Elle couvre trois notions :

1. les commits : chaque commit est une photo complète du projet, avec son identifiant ;
2. les branches : une branche est une étiquette collée sur un commit ;
3. la fusion linéaire : `rebase` puis fast-forward, comparés au merge classique et au squash.

L'historique s'affiche comme une planche contact, et les fichiers du projet à côté. On avance étape par étape avec Suivant, Précédent ou les flèches du clavier. Un clic sur une image montre les fichiers tels qu'ils étaient à ce commit.

**La page :** https://bengous.github.io/git-image-par-image/

## Lancer en local

Il faut [Bun](https://bun.sh).

```bash
bun install
bun test          # le modèle Git, le scénario et la navigation
bun run check     # les types
bun run build     # dist/index.html et dist/app.js
bun run preview   # http://localhost:4173/
```

## Organisation

| Fichier | Rôle |
|---------|------|
| `src/model.ts` | un mini-Git pur : commit, switch, merge, rebase, placement des images |
| `src/scenario.ts` | les 19 étapes et le contenu des fichiers de la recette |
| `src/navigation.ts` | la machine à états de la page : étape, variante, image regardée, onglet |
| `src/view.ts` | le DOM |
| `index.html` | les styles et la structure de la page |
