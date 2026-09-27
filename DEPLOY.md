# 🚀 Déploiement pas à pas — Le Comptoir des Kamas

Guide complet, de zéro jusqu'à un serveur Discord fonctionnel.
Compte 20 à 30 minutes la première fois.

> **Ce que le bot construit tout seul** (commande `/setup` ou `npm run setup`) :
> **36 rôles** (57 avec l'option `roles_paiement`), **12 catégories**
> (7 catégories + 5 colonnes de suivi de tickets) et **37 salons** — plus les **5 panneaux**
> de tickets publiés automatiquement avec leurs boutons.

---

## Étape 0 — Ce qu'il te faut

| Élément | Détail |
| --- | --- |
| Node.js ≥ 18.17 | `node -v` dans un terminal (ici : v26 ✅) |
| Un compte Discord | Avec la permission **Gérer le serveur** sur le serveur cible |
| Le serveur cible | Vide ou déjà existant, peu importe : le bot n'écrase rien |

---

## Étape 1 — Créer l'application et le bot

1. Va sur <https://discord.com/developers/applications> → **New Application**.
2. Nom : `Commis` (ou un suffixe si le pseudo est pris, voir étape 4).
3. Onglet **General Information** → *App Icon* : mets ton logo (🏪 en attendant).
4. Onglet **Bot** → *Reset Token* → **Copy**. ⚠️ C'est la seule fois où le token est affiché.
   > Le token est un **secret** : ne le partage jamais, ne le colle pas dans un chat, ne le commit pas.
5. Toujours dans **Bot**, descends à **Privileged Gateway Intents** et active
   **SERVER MEMBERS INTENT**. Sans ça, `/ticket add`, `/ticket remove` et les permissions de
   tickets échouent. (Le bot ne nécessite *pas* MESSAGE CONTENT INTENT.)

---

## Étape 2 — Configurer le projet

```sh
cd kamas-market-bot
npm install
cp .env.example .env
```

Ouvre `.env` et remplis les deux valeurs obligatoires :

```ini
DISCORD_TOKEN=le_token_copié_à_l_étape_1
GUILD_ID=1025854496225628190        # ← l'ID de TON serveur
```

**Récupérer l'ID du serveur :** Discord → *Paramètres utilisateur* → *Avancés* → active
**Mode développeur**, puis clic droit sur le serveur → **Copier l'ID du serveur**.
Le token doit être collé **sans espace ni retour à la ligne**.

> Un token de **compte utilisateur** (self-bot) ne fonctionne pas ici : les comptes utilisateur n'ont
> pas de slash commands et automatiser un compte personnel est interdit par les CGU de Discord.

---

## Étape 3 — Inviter le bot

1. Onglet **OAuth2 → URL Generator**.
2. Scopes : `bot` **et** `applications.commands`.
3. Permissions : *View Channels, Send Messages, Manage Messages, Embed Links, Attach Files,
   Read Message History, Manage Channels, Manage Roles*.
4. URL prête (remplace `TON_APP_ID` par l'ID de l'application, onglet *General Information*) :

```
https://discord.com/api/oauth2/authorize?client_id=TON_APP_ID&permissions=268561424&scope=bot%20applications.commands
```

5. Ouvre l'URL, choisis ton serveur, autorise.
6. **Point critique :** dans Discord → *Paramètres du serveur* → **Rôles**, glisse le rôle du bot
   **au-dessus** du rôle `Staff` (le bot ne peut créer/modifier que les rôles placés sous le sien).
   Le rôle `Staff` n'existe pas encore : tu le créeras à l'étape 4, puis tu reviendras le positionner.

---

## Étape 4 — Tout construire (rôles + salons + panneaux)

```sh
npm run check        # 1. diagnostic : rien n'est modifié
npm run setup:dry    # 2. aperçu : liste tout ce qui serait créé
npm run setup        # 3. création réelle + publication des 5 panneaux
```

Options utiles :

| Commande | Effet |
| --- | --- |
| `npm run setup:full` | Idem + un rôle par moyen de paiement (PayPal, Wafacash, USDT…) — 56 rôles |
| `npm run setup -- --skip-roles` | Salons seulement (si tu gères les rôles à la main) |
| `npm run setup -- --force` | Continue même si le diagnostic remonte des erreurs |

Équivalent depuis Discord : `/check` puis `/setup` (réservés au staff/admin, avec les mêmes options).

Le script est **idempotent** : relance-le autant de fois que tu veux, il ne crée que ce qui manque.
À la fin, il affiche les IDs à recopier dans `.env` (facultatif mais recommandé — le bot cessera de
chercher les rôles et salons par leur nom) :

```ini
STAFF_ROLE_ID=…
MANAGER_ROLE_ID=…
LOG_CHANNEL_ID=…
TRANSCRIPT_CHANNEL_ID=…
```

Ce qui doit apparaître dans le serveur :

```
🏪 | Le Comptoir            📜・règles, 🔔・annonces, 🔧・updates, ❓・faq, 🌟・points-vip, 📊・sondage, 🤝・partenaires
🛒 | Marché                 💎・acheter-kamas, 💸・vendre-kamas, ♻️・échanger-kamas, 📈・taux-du-jour, ⭐・avis-clients
🧰 | Aide & Support         🎟️・ticket-support, 📞・contact-support, ↩️・remboursements
🌍 | Communauté             💬・français, 💬・english, 💬・español, 💬・العربية
🎉 | Événements & Cadeaux   💸・promotions, 🤝・parrainage, 🔥・hot-offres, 🎁・daily-gifts, 🏆・daily-winners, 🎉・big-win
🔊 | Salons Vocaux          discussion-générale, gaming-room, business-talk, support-vocal, VOC 1, VOC 2
🔒 | Staff                  📦・commandes, 💳・paiements, 📝・détails-ventes, ⚙️・gestion, 🤖・logs, 📄・transcripts
```

---

## Étape 5 — Enregistrer les slash commands

```sh
npm run deploy
```

Attendu : `[deploy] 8 commande(s) enregistrée(s) sur le serveur …`.
Avec `GUILD_ID` renseigné, elles apparaissent **immédiatement**. Sans `GUILD_ID`, elles sont
enregistrées globalement et peuvent mettre jusqu'à **1 heure** à apparaître.

---

## Étape 6 — Démarrer le bot

```sh
npm start
```

Attendu :

```
[bot] Connecté en tant que Commis#0000
[bot] 1 serveur(s) • Le Comptoir des Kamas
```

Laisse ce terminal ouvert. Va dans Discord, tape `/help` : si le menu s'affiche, le bot est opérationnel.

---

## Étape 7 — Vérifications finales (10 minutes)

1. **Réglages du marché** (staff) :
   ```
   /rate voir
   /rate set devise:EUR sens:achat prix:1.35
   /rate set devise:MAD sens:achat prix:14
   /stock set serveur:Draconiros millions:500 dispo:Disponible
   ```
2. **Hiérarchie des rôles** : re-vérifie que le rôle du bot est bien au-dessus de `Staff`.
3. **Test de bout en bout** (idéalement depuis un second compte) :
   - clic sur le bouton `💎 Acheter des kamas` dans `💎・acheter-kamas` ;
   - choix du serveur Dofus → choix du moyen de paiement → formulaire ;
   - le salon privé `achat-<numéro>` doit apparaître dans `🎟️ | Nouveaux tickets`, avec le récapitulatif ;
   - le staff clique 🎯 *Prendre en charge*, puis 🗂️ *Étape* → *En cours de paiement* : le salon change de colonne ;
   - 🔒 *Fermer* → ✅ *Commande livrée* : le client reçoit un MP d'avis, la transcription part dans
     `📄・transcripts`, puis le salon est supprimé après 5 secondes.
4. **Avis** : `/avis` → le message doit atterrir dans `⭐・avis-clients`.
5. **Redémarrage** : coupe `npm start` puis relance — aucun doublon de salon ni de rôle ne doit être créé.

---

## ☁️ Héberger 24/7 gratuitement sur Render

**Réponse courte : oui, c'est possible, mais avec trois conditions.** Render n'exécute gratuitement que
des *services web* (pas de worker), et leur plan gratuit impose ceci :

| Limite du plan gratuit | Conséquence pour le bot |
| --- | --- |
| **Mise en veille après 15 min sans trafic entrant** | Le bot se déconnecte. Il faut le réveiller avec un cron externe (voir plus bas). |
| **750 heures d'instance par mois** | 24/7 = 744 h : ça passe, mais il ne reste ~6 h : **un seul** service gratuit peut tourner en continu. |
| **Disque effacé à chaque déploiement / redémarrage / réveil** | `data/*.json` (taux, stock, tickets, avis) seraient perdus → c'est réglé par le **miroir d'état** ci-dessous. |
| Pas de disque persistant, pas de shell SSH | On ne peut pas lancer `npm run setup` depuis Render : lance-le depuis ton Mac. |
| Postgres gratuit : **expire après 30 jours**. Key Value gratuit : **en mémoire seule** | Aucune des deux bases gratuites ne convient à un vrai stockage. |

### Le miroir d'état : pourquoi tes données survivent

Le bot publie un instantané JSON de `data/` en pièce jointe dans le salon privé **`⚙️・gestion`**, et le
réimporte au démarrage (`src/persist.js`). Discord conserve les messages gratuitement et pour toujours :
c'est donc Discord qui fait office de base de données.

- chaque écriture (ticket, avis, taux, stock, panneau) programme une sauvegarde 8 secondes plus tard ;
- au boot, le bot relit la dernière sauvegarde et restaure l'état ;
- `SIGTERM` (déploiement Render) déclenche une sauvegarde avant l'arrêt ;
- `npm start` en local ne change rien : si ton `data/` local est déjà rempli, il n'est pas écrasé
  (`STATE_IMPORT=when-empty`). Sur Render, `render.yaml` met `STATE_IMPORT=always`.

> Ne supprime jamais le message « 💾 Sauvegarde automatique » dans `⚙️・gestion`.

### Pas à pas

1. **Pousse le dépôt sur GitHub** (voir la fin de ce fichier).
2. <https://dashboard.render.com> → **New → Blueprint** → choisis le dépôt `Commis`.
   Render lit `render.yaml` et propose le service web `commis` (plan *Free*).
3. Renseigne les variables demandées (`sync: false`) : **`DISCORD_TOKEN`** et **`GUILD_ID`**.
   ⚠️ Ne mets **jamais** le token dans `render.yaml` ni dans le dépôt : Discord révoque
automatiquement les tokens détectés sur GitHub, et n'importe qui pourrait piloter ton bot.
4. **Apply** → attends la fin du build (2-3 min). Les logs doivent afficher
   `[bot] Connecté en tant que Commis#8144` puis `[health] en écoute sur 0.0.0.0:10000`.
5. Ouvre `https://<ton-service>.onrender.com/healthz` : tu dois voir `ok`.
6. **Empêche la mise en veille** : crée un cron gratuit sur <https://cron-job.org> (ou un moniteur
   UptimeRobot, gratuit, intervalle 5 min) qui appelle cette URL toutes les **10 minutes** :

   ```
   https://<ton-service>.onrender.com/healthz
   ```

   C'est ce ping qui maintient les 750 h consommées de façon continue : sans lui, le bot s'endort au
   bout de 15 minutes d'inactivité et ne se réveille qu'à la prochaine visite (≈ 1 min de latence).
