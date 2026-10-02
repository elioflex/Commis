import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import { BRAND, serverByCode, serverLabel } from "../config.js";
import { baseEmbed } from "./embeds.js";
import { eurPrice, serverPriceSummary } from "./market.js";
import { read, update } from "./store.js";

/**
 * 📈 Suivi prix: a customer follows our price on some servers (what we sell at
 * from the achat panel, what we pay from the vente panel) and gets one DM
 * listing every followed price that moved by at least MIN_CHANGE since the
 * last time they were told. Checked after each refresh of the price displays.
 */

export const WATCH_KINDS = ["buy", "sell"];
/** Smaller moves are noise from the 30-min web feed, not worth a DM. */
export const MIN_CHANGE = 0.03;
const DM_DELAY_MS = 1_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const key = (kind, serverCode) => `${kind}:${serverCode}`;
const currentPrice = (kind, serverCode) => eurPrice(serverCode, kind)?.eur ?? null;

export function watchesFor(userId, kind) {
    const items = read("watches.json").users?.[userId]?.items ?? {};
    return Object.keys(items)
        .filter((item) => item.startsWith(`${kind}:`))
        .map((item) => item.slice(kind.length + 1));
}

/** Replace the servers a customer follows for one kind; the other kind is untouched. */
export function setWatches(userId, guildId, kind, codes) {
    const servers = [...new Set(codes)].filter((code) => serverByCode(code));
    update("watches.json", (data) => {
        data.users ??= {};
        const entry = data.users[userId] ?? { guildId, items: {} };
        const kept = Object.fromEntries(Object.entries(entry.items).filter(([item]) => !item.startsWith(`${kind}:`)));
        for (const code of servers) kept[key(kind, code)] = entry.items[key(kind, code)] ?? currentPrice(kind, code);
        if (Object.keys(kept).length) data.users[userId] = { guildId, items: kept };
        else delete data.users[userId];
        return true;
    });
    return servers;
}

export const watchListLine = (codes) =>
    codes.length
        ? `📈 Tu suis : **${codes.map((code) => serverLabel(serverByCode(code)) || code).join(", ")}**`
        : "📉 Aucun suivi actif.";

/**
 * Followed prices that moved enough: `{ userId: { guildId, changes: [...] } }`.
 * Pure (reads only), so it can be tested without Discord.
 */
export function pendingPriceChanges() {
    const result = {};
    for (const [userId, entry] of Object.entries(read("watches.json").users ?? {})) {
        const changes = [];
        for (const [item, last] of Object.entries(entry.items ?? {})) {
            const [kind, serverCode] = item.split(":");
            const now = currentPrice(kind, serverCode);
            if (now === null) continue;
            if (!last) {
                changes.push({ kind, serverCode, from: null, to: now, silent: true });
                continue;
            }
            if (Math.abs(now - last) / last >= MIN_CHANGE) changes.push({ kind, serverCode, from: last, to: now });
        }
        if (changes.length) result[userId] = { guildId: entry.guildId, changes };
    }
    return result;
}

function changeLine({ kind, serverCode, from, to }) {
    const name = serverLabel(serverByCode(serverCode)) || serverCode;
    const up = to > from;
    // For a buyer a lower price is good news; for a seller a higher payout is.
    const good = kind === "buy" ? !up : up;
    const pct = Math.round((Math.abs(to - from) / from) * 1000) / 10;
    const what = kind === "buy" ? "prix d'achat" : "prix de rachat";
    return `${good ? "🟢" : "🔴"} **${name}** — ${what} ${up ? "en hausse" : "en baisse"} de **${pct.toLocaleString("fr-FR")} %** → ${serverPriceSummary(kind, serverCode)} /M`;
}

export function priceChangeEmbed(changes) {
    return baseEmbed({ color: BRAND.colors.info })
        .setTitle("📈 Tes prix suivis ont bougé")
        .setDescription(
            [
                ...changes.map(changeLine),
                "",
                "_Tu peux modifier ou arrêter ton suivi depuis le bouton 📈 Suivi prix des panneaux._",
            ].join("\n"),
        );
}

function panelRow(guildId, changes) {
    const posted = read("panels.json").posted ?? {};
    const buttons = [
        ["buy", "achat", "Acheter", "💎"],
        ["sell", "vente", "Vendre", "💸"],
    ]
        .filter(([kind, typeId]) => changes.some((change) => change.kind === kind) && posted[typeId]?.channelId)
        .map(([, typeId, label, emoji]) => {
            const entry = posted[typeId];
            const url = `https://discord.com/channels/${guildId}/${entry.channelId}${entry.messageId ? `/${entry.messageId}` : ""}`;
            return new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(label).setEmoji(emoji);
        });
    return buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [];
}

function remember(userId, changes) {
    update("watches.json", (data) => {
        const entry = data.users?.[userId];
        if (!entry) return false;
        for (const { kind, serverCode, to } of changes) {
            if (key(kind, serverCode) in entry.items) entry.items[key(kind, serverCode)] = to;
        }
        return true;
    });
}

let checking = false;

/** DM every customer whose followed prices moved enough. Errors are logged, never thrown. */
export async function checkPriceWatches(client) {
    if (checking || !client?.isReady?.()) return 0;
    checking = true;
    let sent = 0;
    try {
        for (const [userId, { guildId, changes }] of Object.entries(pendingPriceChanges())) {
            const visible = changes.filter((change) => !change.silent);
            if (visible.length) {
                try {
                    const user = await client.users.fetch(userId);
                    await user.send({ embeds: [priceChangeEmbed(visible)], components: panelRow(guildId, visible) });
                    sent += 1;
                } catch {
                    // DMs closed: still move the reference, or we would retry on every refresh.
                }
                await sleep(DM_DELAY_MS);
            }
            remember(userId, changes);
        }
    } catch (error) {
        console.error("[price-watch]", error.message);
    } finally {
        checking = false;
    }
    if (sent) console.log(`[price-watch] ${sent} DM envoyé(s)`);
    return sent;
}
