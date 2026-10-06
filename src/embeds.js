import { EmbedBuilder } from "discord.js";

import {
    ANTI_SCAM_LINE,
    BRAND,
    COMPETITORS,
    CURRENCIES,
    GUARANTEES,
    PROCEDURES,
    PAYMENT_METHODS,
    SETTINGS,
    TICKET_TYPES,
    currencyInfo,
    paymentByCode,
    DOFUS_SERVERS,
    serverByCode,
    serverLabel,
} from "../config.js";
import {
    competitorEdge,
    competitorPrices,
    effectiveRate,
    eurPrice,
    exchangeFee,
    exchangeQuote,
    feedEnabled,
    feedFactors,
    feedState,
    formatMillions,
    formatMoney,
    market,
    stockBadge,
    stockFor,
    MAX_ADJUST,
    MAX_EXCHANGE_FEE,
    MIN_MARGIN,
    rateFor,
    rateLines,
    serverAdjustment,
    serverRateFields,
    stockLines,
    stockSummary,
} from "./market.js";

const timestamp = () => Math.floor(Date.now() / 1000);

const kindForType = (typeId) => (typeId === "achat" ? "buy" : typeId === "vente" ? "sell" : "exchange");

/** "🕐 Prix mis à jour il y a 5 minutes" — Discord renders the relative time live. */
function pricesUpdatedLine() {
    const at = Date.parse(market().updatedAt ?? "");
    return Number.isFinite(at) ? `🕐 Prix mis à jour <t:${Math.floor(at / 1000)}:R>` : null;
}

export const baseEmbed = (options = {}) =>
    new EmbedBuilder()
        .setColor(options.color ?? BRAND.colors.brand)
        .setTimestamp()
        .setFooter({ text: options.footer ?? BRAND.footer });

export const successEmbed = (description, title = "✅ Terminé") =>
    baseEmbed({ color: BRAND.colors.success }).setTitle(title).setDescription(description);

export const errorEmbed = (description, title = "❌ Erreur") =>
    baseEmbed({ color: BRAND.colors.danger }).setTitle(title).setDescription(description);

export const infoEmbed = (description, title) =>
    baseEmbed({ color: BRAND.colors.info }).setTitle(title ?? null).setDescription(description);

const isMarketType = (typeId) => typeId === "achat" || typeId === "vente" || typeId === "echange";

/** The big embed that sits behind each market panel button. */
export function panelEmbed(typeId) {
    const type = TICKET_TYPES[typeId];
    const embed = baseEmbed({ color: type.color })
        .setTitle(`${type.emoji}  ${BRAND.name} • ${type.label}`)
        .setDescription(
            [
                type.blurb,
                typeId === "echange" ? exchangeRuleLine() : null,
                "",
                `Clique sur le bouton ci-dessous 👇`,
                isMarketType(typeId) ? pricesUpdatedLine() : null,
            ]
                .filter((line) => line !== null)
                .join("\n"),
        );

    if (isMarketType(typeId)) {
        embed.addFields(...serverRateFields(kindForType(typeId)));
    } else {
        embed.addFields({
            name: "📋 Comment ça marche",
            value: [
                "1️⃣ Clique sur le bouton ci-dessous",
                "2️⃣ Décris ton besoin dans le formulaire",
                `3️⃣ Un membre du ${SETTINGS.staffRoleName} ouvre ton salon privé`,
                "4️⃣ On règle ça ensemble, sans stress ⚡",
            ].join("\n"),
            inline: false,
        });
    }

    if (typeId !== "echange") {
        embed.addFields({
            name: "💳 Moyens de paiement acceptés",
            value: PAYMENT_METHODS.map((m) => `${m.emoji} ${m.label}`).join(" • "),
            inline: false,
        });
    }
    if (isMarketType(typeId)) embed.addFields({ name: "🛡️ Sécurité", value: ANTI_SCAM_LINE, inline: false });

    return embed;
}

/* ───────────────────────── Trust buttons (🛡️ 📦 💳) ───────────────────────── */

