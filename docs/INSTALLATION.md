# Installation — MPL Ballin’ d’Or 2026

Ce guide prépare le service. Le dépôt ne déploie pas le site et ne crée pas les fichiers Google à lui seul.

## 1. Préparer le fichier maître

1. Ouvre le Google Sheets maître dédié au scrutin. Laisse le partage sur « Accès restreint » et ne sélectionne pas « Toute personne disposant du lien ».
2. Depuis ce classeur, ouvre **Extensions → Apps Script**.
3. Remplace le contenu de `Code.gs` par `apps-script/Code.gs`, ajoute le fichier `Catalog.gs` depuis `apps-script/Catalog.gs`, et active le manifeste `appsscript.json` avec le contenu fourni.
4. Dans les paramètres du projet Apps Script, règle le fuseau sur `Africa/Abidjan`.
5. Exécute `setupMasterSpreadsheet()` une fois et accorde les autorisations Google demandées. La fonction crée les onglets du fichier maître et retire l’accès général par lien. Vérifie ensuite le partage dans Google Drive.

Les onglets `Voters`, `Links`, `OtpCodes`, `Sessions`, `Ballots` et `Audit` contiennent des données privées. Le fichier maître reste limité aux administrateurs autorisés.

## 2. Ajouter les secrets Apps Script

Dans **Paramètres du projet → Propriétés du script**, ajoute :

| Propriété | Valeur |
| --- | --- |
| `MPL_API_BRIDGE_SECRET` | Secret aléatoire d’au moins 32 caractères, identique au secret Cloudflare |
| `ADMIN_SECRET` | Secret organisateur indépendant, long et aléatoire |
| `OTP_HASH_PEPPER` | Secret aléatoire distinct utilisé pour hacher les codes e-mail |

Ne colle jamais ces valeurs dans un fichier du dépôt. Déploie ensuite le script comme **application Web**, exécutée en tant que propriétaire. L’accès Web doit permettre à Cloudflare de l’appeler; le pont partagé est vérifié par le secret transmis côté serveur. Copie l’URL de déploiement qui se termine par `/exec`.

## 3. Déployer avec Cloudflare Pages

1. Dans Cloudflare, crée un projet Pages relié à `DRDRACULA1618/Ballon_dOr_MPL`.
2. Laisse la commande de build vide et choisis `public` comme répertoire de sortie.
3. Dans les variables de l’environnement de production, ajoute `MPL_APPS_SCRIPT_URL` avec l’URL Apps Script `/exec`.
4. Ajoute `MPL_API_BRIDGE_SECRET` comme **secret** Cloudflare, avec la même valeur que dans les propriétés Apps Script.
5. Déploie. Le chemin `/api/bridge` reçoit les appels du site et les transmet à Apps Script.

L’adresse organisateur stable sera `https://<domaine-du-site>/admin.html`. Elle n’a pas de jeton d’expiration dans l’URL; l’organisateur saisit sa clé secrète sur la page. Ne mets jamais cette clé dans l’adresse ou le dépôt.

Le dépôt est public : toute valeur commise dans Git est visible. Le secret du pont, le secret organisateur, les e-mails des électeurs, les liens et les bulletins doivent rester dans leurs stockages respectifs.

## 4. Valider le scrutin avant ouverture

1. Confirme les catégories et les 68 nominations. Les graphies actuelles sont celles du premier draft.
2. Résous `data/catalog-review.json`, puis régénère les deux catalogues avec `python3 scripts/generate_catalog.py`.
3. Mets à jour `apps-script/Catalog.gs` dans le projet Apps Script et redéploie la Web App.
4. Dans `/admin.html`, vérifie l’échéance préremplie : 1er décembre 2026 à 23:59:59 GMT, heure d’Abidjan. Le serveur contrôle la clôture à la seconde indiquée.
5. Ajoute les électeurs avec leur nom et l’adresse e-mail enregistrée. Vérifie l’orthographe des adresses et la disponibilité du quota d’envoi Apps Script.
6. Ouvre le scrutin depuis l’espace organisateur, puis envoie les invitations. Chaque lien est individuel et les codes OTP sont envoyés à l’adresse associée.
7. Après clôture, exécute l’audit et synchronise le rapport vers les seuls comptes Google autorisés. Le rapport est un classeur distinct et reste en accès restreint.

L’espace organisateur ne permet pas d’ouvrir le scrutin tant que les confirmations du catalogue ne sont pas résolues, qu’aucun électeur n’est inscrit ou que l’heure limite est absente ou passée.

## Limites opérationnelles

- L’envoi des codes dépend des quotas quotidiens MailApp du compte qui exécute Apps Script; l’interface vérifie le quota disponible avant un envoi.
- Apps Script utilise un verrou global pour sérialiser les écritures. Google Sheets ne fournit pas de transaction multi-onglets; l’audit signale une différence éventuelle entre électeurs marqués comme ayant voté et bulletins enregistrés.
- Le registre du maître est identifiable par l’administrateur. Les bulletins stockés séparément ne contiennent pas le nom ou l’adresse e-mail du votant, mais l’heure d’un vote peut permettre une corrélation temporelle.
- La liste réelle des électeurs, les propriétaires du maître, les comptes autorisés au rapport et les URL de déploiement doivent être configurés hors de Git. L’échéance du projet est le 1er décembre 2026 à 23:59:59 GMT (heure d’Abidjan).