7. **Construis le serveur** depuis ton Mac (Render n'a pas de shell) :

   ```sh
   npm run check
   npm run setup
   npm run deploy
   ```

   Ensuite tout se pilote depuis Discord (`/check`, `/panel`, `/rate`, `/ticket`…).
8. **Vérifie la reprise** : dans Render, clique **Restart**. Le disque est vierge au redémarrage,
   mais le bot doit réafficher tes taux (`/rate voir`) grâce au miroir d'état.

### Bon à savoir

- Un redéploiement à chaque `git push` sur `main` : pratique, mais chaque redémarrage repasse par le
  miroir d'état (quelques secondes).
- Les fichiers `data/*.json` ne sont **pas** dans le dépôt (`.gitignore`) : c'est le miroir qui fait foi.
- Si tu changes d'hébergeur, il suffit de refaire `npm run check` puis `npm run setup` : le bot est
  idempotent.

---

## Autres options d'hébergement

Sur un Mac, le plus simple est [pm2](https://pm2.keymetrics.io/) :

```sh
npm install -g pm2
pm2 start npm --name commis -- start
pm2 save
pm2 logs commis
```

Sans pm2, en arrière-plan avec un fichier de log :

```sh
nohup npm start > bot.log 2>&1 &
tail -f bot.log
```

Pour un vrai hébergement, n'importe quel VPS (2 €/mois) suffit : Node 18+, `npm install`, `.env`,
puis `pm2 start`. Le bot n'a besoin d'aucun port ouvert.

---

## Dépannage

| Symptôme | Cause | Solution |
| --- | --- | --- |
| `An invalid token was provided` | token tronqué, espace en trop, ou token de compte utilisateur | re-*Reset Token* dans le portail et re-colle dans `.env` |
| `Used disallowed intents` / `[setup] Impossible de lire les membres` | SERVER MEMBERS INTENT désactivé côté portail | Developer Portal → Bot → Privileged Gateway Intents |
| `Missing Permissions` / `Missing Access` pendant `npm run setup` | permissions manquantes ou rôle du bot sous `Staff` | `npm run check`, puis glisse le rôle du bot plus haut |
| Les commandes n'apparaissent pas | `npm run deploy` oublié, ou enregistrement global | lance `npm run deploy` avec `GUILD_ID` rempli |
| « L'interaction a échoué » au clic sur un bouton | le bot est éteint ou a planté | regarde le terminal / `pm2 logs commis` |
| `/ticket add` refuse | intent membres désactivé | même correctif que la 2ᵉ ligne |
| Pas de transcription dans les tickets fermés | `TRANSCRIPT_CHANNEL_ID` vide et salon `📄・transcripts` supprimé | recrée le salon ou remplis la variable dans `.env` |
| Panneau supprimé par erreur | — | dans le bon salon : `/panel type:Achat de kamas` |
| Salons créés en double | tu as relancé le setup après avoir **renommé** une catégorie | le bot se repère par nom : garde les noms du plan, ou supprime le doublon |

---

## Publier le bot sur GitHub

Render (et la plupart des hébergeurs) déploient depuis un dépôt Git. Le bot doit donc être à la
**racine** du dépôt :

```sh
cd ~/Documents                                   # ou n'importe quel dossier de travail
git clone git@github.com:TON_COMPTE/Commis.git   # récupère le dépôt (vide au départ)
cp -R chemin/vers/kamas-market-bot/. Commis/     # copie le bot à la racine du dépôt
cd Commis
rm -rf node_modules .env                         # jamais dans le dépôt

git add -A
git status --short                               # vérifie qu'aucun .env n'apparaît
git commit -m "Bot Commis — tickets, taux et stocks pour un marché de kamas Dofus"
git push -u origin main
```

> ⚠️ Vérifie toujours que **`.env` n'est pas dans `git status`**. Un token poussé sur GitHub est
> analysé automatiquement par Discord et **révoqué dans la minute** — il faut alors en régénérer un.

---

## Récapitulatif express

```sh
cd kamas-market-bot
npm install
cp .env.example .env      # DISCORD_TOKEN + GUILD_ID
npm run check             # tout doit être vert
npm run setup             # rôles + salons + panneaux
npm run deploy            # slash commands
npm start                 # le bot tourne
```