export function guaranteeEmbed() {
    return baseEmbed({ color: BRAND.colors.success })
        .setTitle(`🛡️ Nos garanties • ${BRAND.name}`)
        .setDescription([...GUARANTEES, "", ANTI_SCAM_LINE].join("\n"));
}

export function procedureEmbed(typeId) {
    const type = TICKET_TYPES[typeId];
    const steps = PROCEDURES[typeId] ?? [];
    const numbers = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣"];
    return baseEmbed({ color: type?.color })
        .setTitle(`📦 Procédure • ${type ? `${type.emoji} ${type.label}` : "Commande"}`)
        .setDescription(
            [
                ...steps.map((step, index) => `${numbers[index] ?? "•"} ${step}`),
                "",
                "🕐 Pas de stock sur ton serveur ? Ouvre ton ticket quand même : on lance la procédure et on livre dès que c'est prêt.",
            ].join("\n"),
        );
}

export function paymentMethodsEmbed() {
    return baseEmbed({ color: BRAND.colors.info })
        .setTitle("💳 Moyens de paiement")
        .setDescription(
            [
                PAYMENT_METHODS.map((m) => `${m.emoji} ${m.label}`).join("\n"),
                "",
                `Devises : ${CURRENCIES.map((c) => `**${c.label}** (${c.symbol})`).join(" • ")}`,
                "Tu choisis ton moyen de paiement en ouvrant ton ticket ; le staff te donne les instructions **dans le ticket uniquement**.",
            ].join("\n"),
        );
}

/** How an exchange is computed, in one line for the panel and the live board. */
function exchangeRuleLine() {
    const fee = exchangeFee().toLocaleString("fr-FR");
    return (
        "💱 Tu choisis le serveur où tu donnes, celui où tu reçois, puis la quantité : " +
        `on convertit selon la valeur des kamas sur chaque serveur, **commission ${fee} %** incluse.\n` +
        "🧮 **Simuler mon échange** (salon ♻️・échanger-kamas) donne le montant exact reçu."
    );
}

const formatRatio = (value) => value.toLocaleString("fr-FR", { maximumFractionDigits: 3 });

/** Shown when we lack stock: the order still goes ahead, delivery follows. */
export const onOrderLine = (serverName) =>
    `🕐 **Sur commande sur ${serverName}** : ouvre ton ticket quand même, on lance la procédure et on livre dès que le stock est prêt.`;

/** 🧮 simulator answer: what `given` M on the source turns into on the destination. */
export function exchangeSimEmbed(fromCode, toCode, given) {
    const name = (code) => serverLabel(serverByCode(code)) || code;
    const result = exchangeQuote(fromCode, toCode, given);
    const stock = stockFor(toCode);
    const lines = [`📤 Tu donnes : **${formatMillions(given)}** sur ${name(fromCode)}`];
    if (result) {
        lines.push(
            `📥 Tu reçois : **${formatMillions(result.received)}** sur ${name(toCode)}`,
            `_Commission ${result.fee.toLocaleString("fr-FR")} % incluse._`,
        );
        if (stock.status === "full" || result.received > stock.millions) lines.push("", onOrderLine(name(toCode)));
    } else {
        lines.push(`📥 Sur ${name(toCode)} : **à confirmer avec le staff**.`);
    }
    lines.push("", "Simulation indicative, sans engagement. Ça te va ? Ouvre ton ticket 👇");
    return baseEmbed({ color: TICKET_TYPES.echange.color }).setTitle("🧮 Simulation d'échange").setDescription(lines.join("\n"));
}

