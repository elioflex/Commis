import { EmbedBuilder } from "discord.js";

import {
    BRAND,
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
    effectiveRate,
    feedEnabled,
    feedFactors,
    feedState,
    formatMillions,
    formatMoney,
    market,
    priceSource,
    rateFor,
    rateLines,
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
            [type.blurb, "", `Clique sur le bouton ci-dessous 👇`, isMarketType(typeId) ? pricesUpdatedLine() : null]
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

    embed.addFields({
        name: "💳 Moyens de paiement acceptés",
        value: PAYMENT_METHODS.map((m) => `${m.emoji} ${m.label}`).join(" • "),
        inline: false,
    });

    return embed;
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
    exchange: "♻️ Échange inter-serveurs — prix par serveur",
};

/** One of the three live embeds kept up to date in 📈・taux-du-jour. */
export function boardEmbed(kind) {
    const lines = [pricesUpdatedLine(), kind === "exchange" ? "_-10 % automatique à partir de 100 M._" : null].filter(
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

    const lines = DOFUS_SERVERS.filter((server) => server.game).map((server) => {
        const entry = feed.reference?.[server.code];
        const source = priceSource(server.code, "buy");
        if (!entry) return `⚪ **${serverLabel(server)}** · pas de prix web`;
        const shops = Object.entries(entry.sources ?? {})
            .map(([shop, value]) => `${shop} ${formatMoney(value, "EUR")}`)
            .join(" · ");
        const pending = feed.pending?.[server.code];
        return [
            `${source === "manuel" ? "📌" : "🌐"} **${serverLabel(server)}** · marché **${formatMoney(entry.eur, "EUR")}/M**`,
            shops ? ` (${shops})` : "",
            source === "manuel" ? " · _prix manuel prioritaire_" : "",
            pending ? ` · ⚠️ saut à ${formatMoney(pending, "EUR")} en attente` : "",
        ].join("");
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
                intervalMin ? `Relevé toutes les **${intervalMin} min** sur kamasv.com et 1kamas.com` : null,
                `Dernier relevé réussi : ${relative(feed.fetchedAt)} · dernière tentative : ${relative(feed.lastAttemptAt)}`,
                `Nos prix = marché × **${percent(factors.buy)}** achat · **${percent(factors.sell)}** vente · **${percent(factors.exchange)}** échange`,
                feed.lastError ? `⚠️ ${feed.lastError.slice(0, 300)}` : null,
                "",
                "_Priorité : prix manuel (`/rate prix`) › prix web › taux de base. `/rate prix … 0` rend la main au web._",
            ]
                .filter((line) => line !== null)
                .join("\n"),
        )
        .addFields(fields.slice(0, 5).map((value, index) => ({
            name: `🖥️ Référence marché (${index + 1}/${Math.min(fields.length, 5)})`,
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
        value: `🟢 ${summary.open} • 🟡 ${summary.low} • 🔴 ${summary.full} — total **${formatMillions(summary.totalMillions)}**`,
        inline: false,
    });
    return embed;
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
    if (ticket.serverCode) {
        fields.push({ name: "🌍 Serveur Dofus", value: serverLabel(serverByCode(ticket.serverCode)) || ticket.serverCode, inline: true });
    }
    if (ticket.millions) fields.push({ name: "💰 Quantité", value: formatMillions(ticket.millions), inline: true });
    if (ticket.currency) {
        const rate = effectiveRate(ticket.currency, ticket.rateKind, ticket.serverCode);
        const total = ticket.total;
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
            ].join("\n"),
            inline: true,
        });
    }
    if (ticket.personnage) fields.push({ name: "🧙 Personnage", value: ticket.personnage, inline: true });
    if (ticket.subject) fields.push({ name: "📌 Sujet", value: ticket.subject, inline: false });
    if (ticket.notes) fields.push({ name: "📝 Notes", value: ticket.notes, inline: false });
    if (ticket.transferFrom && ticket.transferTo) {
        fields.push({
            name: "♻️ Transfert",
            value: `${serverLabel(serverByCode(ticket.transferFrom)) || ticket.transferFrom} → ${serverLabel(serverByCode(ticket.transferTo)) || ticket.transferTo}`,
            inline: false,
        });
    }

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

export function reviewEmbed({ author, rating, text, kindLabelText }) {
    const stars = "⭐".repeat(Math.min(5, Math.max(1, rating)));
    return baseEmbed({ color: BRAND.colors.brand })
        .setAuthor({ name: author.tag ?? author.username ?? "Client", iconURL: author.displayAvatarURL?.() })
        .setTitle(`${stars}  Avis client`)
        .setDescription(text)
        .addFields({ name: "Transaction", value: kindLabelText, inline: true });
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
                "`/rate` — voir les prix par serveur • `/rate set <devise> <sens> <prix>` (base) • `/rate prix <serveur> <sens> <prix>` • `/rate tableau` (tous les serveurs d'un coup, staff) • `/rate auto` (prix web, staff)",
                "`/stock` — voir le stock • `/stock set <serveur> <millions> <dispo|limite|complet>`",
                "`/avis <note> <texte>` — laisser un avis",
                "",
                "**Admin**",
                "`/check` — diagnostic : permissions, hiérarchie des rôles, structure manquante",
                "`/setup [seulement_salons] [roles_paiement]` — créer rôles, catégories et salons",
                `\n🌐 ${BRAND.website}`,
            ].join("\n"),
        )
        .setFooter({ text: `${prefix}• ${BRAND.name}` });
}
