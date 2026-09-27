import { EmbedBuilder } from "discord.js";

import {
    BRAND,
    PAYMENT_METHODS,
    SETTINGS,
    TICKET_TYPES,
    currencyInfo,
    paymentByCode,
    serverByCode,
} from "../config.js";
import {
    formatMillions,
    formatMoney,
    rateFor,
    rateLines,
    stockLines,
    stockSummary,
} from "./market.js";

const timestamp = () => Math.floor(Date.now() / 1000);

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

/** The big embed that sits behind each market panel button. */
export function panelEmbed(typeId) {
    const type = TICKET_TYPES[typeId];
    const embed = baseEmbed({ color: type.color })
        .setTitle(`${type.emoji}  ${BRAND.name} • ${type.label}`)
        .setDescription([type.blurb, "", `Clique sur le bouton ci-dessous 👇`].join("\n"));

    if (typeId === "achat" || typeId === "vente" || typeId === "echange") {
        embed.addFields({ name: "📈 Taux", value: rateLines().join("\n"), inline: false });
        embed.addFields({ name: "📦 Stock par serveur", value: stockLines().join("\n"), inline: false });
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
        .setDescription(rateLines().join("\n"))
        .addFields(
            { name: "📦 Stock", value: stockLines({ onlyAvailable: true }).join("\n"), inline: false },
            {
                name: "📊 Résumé",
                value: `${summary.open} serveur(s) dispo • ${summary.low} en stock limité • **${formatMillions(summary.totalMillions)}** au total`,
                inline: false,
            },
        );
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
        fields.push({ name: "🌍 Serveur Dofus", value: serverByCode(ticket.serverCode)?.name ?? ticket.serverCode, inline: true });
    }
    if (ticket.millions) fields.push({ name: "💰 Quantité", value: formatMillions(ticket.millions), inline: true });
    if (ticket.currency) {
        const rate = rateFor(ticket.currency, ticket.rateKind);
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
            value: `${serverByCode(ticket.transferFrom)?.name ?? ticket.transferFrom} → ${serverByCode(ticket.transferTo)?.name ?? ticket.transferTo}`,
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
                "`/rate` — voir les taux • `/rate set <devise> <achat|vente|echange> <prix>`",
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