/** Ephemeral recap once the customer picked both servers of an exchange. */
export function exchangeRecapEmbed(fromCode, toCode) {
    const type = TICKET_TYPES.echange;
    const name = (code) => serverLabel(serverByCode(code)) || code;
    const example = exchangeQuote(fromCode, toCode, 1000);
    const stock = stockFor(toCode);
    const stockText = stockBadge(stock);

    const lines = [
        `📤 **Tu donnes sur :** ${name(fromCode)}`,
        `📥 **Tu reçois sur :** ${name(toCode)}`,
        `📦 **Notre stock sur ${name(toCode)} :** ${stockText}`,
        "",
    ];
    if (example) {
        lines.push(
            `💱 **Taux : 1 M donné = ${formatRatio(example.ratio)} M reçu** (commission ${example.fee.toLocaleString("fr-FR")} % incluse)`,
            `Exemple : **${formatMillions(1000)}** donnés → **${formatMillions(example.received)}** reçus`,
        );
    } else {
        lines.push("💱 Taux : **à confirmer avec le staff** (prix manquant sur un des serveurs).");
    }
    lines.push("", "Clique sur le bouton et indique combien tu donnes 👇");

    return baseEmbed({ color: type.color }).setTitle(`${type.emoji}  Récapitulatif de l'échange`).setDescription(lines.join("\n"));
}

export function rateEmbed() {
    const summary = stockSummary();
    return baseEmbed()
        .setTitle(`📈 ${BRAND.name} — Taux & stocks`)
        .setDescription([pricesUpdatedLine(), "", "**Taux de base**", ...rateLines()].filter((l) => l !== null).join("\n"))
        .addFields(
            ...serverRateFields("buy"),
            {
                name: "📊 Résumé",
                value: `${summary.open} serveur(s) dispo • ${summary.low} en stock limité • **${formatMillions(summary.totalMillions)}** au total\n\n_Prix d'achat client. Les panneaux « vente » et « échange » affichent les autres sens._`,
                inline: false,
            },
        );
}

const BOARD_TITLES = {
    buy: "🛒 Achat de kamas — prix par serveur",
    sell: "💸 Vente de kamas — ce qu'on te paie",
    exchange: "♻️ Échange inter-serveurs — stock par serveur",
};

/** One of the three live embeds kept up to date in 📈・taux-du-jour. */
export function boardEmbed(kind) {
    const lines = [
        pricesUpdatedLine(),
        kind === "exchange" ? exchangeRuleLine() : null,
    ].filter(
        (line) => line !== null,
    );
    const embed = baseEmbed({ color: kind === "buy" ? BRAND.colors.success : kind === "sell" ? BRAND.colors.info : BRAND.colors.brand })
        .setTitle(BOARD_TITLES[kind])
        .addFields(...serverRateFields(kind));
    return lines.length ? embed.setDescription(lines.join("\n")) : embed;
}

const percent = (value) => `${Math.round(value * 100)} %`;
const relative = (iso) => {
    const at = Date.parse(iso ?? "");
    return Number.isFinite(at) ? `<t:${Math.floor(at / 1000)}:R>` : "jamais";
};

