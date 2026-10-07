import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";

import { BRAND, COMPETITORS, DOFUS_SERVERS, SETTINGS, serverByCode, serverLabel } from "../config.js";
import { baseEmbed } from "./embeds.js";
import { findTextChannel } from "./guild-utils.js";
import {
    competitorEdge,
    competitorPrices,
    competitorPricesDh,
    effectiveRate,
    eurPrice,
    exchangeFee,
    exchangeQuote,
    feedEnabled,
    feedFactors,
    feedState,
    formatMillions,
    formatMoney,
    resolveServers,
    serverAdjustment,
    stockFor,
    stockSummary,
} from "./market.js";
import { priceFeedRunning } from "./price-feed.js";
import { read, update } from "./store.js";

/**
 * 🎛️・pilotage-prix: a text channel only the price manager can see. It holds
 * one live message (overview + our prices vs competitors) edited after every
 * price refresh, with buttons to steer prices without slash commands.
 * Competitor figures live here and in the staff commands, never on the
 * customer displays.
 */

export const ADMIN_CHANNEL = "🎛️・pilotage-prix";

export function adminChannel(guild) {
    return (
        findTextChannel(guild, ADMIN_CHANNEL) ??
        guild.channels.cache.find((channel) => channel.isTextBased?.() && /pilotage-prix/i.test(channel.name)) ??
        null
    );
}

const percent = (share) => `${Math.round(share * 1000) / 10} %`.replace(".", ",");
const relative = (iso) => (iso ? `<t:${Math.floor(Date.parse(iso) / 1000)}:R>` : "jamais");

/** Counts that tell the manager how the shop is doing right now. Pure (reads only). */
export function adminActivity(guildId) {
    const tickets = Object.values(read("tickets.json").open ?? {}).filter(
        (ticket) => !guildId || ticket.guildId === guildId,
    );
    const offers = Object.values(read("offers.json").offers ?? {});
    const watches = Object.values(read("watches.json").users ?? {});
    const alerts = Object.values(read("alerts.json").users ?? {});
    return {
        openTickets: tickets.length,
        byType: tickets.reduce((acc, ticket) => ({ ...acc, [ticket.type]: (acc[ticket.type] ?? 0) + 1 }), {}),
        pendingOffers: offers.filter((offer) => offer.status === "pending").length,
        watchers: watches.length,
        alertSubscribers: alerts.length,
    };
}

/* ───────────── change log ───────────── */

const LOG_SIZE = 6;

/** Remember a price/stock change made by a manager, shown at the bottom of the dashboard. */
export function logAdminChange(userId, text) {
    update("market.json", (data) => {
        data.adminLog = [{ at: new Date().toISOString(), userId: userId ?? null, text: String(text).slice(0, 140) }, ...(data.adminLog ?? [])].slice(0, LOG_SIZE);
        return true;
    });
}

export const adminLog = () => read("market.json").adminLog ?? [];

/* ───────────── dashboard ───────────── */

