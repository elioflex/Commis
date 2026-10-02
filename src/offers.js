import { BRAND, serverByCode, serverLabel } from "../config.js";
import { baseEmbed } from "./embeds.js";
import { effectiveRate, formatMillions, formatMoney } from "./market.js";
import { read, update } from "./store.js";

/**
 * 💼 Faire une offre: a customer proposes their own price per M for a quantity
 * on a server. The offer lands in the staff channel; accepting it opens a
 * ticket at the agreed price, refusing it tells the customer today's price.
 */

export const OFFER_KINDS = ["buy", "sell"];
const MAX_PRICE = 1_000;

/** "1,40" / "1.4€" / "15 DH" → 1.4 / 15. Null when not a positive number. */
export function parsePrice(input) {
    const raw = String(input ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s€]|dh|mad|eur/g, "")
        .replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(raw)) return null;
    const value = Number.parseFloat(raw);
    return value > 0 && value <= MAX_PRICE ? value : null;
}

export function createOffer({ guildId, userId, kind, serverCode, millions, price, currency, personnage }) {
    let offer = null;
    update("offers.json", (data) => {
        data.offers ??= {};
        const number = Number(data.nextId) || 1;
        data.nextId = number + 1;
        offer = {
            id: `offre-${String(number).padStart(4, "0")}`,
            guildId,
            userId,
            kind,
            serverCode,
            millions,
            price,
            currency,
            personnage: personnage || null,
            marketRate: effectiveRate(currency, kind, serverCode),
            status: "pending",
            createdAt: new Date().toISOString(),
        };
        data.offers[offer.id] = offer;
        return true;
    });
    return offer;
}

export const offerById = (id) => read("offers.json").offers?.[id] ?? null;

/**
 * Settle a pending offer. Returns the updated offer, or null when it was
 * already decided (two staff clicking at once must not open two tickets).
 */
export function decideOffer(id, status, staffId) {
    let decided = null;
    update("offers.json", (data) => {
        const offer = data.offers?.[id];
        if (!offer || offer.status !== "pending") return false;
        Object.assign(offer, { status, decidedBy: staffId, decidedAt: new Date().toISOString() });
        decided = { ...offer };
        return true;
    });
    return decided;
}

const kindLabel = (kind) => (kind === "buy" ? "Achat (on vend)" : "Vente (on rachète)");
const serverName = (code) => serverLabel(serverByCode(code)) || code;

/** Gap between the offer and our current price, from our side: negative = less margin. */
export function offerGap(offer) {
    if (!offer.marketRate) return null;
    const pct = ((offer.price - offer.marketRate) / offer.marketRate) * 100;
    return Math.round((offer.kind === "buy" ? pct : -pct) * 10) / 10;
}

const STATUS = {
    pending: "⏳ En attente",
    accepted: "✅ Acceptée",
    refused: "❌ Refusée",
};

export function offerStaffEmbed(offer) {
    const gap = offerGap(offer);
    const color =
        offer.status === "accepted"
            ? BRAND.colors.success
            : offer.status === "refused"
              ? BRAND.colors.danger
              : BRAND.colors.brand;
    const fields = [
        { name: "👤 Client", value: `<@${offer.userId}>`, inline: true },
        { name: "📂 Type", value: kindLabel(offer.kind), inline: true },
        { name: "🌍 Serveur", value: serverName(offer.serverCode), inline: true },
        { name: "💰 Quantité", value: formatMillions(offer.millions), inline: true },
        {
            name: "💶 Prix proposé",
            value: `**${formatMoney(offer.price, offer.currency)}/M** → ${formatMoney(offer.price * offer.millions, offer.currency)}`,
            inline: true,
        },
        {
            name: "📊 Notre prix",
            value:
                offer.marketRate === null
                    ? "—"
                    : `${formatMoney(offer.marketRate, offer.currency)}/M` +
                      (gap === null ? "" : ` (${gap >= 0 ? "+" : ""}${gap.toLocaleString("fr-FR")} % de marge)`),
            inline: true,
        },
    ];
    if (offer.personnage) fields.push({ name: "🧙 Personnage", value: offer.personnage, inline: true });
    fields.push({
        name: "📌 Statut",
        value: offer.decidedBy ? `${STATUS[offer.status]} par <@${offer.decidedBy}>` : STATUS[offer.status],
        inline: false,
    });
    return baseEmbed({ color }).setTitle(`💼 Offre ${offer.id}`).addFields(fields);
}

export function offerSentEmbed(offer) {
    return baseEmbed({ color: BRAND.colors.info })
        .setTitle("💼 Offre envoyée au staff")
        .setDescription(
            [
                `**${formatMillions(offer.millions)}** sur **${serverName(offer.serverCode)}** à **${formatMoney(offer.price, offer.currency)}/M**.`,
                "",
                "Le staff te répond en message privé : si l'offre est acceptée, ton ticket s'ouvre automatiquement à ce prix.",
                `_Référence : \`${offer.id}\`_`,
            ].join("\n"),
        );
}

export function offerAcceptedEmbed(offer, channelId) {
    return baseEmbed({ color: BRAND.colors.success })
        .setTitle("✅ Ton offre est acceptée")
        .setDescription(
            [
                `**${formatMillions(offer.millions)}** sur **${serverName(offer.serverCode)}** à **${formatMoney(offer.price, offer.currency)}/M**.`,
                channelId ? `Ton ticket est ouvert : <#${channelId}>` : "Le staff te contacte dans ton ticket.",
                `_Référence : \`${offer.id}\`_`,
            ].join("\n"),
        );
}

export function offerRefusedEmbed(offer) {
    const current = effectiveRate(offer.currency, offer.kind, offer.serverCode);
    return baseEmbed({ color: BRAND.colors.danger })
        .setTitle("❌ Offre non retenue")
        .setDescription(
            [
                `Ton offre à **${formatMoney(offer.price, offer.currency)}/M** sur **${serverName(offer.serverCode)}** n'a pas pu être acceptée.`,
                current === null
                    ? "Le staff peut te proposer un prix dans un ticket."
                    : `Notre prix actuel : **${formatMoney(current, offer.currency)}/M**. Tu peux ouvrir un ticket à ce prix depuis le panneau, ou suivre le prix avec 📈 Suivi prix.`,
                `_Référence : \`${offer.id}\`_`,
            ].join("\n"),
        );
}