/** `/rate auto` — state of the web price feed, one line per server. */
export function feedStatusEmbed({ running = false, intervalMin = null } = {}) {
    const feed = feedState();
    const factors = feedFactors();
    const enabled = feedEnabled();

    const eur = (value) => formatMoney(value, "EUR");
    const sideText = (code, kind) => {
        const price = eurPrice(code, kind);
        if (!price) return null;
        const others = Object.entries(competitorPrices(code, kind));
        const beaten = competitorEdge(code, kind).length;
        const verdict = !others.length ? "" : beaten === others.length ? " ✅" : beaten ? " ➖" : " ❌";
        const shops = others.map(([site, value]) => `${COMPETITORS[site] ?? site} ${eur(value)}`).join(", ");
        const adjust = serverAdjustment(code, kind);
        return [
            `${kind === "buy" ? "vend" : "paie"} **${eur(price.eur)}**${verdict}`,
            shops ? ` (${shops})` : "",
            adjust ? ` 🎚️${adjust > 0 ? "+" : ""}${adjust} %` : "",
            price.manual ? " 📌" : "",
            price.capped ? " 🛡️" : "",
        ].join("");
    };

    const lines = DOFUS_SERVERS.filter((server) => server.game).map((server) => {
        if (!feed.reference?.[server.code] && !feed.sellReference?.[server.code]) {
            return `⚪ **${serverLabel(server)}** · pas de prix web`;
        }
        const pending = feed.pending?.[server.code] ?? feed.sellPending?.[server.code];
        return [
            `**${serverLabel(server)}**`,
            sideText(server.code, "buy"),
            sideText(server.code, "sell"),
            pending ? `⚠️ saut à ${eur(pending)} en attente` : null,
        ]
            .filter(Boolean)
            .join(" · ");
    });

    const fields = [];
    let chunk = "";
    for (const line of lines) {
        if (chunk && chunk.length + line.length + 1 > 1024) {
            fields.push(chunk);
            chunk = "";
        }
        chunk = chunk ? `${chunk}\n${line}` : line;
    }
    if (chunk) fields.push(chunk);

    return baseEmbed({ color: enabled ? BRAND.colors.success : BRAND.colors.neutral })
        .setTitle("🌐 Prix automatiques (web)")
        .setDescription(
            [
                `État : **${enabled ? "actif" : "en pause"}**${running ? "" : " · _relevé automatique désactivé (PRICE_FEED=off)_"}`,
                intervalMin ? `Relevé toutes les **${intervalMin} min** : kamasv.com + 1kamas.com (vente), leskamas.com (rachat)` : null,
                `Dernier relevé réussi : ${relative(feed.fetchedAt)} · dernière tentative : ${relative(feed.lastAttemptAt)}`,
                `On vend à **${percent(factors.buy)}** du concurrent le moins cher · on paie **${percent(factors.sell)}** ` +
                    `du meilleur rachat · échange = **${percent(factors.exchange)}** du marché`,
                feed.lastError ? `⚠️ ${feed.lastError.slice(0, 300)}` : null,
                "",
                `✅ meilleur que tous · ➖ que certains · ❌ que personne · 🎚️ ajustement (\`/rate ajuster\`) · 📌 prix manuel · 🛡️ plafonné pour garder ${percent(MIN_MARGIN)} de marge`,
                "_Priorité : prix manuel (`/rate prix`) › prix web › taux de base. `/rate prix … 0` rend la main au web._",
            ]
                .filter((line) => line !== null)
                .join("\n"),
        )
        .addFields(fields.slice(0, 5).map((value, index) => ({
            name: `🖥️ Nous vs concurrents (${index + 1}/${Math.min(fields.length, 5)})`,
            value,
            inline: false,
        })));
}

export function stockEmbed() {
    const summary = stockSummary();
    const embed = baseEmbed()
        .setTitle(`📦 ${BRAND.name} — Stock par serveur`)
        .setDescription(stockLines().join("\n"));
    embed.addFields({
        name: "📊 Résumé",
        value: `🟢 ${summary.open} • 🟡 ${summary.low} • 🕐 ${summary.full} — total **${formatMillions(summary.totalMillions)}**`,
        inline: false,
    });
    return embed;
}

/**
 * 📘・guide-du-bot (staff only): how the bot works and every command, with the
 * live settings (factors, interval, margin). Kept up to date by live-board.js.
 */
