# HANDOFF — Bot Discord « Commis » (Le Comptoir des Kamas)

> Document de transfert pour un agent/développeur reprenant ce projet.
> État au 2026-09-27, commit `df1a774`.

---

## 1. Le projet en une phrase

Bot Discord **Commis** (discord.js v14, Node ESM, sans build) qui gère un marché de kamas Dofus :
panneaux à boutons → tickets privés → suivi par étapes → transcription HTML → avis clients.
Hébergé **gratuitement 24/7 sur Render**, avec l'état sauvegardé **dans Discord** (le disque y est éphémère).

**Tout est en français** (interface, docs, messages du bot).

---

## 2. Dépôts et environnements

| Quoi | Où | Notes |
| --- | --- | --- |
| Dépôt GitHub | `github.com/elioflex/Commis` | branche `main` = production. Push = redéploiement Render auto. |
| Copie locale de dev | `/Users/viet/Documents/ChatGPT/test/kamas-market-bot/` | **Ce n'est PAS un clone git** : pour pousser, rsync vers le clone git (voir §9) |
| Clone git de travail | `/tmp/commis-publish/` | temporaire, synchronisé par rsync avant chaque push |
| Production | Render, service **`commis-57du`** | URL : `https://commis-57du.onrender.com` |

⚠️ **Piège connu** : le dossier local de dev et le dépôt GitHub sont dissociés. Toute modification
locale doit être re-synchronisée vers le clone git avant push, sinon elle n'existe pas en production.

Commande de synchro (depuis le dossier de dev) :

```sh
rsync -a --exclude node_modules --exclude .env --exclude .git \
  /Users/viet/Documents/ChatGPT/test/kamas-market-bot/ /tmp/commis-publish/
cd /tmp/commis-publish && git add -A && git commit -m "..." \
  && git -c credential.helper='!gh auth git-credential' push
```