const eur = (value) => formatMoney(value, "EUR");
const short = (value) => (typeof value === "number" ? value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

/** "**Draconiros** 1,55 € ✅ · KamasV 1,60 · 1Kamas 1,62 🎚️-2 %": our price, the shops, our tweaks. */
export function adminPriceLine(server, kind) {
    if (kind === "sell") return adminSellLine(server);
    const price = eurPrice(server.code, kind);
    const shops = Object.entries(competitorPrices(server.code, kind));
    const beaten = competitorEdge(server.code, kind).length;
    const verdict = !price || !shops.length ? "" : beaten === shops.length ? " ✅" : beaten ? " ➖" : " ❌";
    const adjust = serverAdjustment(server.code, kind);
    return [
        `**${serverLabel(server)}** ${price ? eur(price.eur) : "à confirmer"}${verdict}`,
        shops.length ? ` · ${shops.map(([site, value]) => `${COMPETITORS[site] ?? site} ${short(value)}`).join(" · ")}` : "",
        adjust ? ` 🎚️${adjust > 0 ? "+" : ""}${adjust} %` : "",
        price?.manual ? " 📌" : "",
        price?.capped ? " 🛡️" : "",
    ].join("");
}

/** Buyback is priced in DH: "**Draconiros** 7,37 DH ✅ · LesKamas 7,15 🎚️-6 %". */
export function adminSellLine(server) {
    const price = eurPrice(server.code, "sell");
    const ours = effectiveRate("MAD", "sell", server.code);
    const shops = Object.entries(competitorPricesDh(server.code));
    const beaten = ours === null ? 0 : shops.filter(([, value]) => ours > value).length;
    const verdict = ours === null || !shops.length ? "" : beaten === shops.length ? " ✅" : beaten ? " ➖" : " ❌";
    const adjust = serverAdjustment(server.code, "sell");
    return [
        `**${serverLabel(server)}** ${ours === null ? "à confirmer" : formatMoney(ours, "MAD")}${verdict}`,
        shops.length ? ` · ${shops.map(([site, value]) => `${COMPETITORS[site] ?? site} ${short(value)}`).join(" · ")}` : "",
        adjust ? ` 🎚️${adjust > 0 ? "+" : ""}${adjust} %` : "",
        price?.manual ? " 📌" : "",
        price?.capped ? " 🛡️" : "",
    ].join("");
}

/** Split lines into embed fields of at most 1024 characters. */
function chunkFields(name, lines) {
    const chunks = [];
    let chunk = "";
    for (const line of lines) {
        if (chunk && chunk.length + line.length + 1 > 1024) {
            chunks.push(chunk);
            chunk = "";
        }
        chunk = chunk ? `${chunk}\n${line}` : line;
    }
    if (chunk) chunks.push(chunk);
    return chunks.map((value, index) => ({
        name: chunks.length > 1 ? `${name} (${index + 1}/${chunks.length})` : name,
        value,
        inline: false,
    }));
}

function exchangeLines() {
    const lines = [
        `Commission : **${exchangeFee().toLocaleString("fr-FR")} %** · valeur des kamas = notre prix de vente sur chaque serveur`,
    ];
    const priced = DOFUS_SERVERS.filter((server) => server.game && eurPrice(server.code, "buy"))
        .sort((a, b) => stockFor(b.code).millions - stockFor(a.code).millions)
        .slice(0, 3);
    for (const [from, to] of [[priced[0], priced[1]], [priced[1], priced[2]]]) {
        const quote = from && to ? exchangeQuote(from.code, to.code, 100) : null;
        if (quote) lines.push(`Ex. 100 M ${serverLabel(from)} → **${formatMillions(quote.received)}** ${serverLabel(to)}`);
    }
    return lines.join("\n");
}

export function adminOverviewEmbed(guildId, { running = true } = {}) {
    const feed = feedState();
    const factors = feedFactors();
    const stock = stockSummary();
    const activity = adminActivity(guildId);
    const servers = DOFUS_SERVERS.filter((server) => server.game);
    const log = adminLog();

    return baseEmbed({ color: feedEnabled() ? BRAND.colors.success : BRAND.colors.neutral })
        .setTitle("🎛️ Pilotage des prix")
        .setDescription(
            [
                `Prix web : **${feedEnabled() ? "actifs" : "en pause"}** · dernier relevé ${relative(feed.fetchedAt)}` +
                    (running ? "" : " · _relevé automatique coupé (PRICE_FEED=off)_"),
                `🛒 Vente : **${percent(factors.buy)}** du concurrent le moins cher · 💸 Rachat : **${percent(factors.sell)}** de LesKamas (en DH)`,
                feed.lastError ? `⚠️ ${feed.lastError.slice(0, 200)}` : null,
                "_✅ meilleur que tous · ➖ que certains · ❌ que personne · 🎚️ ajustement · 📌 prix manuel · 🛡️ plafonné (marge)_",
            ]
                .filter(Boolean)
                .join("\n"),
        )
        .addFields(
            ...chunkFields("🛒 Prix de vente (le client achète)", servers.map((server) => adminPriceLine(server, "buy"))),
            ...chunkFields("💸 Prix de rachat en DH (le client vend)", servers.map((server) => adminPriceLine(server, "sell"))),
            { name: "♻️ Échange", value: exchangeLines(), inline: false },
            {
                name: "📦 Stock",
                value: stock.servers
                    ? `🟢 ${stock.open} · 🟡 ${stock.low} · 🕐 ${stock.full}\nTotal : **${formatMillions(stock.totalMillions)}**`
                    : "_Aucun stock configuré_",
                inline: true,
            },
            {
                name: "📊 Activité",
                value: [
                    `🎟️ Tickets : **${activity.openTickets}**`,
                    `💼 Offres en attente : **${activity.pendingOffers}**`,
                    `📈 Suivis : **${activity.watchers}** · 🔔 Alertes : **${activity.alertSubscribers}**`,
                ].join("\n"),
                inline: true,
            },
            {
                name: "🕘 Dernières modifications",
                value: log.length
                    ? log.map((entry) => `${relative(entry.at)}${entry.userId ? ` <@${entry.userId}>` : ""} — ${entry.text}`).join("\n")
                    : "_Aucune modification pour l'instant._",
                inline: false,
            },
        )
        .setFooter({ text: `Mis à jour automatiquement · ${BRAND.name}` })
        .setTimestamp(new Date());
}

const button = (id, label, emoji, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(`admin:${id}`).setLabel(label).setEmoji(emoji).setStyle(style);

export function adminRows() {
    return [
        new ActionRowBuilder().addComponents(
            button("feed", "Relever maintenant", "🔄", ButtonStyle.Primary),
            button("toggle", feedEnabled() ? "Mettre en pause" : "Réactiver", feedEnabled() ? "⏸️" : "▶️"),
            button("factors", "Pourcentages", "🎯"),
            button("fee", "Commission", "💱"),
        ),
        new ActionRowBuilder().addComponents(
            button("adjust", "Ajuster serveurs", "🎚️"),
            button("price", "Prix manuel", "📌"),
            button("stock", "Stock", "📦"),
        ),
    ];
}

export function adminPayload(guildId, { running = priceFeedRunning() } = {}) {
    return {
        embeds: [adminOverviewEmbed(guildId, { running })],
        components: adminRows(),
    };
}

/* ───────────── modals ───────────── */

const field = (id, label, { placeholder = "", value, required = true, style = TextInputStyle.Short } = {}) => {
    const input = new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style)
        .setRequired(required)
        .setMaxLength(style === TextInputStyle.Paragraph ? 1000 : 60);
    if (placeholder) input.setPlaceholder(placeholder);
    if (value !== undefined && value !== null && value !== "") input.setValue(String(value));
    return new ActionRowBuilder().addComponents(input);
};

const pct = (share) => String(Math.round(share * 1000) / 10);

export function adminModal(kind) {
    const modal = new ModalBuilder().setCustomId(`admin:modal:${kind}`);
    if (kind === "factors") {
        const factors = feedFactors();
        return modal.setTitle("🎯 Pourcentages vs concurrents").addComponents(
            field("buy", "Vente : % du concurrent le moins cher", { value: pct(factors.buy), placeholder: "97" }),
            field("sell", "Rachat : % du meilleur rachat", { value: pct(factors.sell), placeholder: "103" }),
        );
    }
    if (kind === "fee") {
        return modal
            .setTitle("💱 Commission échange")
            .addComponents(field("fee", "Commission en %", { value: exchangeFee(), placeholder: "10" }));
    }
    if (kind === "adjust") {
        return modal.setTitle("🎚️ Ajuster des serveurs").addComponents(
            field("servers", "Serveurs (« tous » ou drac, ombre…)", { placeholder: "tous" }),
            field("side", "Sens : achat, vente ou les deux", { placeholder: "les deux" }),
            field("percent", "Ajustement en % (0 = retirer)", { placeholder: "-2" }),
        );
    }
    if (kind === "price") {
        return modal.setTitle("📌 Prix manuel").addComponents(
            field("server", "Serveur", { placeholder: "drac" }),
            field("side", "Sens : achat ou vente", { placeholder: "achat" }),
            field("price", "Prix € par M (0 = rendre au web)", { placeholder: "1.45" }),
        );
    }
    return modal.setTitle("📦 Stock").addComponents(
        field("server", "Serveur", { placeholder: "drac" }),
        field("millions", "Millions disponibles", { placeholder: "500" }),
        field("status", "Statut : dispo, limite ou sur commande", {
            placeholder: "vide = automatique",
            required: false,
        }),
    );
}

/* ───────────── input parsing (pure, tested) ───────────── */

export function parseNumber(input) {
    const raw = String(input ?? "").trim().replace(/\s|%|€/g, "").replace(",", ".");
    if (!/^[-+]?\d+(\.\d+)?$/.test(raw)) return null;
    return Number.parseFloat(raw);
}

/** "achat" → ["buy"], "vente" → ["sell"], "les deux" / "" → both (when allowed). */
export function parseSide(input, { allowBoth = true } = {}) {
    const raw = String(input ?? "").trim().toLowerCase();
    if (/^(achat|buy|a)$/.test(raw)) return ["buy"];
    if (/^(vente|rachat|sell|v)$/.test(raw)) return ["sell"];
    if (allowBoth && (!raw || /deux|both|tous|les 2|2/.test(raw))) return ["buy", "sell"];
    return null;
}

export function parseStockStatus(input, millions) {
    const raw = String(input ?? "").trim().toLowerCase();
    if (!raw) return millions > 100 ? "open" : millions > 0 ? "low" : "full";
    if (/dispo|open/.test(raw)) return "open";
    if (/limit|low/.test(raw)) return "low";
    if (/commande|full|complet/.test(raw)) return "full";
    return null;
}

export function resolveOneServer(input) {
    const { codes, unknown } = resolveServers(String(input ?? ""));
    return codes.length === 1 && !unknown.length ? codes[0] : null;
}

export const priceLine = (code, kind) => {
    const price = eurPrice(code, kind);
    const name = serverLabel(serverByCode(code)) || code;
    return `**${name}** ${kind === "buy" ? "vente" : "rachat"} : ${price ? `**${formatMoney(price.eur, "EUR")}/M**` : "à confirmer"}`;
};

/* ───────────── live message ───────────── */

let soonTimer = null;

/** Debounced refresh for activity changes (offers, tickets, feed runs) that don't touch public displays. */
export function refreshAdminPanelSoon(client) {
    if (!client?.isReady?.()) return;
    clearTimeout(soonTimer);
    soonTimer = setTimeout(() => {
        soonTimer = null;
        refreshAdminPanel(client).catch((error) => console.error("[pilotage-prix]", error.message));
    }, 3_000);
    soonTimer.unref?.();
}

/** Post the dashboard once, then edit it. Silent when the channel doesn't exist. */
export async function refreshAdminPanel(client) {
    const guild = SETTINGS.guildId ? client.guilds.cache.get(SETTINGS.guildId) : client.guilds.cache.first();
    if (!guild) return 0;
    const channel = adminChannel(guild);
    if (!channel) return 0;

    const payload = adminPayload(guild.id);
    const saved = read("panels.json").admin ?? {};
    const existing =
        saved.channelId === channel.id && saved.messageId
            ? await channel.messages.fetch(saved.messageId).catch(() => null)
            : null;
    if (existing) {
        await existing.edit(payload);
        return 1;
    }
    const message = await channel.send(payload);
    update("panels.json", (data) => {
        data.admin = { channelId: channel.id, messageId: message.id };
        return true;
    });
    return 1;
}