export function guideEmbeds() {
    const factors = feedFactors();
    const percent = (value) => `${Math.round(value * 1000) / 10} %`;
    const sites = Object.values(COMPETITORS).join(", ");
    const interval = SETTINGS.priceFeedIntervalMin;

    const overview = baseEmbed()
        .setTitle(`📘 Guide du bot ${BRAND.botName}`)
        .setDescription(
            [
                `**${BRAND.botName}** tient la boutique : il affiche nos prix, ouvre les tickets et suit chaque commande.`,
                "Ce salon est réservé au staff et se met à jour tout seul.",
                "",
                "**🛒 Les salons du marché**",
                "• **💎・acheter-kamas** — le client **achète** : on affiche **notre prix de vente**.",
                "• **💸・vendre-kamas** — le client **nous vend** : on affiche **ce qu'on paie**.",
                "• **♻️・échanger-kamas** — échange de kamas entre serveurs.",
                "• **📈・taux-du-jour** — tous les prix et stocks, mis à jour en direct.",
                "• **⭐・avis-clients** — avis vérifiés : un bouton est envoyé au client quand son ticket est fermé « ✅ Commande livrée ».",
                "Prix affichés en **euros** et en **dirhams** uniquement, par million (M) de kamas.",
                "",
                "**🧭 Parcours du client**",
                "1. Il clique sur le bouton du panneau (achat, vente ou échange).",
                "2. Il choisit son **serveur Dofus** → le bot montre le prix de ce serveur.",
                "3. Il choisit son **moyen de paiement**, puis voit un récapitulatif.",
                "4. Il remplit le formulaire : quantité (M), devise, personnage, notes.",
                "5. Un **ticket privé** s'ouvre avec le résumé et le total estimé.",
                "Un client ne peut avoir qu'**un seul ticket ouvert** à la fois.",
                "",
                "**🛡️ Boutons des panneaux**",
                "• **🔔 Alerte stock** — DM (une fois) quand `/stock set` remet du stock sur un serveur choisi.",
                "• **📈 Suivi prix** — DM quand un prix suivi bouge de 3 % ou plus.",
                "• **💼 Faire une offre** — arrive dans 💼・offres ; Accepter ouvre le ticket au prix proposé.",
                "• **🔒 Prix bloqué** 15 min pendant la commande, garanti 2 h dans le ticket.",
                "• **📦 Procédure**, **🛡️ Garantie**, **💳 Méthodes** — réponses toutes prêtes, visibles seulement par le client.",
                "• Les avis affichent la **référence du ticket** et le **staff** qui l'a pris en charge.",
                "",
                "**🎟️ Vie d'un ticket**",
                "Nouveau → Préparation → Paiement → Terminé → Archivé.",
                "Dans le ticket, les boutons **Prendre en charge**, **Étape**, **Accès**, **Transcript** et **Fermer** " +
                    "font la même chose que les commandes `/ticket`. À la fermeture on choisit un motif " +
                    "(livré, annulé, inactif, doublon, autre) et la transcription part dans 📄・transcripts.",
            ].join("\n"),
        );

    const prices = baseEmbed({ color: BRAND.colors.info })
        .setTitle("💶 Comment les prix sont calculés")
        .setDescription(
            [
                `**Relevé automatique** toutes les **${interval} min** sur les sites concurrents (${sites}) :`,
                "• **kamasv.com** et **1kamas.com** vendent des kamas → référence de **notre prix de vente**.",
                "• **leskamas.com** rachète des kamas → référence de **ce qu'on paie**.",
                "",
                "**Pour chaque serveur**",
                `• Prix de vente = concurrent **le moins cher** × **${percent(factors.buy)}**.`,
                `• Prix payé au vendeur = meilleur rachat concurrent × **${percent(factors.sell)}**.`,
                "• Un concurrent anormalement bas (plus de 15 % sous la moyenne) n'est pas suivi jusqu'en bas.",
                "• Un prix qui bouge de plus de 50 % d'un coup attend le relevé suivant pour être confirmé.",
                `• 🛡️ **Marge minimale** : ce qu'on paie reste au moins **${percent(MIN_MARGIN)}** sous notre prix de vente.`,
                "",
                "**Ordre de priorité**",
                "1. 📌 **Prix manuel** du manager (`/rate prix` ou `/rate tableau`) — il gagne toujours.",
                "2. 🌐 **Prix web** (relevé automatique), avec l'ajustement 🎚️ du manager (`/rate ajuster`).",
                "3. **Taux de base** × multiplicateur du serveur, si aucun prix web n'existe.",
                "",
                "**♻️ Échange inter-serveurs**",
                "Le client choisit le serveur où il donne, celui où il reçoit, puis la quantité donnée.",
                `Reçu = donné × (prix de vente source ÷ prix de vente destination) × (1 − **${exchangeFee().toLocaleString("fr-FR")} %** de commission).`,
                "",
                "**🎛️ Salon pilotage-prix** — réservé au rôle Manager : tableau de bord en direct et boutons pour régler les prix et le stock.",
                "",
                "**🙈 Côté clients**",
                "Aucune comparaison avec les concurrents n'est affichée : les clients ne voient que nos prix.",
                "Si un site est en panne ou nous bloque, les derniers prix connus restent utilisés " +
                    "et l'erreur apparaît dans `/rate auto`.",
            ].join("\n"),
        );

    const commands = baseEmbed({ color: BRAND.colors.success })
        .setTitle("⌨️ Toutes les commandes")
        .setDescription("👤 tout le monde · 🧑‍💼 staff · 👑 manager (admin ou rôle Manager)")
        .addFields(
            {
                name: "💶 Prix — `/rate`",
                value: [
                    "👤 `/rate voir` — afficher les taux actuels.",
                    "🧑‍💼 `/rate auto` — état du relevé web : dernier relevé, erreurs, nous vs concurrents par serveur.",
                    `👑 \`/rate ajuster <sens> <serveurs> <%>\` — monter ou baisser un peu les prix (±${MAX_ADJUST} %). ` +
                        "Serveurs : `tous`, ou des noms séparés par des virgules (`drac, ombre`). `0` retire l'ajustement.",
                    "👑 `/rate prix <serveur> <sens> <prix>` — fixer un prix exact en €/M. `0` = revenir au prix web.",
                    "👑 `/rate tableau` — modifier les prix de tous les serveurs d'un coup.",
                    "👑 `/rate auto actif:<oui|non>` — activer ou mettre en pause les prix web.",
                    "👑 `/rate auto achat|vente:<%>` — changer les facteurs vs concurrents (100 = pareil).",
                    `👑 \`/rate commission <%>\` — commission sur les échanges (0 à ${MAX_EXCHANGE_FEE} %).`,
                    "👑 `/rate auto actualiser:oui` — relever les prix tout de suite (~30 s).",
                    "👑 `/rate set <devise> <sens> <prix>` — taux de base (utilisé sans prix web).",
                    "👑 `/rate serveur <serveur> <multiplicateur>` — multiplicateur du taux de base (1,1 = +10 %).",
                ].join("\n"),
            },
            {
                name: "📦 Stock — `/stock`",
                value: [
                    "👤 `/stock voir` — stock par serveur.",
                    "🧑‍💼 `/stock set <serveur> <millions> <dispo|limite|sur commande>` — mettre à jour (🟢 🟡 🕐 sur les panneaux ; 🕐 = sur commande, le client peut toujours commander). Repasser un serveur de 🕐 à 🟢/🟡 prévient les clients en 🔔 alerte.",
                ].join("\n"),
            },
            {
                name: "🎟️ Tickets — `/ticket` (dans le salon du ticket)",
                value: [
                    "🧑‍💼 `/ticket claim` — prendre en charge.",
                    "🧑‍💼 `/ticket move <étape>` — changer d'étape.",
                    "🧑‍💼 `/ticket add|remove <membre>` — donner ou retirer l'accès.",
                    "🧑‍💼 `/ticket rename <nom>` — renommer le salon.",
                    "👤 `/ticket transcript` — générer la transcription.",
                    "👤 `/ticket close [motif]` — fermer (le client peut fermer son propre ticket).",
                    "🧑‍💼 `/ticket stats` — statistiques des tickets.",
                ].join("\n"),
            },
            {
                name: "🛠️ Serveur & divers",
                value: [
                    "🧑‍💼 `/panel <type>` — poster un panneau (achat, vente, échange, support, remboursement) dans ce salon.",
                    "🧑‍💼 `/setup [seulement_salons]` — créer les rôles, catégories et salons manquants.",
                    "🧑‍💼 `/check` — diagnostic : permissions, rôles, salons manquants.",
                    "👤 `/help` — aide rapide.",
                ].join("\n"),
            },
        );

    return [overview, prices, commands];
}

