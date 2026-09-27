# Le Comptoir des Kamas 🏪 — bot Discord « tickets » pour un marché de kamas Dofus

Bot Discord *(**Commis**)* — discord.js v14, **aucune dépendance de build** — qui reproduit le
fonctionnement d'un
serveur de vente / achat / échange de kamas : panneaux de marché avec boutons, tickets privés créés
automatiquement, taux et stocks gérés par commandes, prise en charge, étapes de suivi, transcription
HTML et avis clients.

Tout est en un seul projet, sans site web :

```
kamas-market-bot/
├── config.js                 ← marque, serveurs Dofus, devises, moyens de paiement, plan du serveur
├── render.yaml               ← blueprint d'hébergement gratuit (Render)
├── DEPLOY.md                 ← guide de déploiement pas à pas
├── data/                     ← taux, stock, tickets, avis (JSON, éditable à la main)
├── src/
│   ├── index.js              ← point d'entrée du bot
│   ├── health.js             ← serveur HTTP /healthz (health check + anti-veille)
│   ├── persist.js            ← miroir d'état : sauvegarde data/ dans Discord et le restaure au boot
│   ├── deploy-commands.js    ← enregistre les slash commands
│   ├── interactions.js       ← routeur boutons / menus / modales
│   ├── commands.js           ← /panel /ticket /rate /stock /avis /setup /help
│   ├── tickets.js            ← cycle de vie d'un ticket
│   ├── components.js         ← boutons, menus, modales
│   ├── embeds.js             ← tous les embeds
│   ├── market.js             ← taux, stock, calcul des prix
│   ├── transcript.js         ← transcription HTML
│   ├── store.js              ← lecture/écriture JSON atomique
│   ├── setup.js              ← création du plan du serveur
│   ├── preflight.js          ← diagnostic avant déploiement (permissions, intents, inventaire)
│   ├── guild-utils.js        ← résolution rôle staff / salons / catégories
│   └── scripts/setup-server.js
└── test/                     ← tests (npm test)
```

📘 **Guide de déploiement complet, écran par écran : [`DEPLOY.md`](./DEPLOY.md).**

### Ce que le bot crée tout seul

| | Nombre |
| --- | --- |
| Rôles | 36 (56 avec `roles_paiement`) |
| Catégories | 12 (7 du plan + 5 colonnes de suivi des tickets) |
| Salons texte + vocal | 37 |
| Panneaux publiés | 5 (achat, vente, échange, support, remboursement) |

---

## ⚠️ À lire avant de commencer

**Ce projet a besoin d'un token de BOT, pas d'un token de compte utilisateur.**
Automatiser un token de compte personnel (= « self-bot ») est interdit par les conditions
d'utilisation de Discord et conduit très souvent au bannissement définitif du compte. Va sur
<https://discord.com/developers/applications> → *New Application* → onglet **Bot** → *Reset Token*.

Ne commite jamais ton `.env` : le `.gitignore` du projet l'exclut déjà.

---

## 1. Créer l'application Discord

1. **Developer Portal → New Application** — donne-lui le nom du bot (`Commis`, la valeur de
   `BRAND_BOT_NAME`). Les pseudos de bots sont uniques à l'échelle de Discord : si `Commis` est pris,
   mets un suffixe (`Commis-Kamas`) et reporte-le dans `.env`.
2. Onglet **Bot** :
   - *Reset Token* → copie la valeur dans `DISCORD_TOKEN`.
   - Active **Privileged Gateway Intents → SERVER MEMBERS INTENT** (nécessaire pour gérer les
     accès aux tickets). Sans ça, `/ticket add` échouera.
3. Onglet **OAuth2 → URL Generator** :
   - Scopes : `bot`, `applications.commands`
   - Permissions : *View Channels, Send Messages, Manage Messages, Embed Links, Attach Files,
     Read Message History, Manage Channels, Manage Roles*
   - URL prête à l'emploi (remplace `TON_APP_ID`) :
     `https://discord.com/api/oauth2/authorize?client_id=TON_APP_ID&permissions=268561424&scope=bot%20applications.commands`
4. Invite le bot sur ton serveur. **Le rôle du bot doit être placé au-dessus du rôle Staff** dans la
   hiérarchie des rôles, sinon il ne pourra ni créer les salons ni poser les permissions.

## 2. Installer

```sh
cd kamas-market-bot
npm install
cp .env.example .env      # renseigne DISCORD_TOKEN et GUILD_ID
npm run deploy            # enregistre les slash commands (instantané si GUILD_ID est rempli)
```