(L'authentification passe par `gh` en HTTPS — pas de clé SSH configurée.)

---

## 3. Architecture des fichiers

```
kamas-market-bot/
├── config.js            ← TOUTE la config : marque, serveurs Dofus (24), devises (5),
│                          moyens de paiement (21), types de tickets, étapes, LAYOUT (salons), ROLES
├── render.yaml          ← blueprint Render (plan free, healthcheck /healthz)
├── DEPLOY.md            ← guide de déploiement pas à pas (lire en premier)
├── README.md            ← doc d'usage
├── HANDOFF.md           ← ce document
├── .env                 ← secrets, JAMAIS versionné (token Discord, IDs)
├── data/                ← état runtime, JSON, éditable à la main
│   ├── market.json      ← taux de base + serverPrices (prix fixés EUR) + serverRates (multiplicateurs) + stock
│   ├── tickets.json     ← tickets ouverts/fermés, compteur
│   ├── reviews.json     ← avis clients
│   └── panels.json      ← mapping panneau → message Discord publié + board (📈・taux-du-jour)
├── src/
│   ├── index.js         ← entry point : login Discord + health server + state mirror
│   ├── interactions.js  ← ROUTEUR : boutons / menus / modales / user-selects
│   ├── commands.js      ← slash commands : /panel /ticket /rate /stock /avis /check /setup /help
│   ├── tickets.js       ← cycle de vie d'un ticket (création, claim, étapes, fermeture)
│   ├── market.js        ← taux, stock, PRIX PAR SERVEUR, calcul des totaux, formatage FR
│   ├── live-board.js    ← met à jour panneaux + 📈・taux-du-jour après chaque changement de prix/stock
│   ├── price-feed.js    ← PRIX WEB : kamasv.com + 1kamas.com (vente), leskamas.com (rachat), proxy en secours
│   ├── embeds.js        ← tous les embeds Discord
│   ├── components.js    ← boutons, menus, modales (builders)
│   ├── persist.js       ← MIROIR D'ÉTAT : sauvegarde data/ dans Discord (salon ⚙️・gestion)
│   ├── store.js         ← lecture/écriture JSON atomique + DATA_DIR + write hook
│   ├── health.js        ← serveur HTTP /healthz (obligatoire pour Render free)
│   ├── preflight.js     ← diagnostic : permissions, hiérarchie rôles, intents, inventaire
│   ├── setup.js         ← /setup : crée rôles, catégories, salons, panneaux (idempotent)
│   ├── guild-utils.js   ← résolution rôles/salons, overwrites staff, isStaff
│   ├── transcript.js    ← transcription HTML autonome
│   └── scripts/setup-server.js  ← CLI : npm run check / setup / setup:full / setup:dry
└── test/
    ├── smoke.test.mjs     ← 13 tests (marché, composants, setup, prix par serveur)
    ├── preflight.test.mjs ← 7 tests (diagnostic, permissions, rôles paiement)
    ├── hosting.test.mjs   ← 8 tests (health server, miroir d'état, DATA_DIR)
    ├── pricing.test.mjs   ← 5 tests (prix fixés, tableau, limites des embeds)
    ├── price-feed.test.mjs ← 8 tests (lecture des 3 sites, garde-fou, priorité des prix)
    └── setup.mjs          ← chaque process de test travaille sur une copie temporaire de data/
```

**46 tests au total** — `npm test` (node:test, sans dépendance).

---

## 4. Fonctionnement du marché (cœur métier)

### Prix par serveur

Sens des salons (important) : **💎・acheter-kamas** affiche le prix auquel **nous vendons**
(`buy`), **💸・vendre-kamas** le prix que **nous payons** au client (`sell`).

Prix d'un serveur, par ordre de priorité :

1. **Prix fixé à la main** (`serverPrices[serveur][sens]`, en EUR/M) — `/rate prix` ou `/rate tableau`.
2. Sinon **prix web** × pourcentage du sens (`feed.factors`) × ajustement du serveur :
   - achat : **97 %** du concurrent le moins cher (kamasv / 1kamas), arrondi au centime inférieur ;
   - vente : **103 %** du meilleur rachat (leskamas.com, sinon 70 % du prix de vente),
     arrondi au centime supérieur ;
   - échange : 45 % de la médiane du marché.
   Un concurrent à plus de 15 % de la médiane est ramené à ±15 % (anti-annonce aberrante).
3. Sinon `taux de base × multiplicateur du serveur` (`serverRates`) × ajustement.

**Ajustement manager** (`adjustments[serveur][sens]`, en %) : `/rate ajuster <sens> <serveurs> <%>`,
serveurs = `tous` ou une liste `drac, ombre`.
Borné à ±50 %, `0` le retire, ne s'applique pas à un prix fixé à la main.

**Garde-fou de marge** : ce qu'on paie (vente) ne dépasse jamais notre prix de vente − 5 %
(`MIN_MARGIN`), sauf prix vente fixé à la main. Signalé 🛡️ dans `/rate auto`.

**Comparaison publique** : sous chaque serveur, les panneaux affichent `🏆 -4 % vs KamasV (0,77 €)`
(achat) ou `🏆 +3 % vs LesKamas (0,52 €)` (vente) — **uniquement** les concurrents qu'on bat,
et seulement si le dernier relevé a moins de 6 h. Jamais de comparaison défavorable.

**Droits** : toute modification de prix (`/rate set|serveur|prix|tableau|ajuster`, réglages de
`/rate auto`) est réservée au **manager** (administrateur ou rôle Manager / `MANAGER_ROLE_ID`).
Le staff peut consulter `/rate auto` sans option.

Le prix en DH est converti avec le ratio des taux de base (MAD/EUR de `rates`).
`/rate prix <serveur> <sens> 0` supprime le prix manuel et rend la main au prix web.

### Prix web automatiques (`src/price-feed.js`)

Toutes les `PRICE_FEED_INTERVAL_MIN` minutes (30 par défaut, minimum 10), le bot lit trois sites.
Deux boutiques qui **vendent** des kamas, via l'API publique WooCommerce (`/wp-json/wc/store/v1/`) :

- **kamasv.com** : un produit par lot (« 10M Kamas Draconiros ») ; le jeu vient de la catégorie racine
  (DOFUS, DOFUS TOUCH, DOFUS RETRO, WAKFU). Prix/M = médiane des lots en stock.
- **1kamas.com** : un produit variable par jeu, une variation par serveur (prix déjà au million).

Et **leskamas.com**, qui **rachète** des kamas : tableau HTML de `/vendre-des-kamas.html`
(une ligne « Dofus Touch Kamas » par jeu, colonne Paypal en €/M) → `feed.sellReference`.

Correspondance par nom normalisé + `aliases` de `config.js`, **uniquement dans le même jeu**
(chaque serveur a un `game`) ; les serveurs saisonniers (Temporis, saisonniers) sont ignorés.
Référence = médiane des boutiques, stockée dans `market.json` → `feed.reference`.

Garde-fous : un prix qui bouge de plus de 50 % est mis en attente (`feed.pending`) et n'est accepté
que s'il est confirmé au relevé suivant ; une boutique en panne garde les derniers prix connus
(erreur visible dans `feed.lastError` et `/rate auto`). Si un prix change, panneaux et
📈・taux-du-jour sont mis à jour. `PRICE_FEED=off` désactive le relevé ; `/rate auto actif:False`
met les prix web en pause sans redéployer.

**Proxy** (`PRICE_FEED_PROXY=http://user:pass@hôte:port`, secret : `.env` et Render uniquement) :
par défaut le bot tente en direct et ne passe par le proxy que pour un site qui le bloque
(403/429/503 ou coupure réseau), pendant 6 h. `PRICE_FEED_PROXY_MODE=always` force le proxy
partout (≈ 4 Go/mois de trafic proxy facturé). Utilise `undici` (déjà fourni par discord.js).

Chaque changement (`/rate`, `/stock`, `/rate tableau`) met à jour **automatiquement** les 3 panneaux
marché (édition du message existant) et les 3 messages de `📈・taux-du-jour` (`src/live-board.js`,
regroupés sur 2 s). Au démarrage, le bot rafraîchit aussi tout. Les panneaux affichent les 5 devises.

```js
// src/market.js
effectiveRate("EUR", "buy", "drac")   // 1.35 × 1.15 = 1.553 €/M
serverMultiplier("drac")              // 1.15 ; serveur sans réglage → 1
setServerMultiplier("drac", 1.2)      // fixe ; 1 ou null → reset
serverRateFields("EUR", "buy")        // champs embed triés par prix croissant
```

- Affichage panneau : liste des 24 serveurs triée par prix (cheapest d'abord) avec stock.
- Le choix du serveur dans un ticket annonce « Prix sur ce serveur : X €/M ».
- **Les totaux des tickets utilisent le prix du serveur choisi**, pas le taux de base
  (dans `tickets.js` ligne ~130 et `interactions.js` `createTicketFromModal`).

### Flux d'un ticket

1. Clic bouton panneau (`panel:<typeId>`) → menu serveur Dofus
2. Choix serveur (`flow:srv:<typeId>`) → affiche le prix du serveur → menu paiement
3. Choix paiement (`flow:pay:<typeId>:<serverCode>`) → récap + bouton formulaire
4. Bouton `flow:go` → modale marché (quantité, devise, personnage, notes)
5. Submit (`modal:market:...`) → `createTicketFromModal` → salon privé `achat-00001`
6. Boutons dans le ticket : claim / move / members / transcript / close
7. Fermeture → transcription HTML vers `📄・transcripts` + DM avis si motif « livre »

Les custom IDs sont au format `scope:action:arg1:arg2` — **c'est la source du bug récent** (§7).

### Devises et sens

- Devises affichées : **EUR et MAD (DH) uniquement** (affichage FR : `1,35 €/M`).
- **Dofus 3 uniquement** : pas de serveurs Touch / Retro / Wakfu. Le relevé web reconnaît encore ces jeux chez les concurrents, uniquement pour les ignorer.
- Sens : `buy` (on vend au client), `sell` (on achète au client), `exchange` (inter-serveurs, -10 % ≥ 100 M).
- Remise échange automatique de 10 % pour les lots ≥ 100 M (`quote()`).

---

## 5. Infrastructure

### Render (plan gratuit)

- Service web `commis-57du`, région Frankfurt, `npm install` + `npm start`.
- **Health check** : `/healthz` doit répondre `ok` — c'est aussi ce que ping le cron externe.
- **cron-job.org** ping l'URL toutes les 10 min sinon le service s'endort après 15 min d'inactivité.
- 750 h gratuites/mois : suffisant pour un seul service 24/7.

### Miroir d'état (critique !)

Le disque Render est **effacé** à chaque redéploiement/restart. `src/persist.js` :

- publie un snapshot JSON de `data/` en pièce jointe dans le salon `⚙️・gestion`
  (message « 💾 Sauvegarde automatique… » — à ne JAMAIS supprimer) ;
- au boot (`restoreState`), le réimporte si l'état local est vide (ou toujours si `STATE_IMPORT=always`) ;
- chaque écriture `store.js` déclenche une sauvegarde différée (8 s) via le write hook.

Variables liées : `STATE_MIRROR=on`, `STATE_IMPORT=always` (Render) / `when-empty` (local), `STATE_CHANNEL_ID`.

### Variables d'environnement (dans `.env` local et Render)

```
DISCORD_TOKEN=...          # token BOT (pas user !)
GUILD_ID=...               # serveur cible
STAFF_ROLE_ID=...          # optionnel, sinon cherche par nom
MANAGER_ROLE_ID=...
LOG_CHANNEL_ID=...
TRANSCRIPT_CHANNEL_ID=...
BRAND_NAME=Le Comptoir des Kamas
BRAND_EMOJI=🏪
BRAND_BOT_NAME=Commis
STATE_MIRROR=on
STATE_IMPORT=always        # Render : force la restauration du snapshot
PORT=...                   # fourni par Render ; absent en local → pas de serveur HTTP
```

⚠️ **Le token Discord a fuité dans une conversation** (il est apparu en clair). À faire par le propriétaire :
Developer Portal → Reset Token, remplacer dans Render + `.env`, supprimer `~/Downloads/gl_secrets copy.txt`.

---

## 6. Serveur Discord (état actuel, tout est déployé)

- **36 rôles** (Manager, Staff, Vérifié, 4 langues, 5 VIP, Daily Gifts, 23 serveurs Dofus)
- **12 catégories** : 7 du plan (`🏪 | Le Comptoir`, `🛒 | Marché`, `🧰 | Aide & Support`,
  `🌍 | Communauté`, `🎉 | Événements & Cadeaux`, `🔊 | Salons Vocaux`, `🔒 | Staff`)
  + 5 colonnes de tickets (`🎟️ | Nouveaux tickets`, `⏳ | En préparation`, `💳 | En cours de paiement`,
  `✅ | Terminé`, `🗄️ | Archivés`)
- **37 salons** texte + vocal
- **5 panneaux** publiés (achat, vente, échange, support, remboursement), messages enregistrés dans `data/panels.json`
- **8 slash commands** enregistrées au niveau du serveur
- Bot : `Commis#8145`, id `1553766275489071206`, rôle **au-dessus** de Staff (requis)
- Guild : `Le Comptoir des Kamas`, id `1553767688034320414`

---

## 7. Historique des bugs corrigés (à connaître)

1. **Rôles doublons / setup interrompu** : les contrôles d'existence par nom utilisaient un cache
   périmé → cache refresh en début de `setupGuild`. Aussi : discord.js ≥ 14.16 veut `colors` (pas `color`).
2. **Bot sans accès aux salons staff** : « Manage Channels » ne contourne pas un deny ViewChannel.
   Fix : `staffOverwrites()` donne au bot (`guild.members.me.id`) une permission explicite.
3. **`undefined.split` sur les menus** : inversion de paramètres — appelé `(client, interaction)`,
   déclaré `(interaction, customId)`. Corrigé en 2 commits (signature + point d'appel). **Leçon :
   tester via le routeur réel, pas en appelant la fonction isolée.**
4. **Métadonnées du PDF** : PDFKit écrit Producer/Creator/CreationDate par défaut → neutralisées
   via `info: { ... vide }` et `creationDate: new Date(0)`.

---

## 8. Tâches restantes / idées d'amélioration

À faire (par ordre de priorité) :

- [ ] **Régénérer le token Discord** (fuité) — voir §5.
- [x] Prix réels par serveur relevés automatiquement sur le web (`src/price-feed.js`).
- [ ] **Valider les pourcentages** (97 % / 103 % / 45 %) et la marge minimale de 5 % avec le propriétaire.
- [ ] Marges faibles quand le rachat ≈ la vente (ex. Mikhal 0,66 / 0,67) : le garde-fou 🛡️ plafonne à -5 % ; décider si on accepte de ne pas battre LesKamas là-bas.
- [x] Panneaux mis à jour automatiquement (édition des messages existants au démarrage et à chaque changement).
- [ ] Vérifier le cron cron-job.org pointe bien sur `https://commis-57du.onrender.com/healthz`.
- [ ] Tester le flux d'achat complet après redéploiement (serveur → paiement → formulaire → salon).

Idées en attente :

- Test d'intégration simulant le routeur d'interactions avec de faux objets Discord.
- Fermeture type « escrow » : refuser de clôturer « livrée » sans confirmation du client.
- Version client du guide (1 page, sans infos techniques).

---

## 9. Commandes utiles

```sh
# Local
npm test                    # 46 tests
npm run check               # diagnostic complet (permissions, hiérarchie, inventaire)
npm run setup:dry           # aperçu du setup sans rien créer
npm run setup               # crée ce qui manque (idempotent)
npm run setup:full          # + rôles par moyen de paiement
npm run deploy              # enregistre les slash commands
npm start                   # lance le bot (PORT absent → pas de serveur HTTP)

# Debug rapide
node --input-type=module -e 'import "dotenv/config"; import {effectiveRate} from "./src/market.js";
  console.log(effectiveRate("EUR","buy","drac"))'

# Déploiement (voir §2 pour la synchro rsync préalable)
cd /tmp/commis-publish && git push
```

---

## 10. Style et conventions

- **Tout en français** (messages, docs, embeds).
- ESM pur (`"type": "module"`), imports avec extension `.js`, pas de TypeScript ni de build.
- Indentation 4 espaces, pas de linter configuré.
- Tests `node:test` + `assert/strict`, sans mock lourd : on teste la logique pure et les builders.
- Embeds : toujours passer par `src/embeds.js`, couleurs depuis `BRAND.colors`.
- Les custom IDs d'interactions : `scope:action:arg…` — vérifier la cohérence appel ↔ signature.
- Toute valeur de config passe par `config.js` (jamais de hard-code dans les handlers).

---

## 11. Ce que l'IA suivante doit savoir

- Le propriétaire n'est **pas développeur** : expliquer simplement, en français.
- Il ne faut **jamais** commit `.env`, ni le token, ni d'info personnelle dans le dépôt.
- Le dépôt GitHub est **public** : tout ce qui y va est visible.
- Les chiffres de taux/stock actuels sont **de la démo** — ne pas les présenter comme des prix réels.
- Le bot tourne en production : chaque push déclenche un redéploiement (~2-4 min) et une
  interruption de service de quelques secondes. Prévenir avant de pousser.
- En cas d'erreur « interaction a échoué » chez un client : regarder les logs Render d'abord,
  vérifier que le déploiement est bien terminé (Live), puis reproduire localement.