/** Public message posted inside a freshly created ticket. */
export function ticketIntroEmbed(ticket, user, type) {
    const embed = baseEmbed({ color: type.color, footer: `${BRAND.footer} • ticket #${ticket.number}` })
        .setTitle(`${type.emoji}  Ticket ${type.label} • #${ticket.number}`)
        .setDescription(
            [
                `Bonjour ${user}, merci pour ta demande !`,
                "",
                "Un membre du staff va te prendre en charge.",
                `🕐 Réponse moyenne : **quelques minutes**`,
                `📄 Garde bien ce salon ouvert jusqu'à la livraison.`,
                "",
                "**Résumé de ta demande**",
            ].join("\n"),
        );

    const fields = [];
    if (ticket.transferFrom && ticket.transferTo) {
        const name = (code) => serverLabel(serverByCode(code)) || code;
        fields.push(
            { name: "📤 Tu donnes", value: `**${formatMillions(ticket.millions)}** sur ${name(ticket.transferFrom)}`, inline: true },
            {
                name: "📥 Tu reçois",
                value:
                    ticket.received == null
                        ? `À confirmer sur ${name(ticket.transferTo)}`
                        : `**${formatMillions(ticket.received)}** sur ${name(ticket.transferTo)}`,
                inline: true,
            },
        );
        if (ticket.exchangeFee != null) {
            fields.push({ name: "💱 Commission", value: `${ticket.exchangeFee.toLocaleString("fr-FR")} % (incluse)`, inline: true });
        }
    } else if (ticket.serverCode) {
        fields.push({ name: "🌍 Serveur Dofus", value: serverLabel(serverByCode(ticket.serverCode)) || ticket.serverCode, inline: true });
    }
    if (ticket.millions && !ticket.transferFrom) {
        fields.push({ name: "💰 Quantité", value: formatMillions(ticket.millions), inline: true });
    }
    if (ticket.currency) {
        const rate = ticket.rate ?? effectiveRate(ticket.currency, ticket.rateKind, ticket.serverCode);
        const total = ticket.total;
        const lockedUntil = ticket.priceLockedUntil ? Date.parse(ticket.priceLockedUntil) : null;
        const method =
            ticket.paymentCode && ticket.paymentCode !== "none"
                ? `${paymentByCode(ticket.paymentCode).emoji} ${paymentByCode(ticket.paymentCode).label}`
                : ticket.type === "echange"
                  ? "Échange inter-serveurs"
                  : "À définir";
        fields.push({
            name: "💳 Paiement",
            value: [
                method,
                `Devise : **${currencyInfo(ticket.currency).code}**`,
                `Taux : **${rate === null ? "à confirmer" : `${formatMoney(rate, ticket.currency)}/M`}**`,
                `Total : **${total == null ? "à confirmer" : formatMoney(total, ticket.currency)}**`,
                lockedUntil ? `🔒 Prix garanti jusqu'à <t:${Math.floor(lockedUntil / 1000)}:t>` : null,
            ]
                .filter(Boolean)
                .join("\n"),
            inline: true,
        });
    }
    if (ticket.personnage) fields.push({ name: "🧙 Personnage", value: ticket.personnage, inline: true });
    if (ticket.subject) fields.push({ name: "📌 Sujet", value: ticket.subject, inline: false });
    if (ticket.notes) fields.push({ name: "📝 Notes", value: ticket.notes, inline: false });

    if (fields.length) embed.addFields(fields);
    embed.addFields({ name: "🧾 Ticket", value: `\`${ticket.id}\` • ouvert <t:${timestamp()}:R>`, inline: false });
    return embed;
}