Pour récupérer ton `GUILD_ID` : paramètres Discord → *Avancés* → **Mode développeur**, puis clic
droit sur le serveur → **Copier l'ID du serveur**.

## 3. Construire le serveur (une seule commande)

```sh
npm run check             # diagnostic : permissions, hiérarchie des rôles, structure manquante
npm run setup:dry         # aperçu : liste tout ce qui serait créé, sans rien toucher
npm run setup             # crée les rôles, catégories, salons, puis publie les panneaux
```

Le diagnostic s'arrête sur tout ce qui ferait échouer le setup (permission manquante, rôle du bot
sous `Staff`, intent membres désactivé). `npm run setup:full` ajoute un rôle par moyen de paiement,
`npm run setup -- --skip-roles` ne crée que les salons, `--force` passe outre les erreurs.

Équivalent en jeu : `/check` puis `/setup` (réservé aux administrateurs / au staff). Le setup est
**idempotent** : relance-le autant de fois que nécessaire, il ne crée que ce qui manque.

À la fin, le script affiche les IDs à coller dans `.env` :

```
STAFF_ROLE_ID=…
MANAGER_ROLE_ID=…
LOG_CHANNEL_ID=…
TRANSCRIPT_CHANNEL_ID=…
```

Ces valeurs sont optionnelles (le bot retombe sur une recherche par nom) mais évitent toute ambiguïté
si tu renommes les salons.

## 4. Lancer

```sh
npm start
```

Le bot affiche « Connecté en tant que … », définit son statut et publie les panneaux si tu ne les as
pas déjà via `/setup`.

## 5. Héberger 24/7

Un bot Discord doit tourner en permanence. Deux options, détaillées dans [`DEPLOY.md`](./DEPLOY.md) :

| Option | Coût | Remarque |
| --- | --- | --- |
| **Render** (plan gratuit) | 0 € | Viable 24/7 avec un ping externe toutes les 10 min sur `/healthz`. Le disque étant effacé à chaque redémarrage, l'état du bot est sauvegardé dans Discord (`src/persist.js`). |
| VPS + `pm2` | ~2 €/mois | Le plus simple et le plus prévisible : pas de mise en veille, pas de limite d'heures. |

Le bot n'a besoin d'aucun port ouvert : le serveur HTTP de `src/health.js` ne sert qu'au health check
et au ping anti-veille.

---

## Le parcours d'un ticket

1. Le client clique sur le bouton d'un panneau (`💎 Acheter des kamas`, `💸 Vendre des kamas`,
   `♻️ Échanger des kamas`, `🎟️ Support`, `↩️ Remboursement`).
2. Pour les types *marché*, il choisit son **serveur Dofus** (24 choix) puis son **moyen de paiement**
   (21 choix), puis remplit une **modale** : quantité en millions, devise, pseudo du personnage,
   précisions.
3. Le bot valide (quantité, devise), calcule un total estimé à partir des taux enregistrés et
   **crée un salon privé** nommé `achat-00001`, `vente-00042`, `echange-00007`… dans la catégorie
   `🎟️ | Nouveaux tickets`.
4. Le salon est visible uniquement par le client, le staff et le bot. Le staff est mentionné.
5. Boutons dans le ticket :
   - **🎯 Prendre en charge** — enregistre qui traite le ticket et grise le bouton
   - **🗂️ Étape** — déplace le salon vers `⏳ En préparation`, `💳 En cours de paiement`, `✅ Terminé`, `🗄️ Archivés`
   - **👥 Accès** — ajoute / retire des membres du ticket
   - **📄 Transcript** — génère et envoie la transcription HTML tout de suite
   - **🔒 Fermer** — demande le motif, puis transcription → salon `📄・transcripts`, DM au client,
     suppression du salon. Si le motif est « commande livrée », le client reçoit une invitation à
     laisser un avis.

Le type *support* / *remboursement* saute les étapes serveur + paiement et ouvre directement une
modale (sujet, détails, référence de commande).

---

## Commandes

