# MPL Ballin’ d’Or 2026

Plateforme de vote mobile en français, avec interface noire et dorée. Le scrutin reste fermé tant que les intitulés et nominations en attente ne sont pas validés.

## État du projet

- Catalogue reproduit depuis le transfert : 11 catégories et 68 nominations. Les graphies du premier draft sont conservées.
- La clôture communiquée est le 1er décembre 2026 à 23:59:59 GMT (heure d’Abidjan).
- `data/catalog-review.json` contient les confirmations attendues. Le backend refuse l’ouverture tant que cette liste n’est pas vide.
- Aucun électeur, e-mail, lien actif, secret ou bulletin n’est inclus dans Git.
- Aucun déploiement Cloudflare, Web App Apps Script, fichier maître Google Sheets ou rapport de résultats n’est créé par ce dépôt.

Le dépôt GitHub est public : le code et le catalogue des candidats y sont visibles. Ne pas y ajouter le registre des électeurs, des bulletins, des liens de vote ou des secrets.

## Architecture

- `public/` : site statique, aperçu et interface organisateur.
- `functions/api/bridge.js` : passerelle Cloudflare Pages. Le secret du pont reste côté Cloudflare.
- `apps-script/` : API Google Apps Script exécutée avec les droits du propriétaire du fichier maître.
- `data/NOMINATIONS_SOURCE.json` : catalogue source reçu dans l’archive de transfert.
- `data/catalog-review.json` : libellés qui doivent encore être confirmés.
- `scripts/generate_catalog.py` : génère le catalogue du site et celui d’Apps Script depuis la source JSON.

Le code configure le fichier maître Google Sheets en accès restreint et crée des onglets séparés pour les électeurs, liens hachés, codes OTP hachés, sessions, bulletins, paramètres et audit. Après configuration, le rapport de résultats est un classeur distinct, partagé en lecture seule avec les e-mails nommés dans l’espace organisateur. Aucun résultat n’est servi sur la page de vote.

Les liens individuels portent un jeton aléatoire dans le fragment `#t=`. Le navigateur le retire de l’adresse avant toute requête. Apps Script enregistre son empreinte SHA-256, envoie un code e-mail à usage limité et émet une session temporaire après vérification. Un verrou Apps Script sérialise les modifications concurrentes du registre et des bulletins. L’administrateur du fichier maître peut connaître la participation; les bulletins agrégés ne contiennent pas de nom ou d’adresse e-mail. Le rapprochement temporel reste une limite possible pour le propriétaire du fichier maître.

## Préparer le catalogue

Ne corrige pas automatiquement les graphies. Fais valider les intitulés et les alias avec l’organisateur, en particulier les éléments listés dans `data/catalog-review.json`.

Après validation :

1. Mets à jour `data/NOMINATIONS_SOURCE.json` avec les graphies approuvées.
2. Retire uniquement les confirmations résolues de `data/catalog-review.json`.
3. Incrémente `VERSION` dans `scripts/generate_catalog.py`.
4. Lance `python3 scripts/generate_catalog.py`.
5. Déploie ensemble les nouveaux `public/data.js` et `apps-script/Catalog.gs`.

La version du catalogue est gelée à l’ouverture. Pour toute modification après ouverture, clôture le scrutin et prépare une nouvelle version avant de le rouvrir.

## Installation

Les étapes détaillées sont dans [`docs/INSTALLATION.md`](docs/INSTALLATION.md). En bref :

1. Ouvre le fichier Google Sheets maître dédié au scrutin, lance Apps Script depuis ce classeur et ajoute les sources de `apps-script/`.
2. Lance `setupMasterSpreadsheet()` depuis l’éditeur Apps Script et configure ses propriétés secrètes.
3. Déploie Apps Script comme application Web exécutée par le propriétaire, puis copie l’URL `/exec`.
4. Connecte ce dépôt GitHub à Cloudflare Pages. Laisse la commande de build vide et règle `public` comme répertoire de sortie.
5. Ajoute `MPL_APPS_SCRIPT_URL` et le secret `MPL_API_BRIDGE_SECRET` dans les variables Cloudflare Pages.
6. Dans `/admin.html`, valide la date et l’heure, inscris les électeurs, ouvre le scrutin puis envoie les invitations.

## Aperçu

Pour afficher la maquette sans enregistrer de vote, lance un serveur statique depuis la racine du projet :

```sh
python3 -m http.server 8000 --directory public
```

Ouvre ensuite `http://localhost:8000/?demo=1`. L’aperçu montre le catalogue et les éléments à valider. L’API réelle nécessite la configuration Cloudflare et Apps Script.