export function ticketClosedEmbed({ user, closedBy, reason }) {
    return baseEmbed({ color: BRAND.colors.neutral })
        .setTitle("🔒 Ticket fermé")
        .setDescription(
            [
                `Ticket de ${user} fermé par ${closedBy}.`,
                reason ? `**Motif :** ${reason}` : null,
                "",
                "_La transcription complète a été envoyée au staff._",
            ]
                .filter(Boolean)
                .join("\n"),
        );
}

/** Sent to the customer once their order is delivered, with the review button. */
export function reviewRequestEmbed(ticket, type) {
    return baseEmbed({ color: BRAND.colors.brand })
        .setTitle("⭐ Ton avis compte")
        .setDescription(
            [
                `Merci pour ta commande chez **${BRAND.name}** ! ${type.emoji} ${type.label} • ticket #${ticket.number}`,
                "",
                "Clique sur le bouton pour noter la transaction : ton avis sera publié dans ⭐・avis-clients.",
            ].join("\n"),
        );
}

/** Delivery times up to this are shown on reviews; slower ones are left out. */
export const REVIEW_MAX_SHOWN_MINUTES = 30;

/** Real minutes from ticket opening to closing, or null when unknown. */
export function transactionMinutes(ticket) {
    const start = Date.parse(ticket?.openedAt ?? "");
    const end = Date.parse(ticket?.closedAt ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return Math.max(1, Math.round((end - start) / 60_000));
}

/** "250 M sur Draconiros", or "1 000 M Brial → 855 M Dakal" for an exchange. */
function reviewAmount(ticket) {
    const name = (code) => serverLabel(serverByCode(code)) || code;
    if (ticket.transferFrom && ticket.transferTo) {
        const received = ticket.received == null ? "" : `${formatMillions(ticket.received)} `;
        return `${formatMillions(ticket.millions)} ${name(ticket.transferFrom)} → ${received}${name(ticket.transferTo)}`;
    }
    if (!ticket.millions) return null;
    return `${formatMillions(ticket.millions)}${ticket.serverCode ? ` sur ${name(ticket.serverCode)}` : ""}`;
}

export function reviewEmbed({ author, rating, text, ticket }) {
    const stars = "⭐".repeat(Math.min(5, Math.max(1, rating)));
    const type = TICKET_TYPES[ticket?.type];
    const fields = [
        { name: "✅ Commande vérifiée", value: type ? `${type.emoji} ${type.label}` : "Commande", inline: true },
    ];
    const amount = ticket ? reviewAmount(ticket) : null;
    if (amount) fields.push({ name: type?.id === "echange" ? "♻️ Transfert" : "💰 Quantité", value: amount, inline: true });
    const minutes = transactionMinutes(ticket);
    if (minutes !== null && minutes <= REVIEW_MAX_SHOWN_MINUTES) {
        fields.push({ name: "⏱️ Durée", value: `Livré en ${minutes} min`, inline: true });
    }
    if (ticket?.id) fields.push({ name: "🧾 Référence", value: `\`${ticket.id}\``, inline: true });
    const staffId = ticket?.claimedBy ?? ticket?.closedBy;
    if (staffId) fields.push({ name: "🧑‍💼 Staff", value: `<@${staffId}>`, inline: true });

    return baseEmbed({ color: BRAND.colors.brand })
        .setAuthor({ name: author.tag ?? author.username ?? "Client", iconURL: author.displayAvatarURL?.() })
        .setTitle(`${stars}  Avis client`)
        .setDescription(text)
        .addFields(fields);
}

export function helpEmbed(prefix) {
    return baseEmbed()
        .setTitle(`${BRAND.emoji} ${BRAND.name} — Aide`)
        .setDescription(
            [
                `Bienvenue au comptoir ${BRAND.emoji} — ici **${BRAND.botName}** gère les tickets, les taux et les stocks.`,
                "",
                "**Tickets**",
                "`/panel <type>` — (staff) poster un panneau marché dans ce salon",
                "`/ticket close [motif]` — fermer le ticket courant",
                "`/ticket claim` — (staff) prendre en charge",
                "`/ticket add <membre>` / `/ticket remove <membre>` — (staff) gérer les accès",
                "`/ticket rename <nom>` / `/ticket move <étape>` — (staff) organiser",
                "`/ticket stats` — (staff) statistiques",
                "",
                "**Marché**",
                "`/rate` — voir les prix par serveur • `/rate auto` (prix web, staff) • modifier les prix (manager) : `/rate ajuster`, `/rate prix`, `/rate tableau`, `/rate set`\n📘 Guide complet : salon **📘・guide-du-bot** (staff)",
                "`/stock` — voir le stock • `/stock set <serveur> <millions> <dispo|limite|sur commande>`",
                "",
                "**Admin**",
                "`/check` — diagnostic : permissions, hiérarchie des rôles, structure manquante",
                "`/setup [seulement_salons] [roles_paiement]` — créer rôles, catégories et salons",
                `\n🌐 ${BRAND.website}`,
            ].join("\n"),
        )
        .setFooter({ text: `${prefix}• ${BRAND.name}` });
}