| Commande | Qui | Effet |
| --- | --- | --- |
| `/panel <type>` | Staff | Publie un panneau de tickets dans le salon courant |
| `/ticket close [motif]` | Client ou staff | Ferme le ticket courant |
| `/ticket claim` | Staff | Prend en charge |
| `/ticket add <membre>` / `/ticket remove <membre>` | Staff | Gère les accès |
| `/ticket rename <nom>` | Staff | Renomme le salon |
| `/ticket move <étape>` | Staff | Change l'étape du ticket |
| `/ticket transcript` | Client ou staff | Génère la transcription |
| `/ticket stats` | Staff | Nombre de tickets ouverts / fermés, par type |
| `/rate voir` | Tous | Affiche tous les taux |
| `/rate set <devise> <sens> <prix>` | Staff | Définit un taux (achat client / vente client / échange) |
| `/stock voir` | Tous | Affiche le stock par serveur Dofus |
| `/stock set <serveur> <millions> [statut]` | Staff | Met à jour le stock (statut auto : `open` &gt; 100 M, `low`, `full` à 0) |
| `/avis` | Tous | Publie un avis dans le salon `⭐・avis-clients` |
| `/check [roles_paiement]` | Staff | Diagnostic : permissions du bot, hiérarchie, structure manquante |
| `/setup [seulement_salons] [roles_paiement]` | Admin | Construit rôles / catégories / salons / panneaux |
| `/help` | Tous | Aide |

### Sens des taux

| Sens | Signification |
| --- | --- |
| `buy` | Le client achète des kamas → **prix payé par le client** par million |
| `sell` | Le client vend ses kamas → **prix que tu lui verses** par million |
| `exchange` | Transfert entre deux serveurs Dofus |

Exemple :

```
/rate set EUR buy 1.35
/rate set MAD sell 10.2
/stock set drac 250 open
```

---

## Personnaliser

Presque tout vit dans **`config.js`**, surchargeable par `.env` :

| Réglage | Où |
| --- | --- |
| Nom / emoji / site de la marque | `.env` (`BRAND_NAME`, `BRAND_EMOJI`, `BRAND_BOT_NAME`, `BRAND_WEBSITE`) |
| Serveurs Dofus proposés | `DOFUS_SERVERS` dans `config.js` (ajoute aussi le rôle correspondant dans `ROLES`) |
| Devises | `CURRENCIES` |
| Moyens de paiement | `PAYMENT_METHODS` |
| Catégories, salons, sujets, panneaux | `LAYOUT` |
| Étapes de suivi | `TICKET_STAGES` |
| Rôles créés par `/setup` | `ROLES` |
| Fermeture : supprimer ou archiver | `TICKET_CLOSE_ACTION=delete` / `archive` |
| Tickets ouverts max par membre | `MAX_OPEN_TICKETS_PER_USER` |
| Délai entre créations lors du `/setup` | `SETUP_STEP_DELAY_MS` |
| Miroir d'état (sauvegarde dans Discord) | `.env` (`STATE_MIRROR`, `STATE_IMPORT`, `STATE_CHANNEL_ID`) |
| Port du serveur HTTP / health check | `.env` (`PORT`, fourni par l'hébergeur) |
| Emplacement de `data/` | `.env` (`DATA_DIR`, pour un disque monté) |

Taux et stock sont modifiables à chaud par les commandes, ou directement dans
`data/market.json` :

```json
{
  "rates": { "EUR": { "buy": 1.35, "sell": 0.95, "exchange": 0.6 } },
  "stock": { "drac": { "millions": 250, "status": "open" } }
}
```

`data/tickets.json`, `data/reviews.json` et `data/panels.json` sont l'état d'exécution
(non versionnés).

---

## Tests

```sh
npm test
```

11 tests couvrant le calcul des prix, le parseur de quantités, la validité des slash commands et des
composants (limites Discord : 25 options, 5 boutons, 5 lignes de modale), les embeds, la transcription
et le plan de serveur en mode *dry-run*.

---

## Déploiement

Le bot a besoin d'un process qui tourne 24/7. Sur un petit VPS :

```sh
npm ci --omit=dev
npm start
```

Garde-le en vie avec `pm2 start src/index.js --name kamamarket` ou une unité `systemd`
(`Restart=always`). Les données vivent dans `data/` : pense à les sauvegarder, et à ne pas faire
tourner deux instances du bot en même temps sur le même dossier.

## Ce que ce bot ne fait pas (volontairement)

- Aucun site web, aucune page publique (tu as dit ne pas en vouloir).
- **Aucun paiement automatique** : les transactions se concluent en ticket avec le staff. Brancher un
  vrai processeur de paiement demanderait un site et une API, plus la conformité associée.
- Pas de giveaway automatisé (`daily-gifts`, `daily-winners`) : ces salons sont créés, mais
  l'animation reste manuelle.
- Pas de système de points VIP automatique : le rôle `points-vip` existe, le calcul reste à faire.
