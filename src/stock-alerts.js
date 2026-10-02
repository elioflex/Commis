import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import { BRAND, serverByCode, serverLabel } from "../config.js";
import { baseEmbed } from "./embeds.js";
import { formatMillions } from "./market.js";
import { read, update } from "./store.js";

/**
 * 🔔 Alerte stock: a customer picks servers, and gets a DM the moment we have
 * stock there again (via `/stock set`). One-shot: a server is dropped from the
 * customer's list once they have been told.
 */

const DM_DELAY_MS = 1_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const validCodes = (codes) => [...new Set(codes)].filter((code) => serverByCode(code));

export function alertsFor(userId) {
    return read("alerts.json").users?.[userId]?.servers ?? [];
}

/** Replace a customer's alert list. An empty list removes them. */
export function setAlerts(userId, guildId, codes) {
    const servers = validCodes(codes);
    update("alerts.json", (data) => {
        data.users ??= {};
        if (servers.length) data.users[userId] = { guildId, servers, updatedAt: new Date().toISOString() };
        else delete data.users[userId];
        return true;
    });
    return servers;
}

export function subscribersFor(serverCode) {
    return Object.entries(read("alerts.json").users ?? {})
        .filter(([, entry]) => entry.servers?.includes(serverCode))
        .map(([userId, entry]) => ({ userId, guildId: entry.guildId }));
}

/** Did this stock change make the server deliverable right away? */
export const isRestock = (before, after) =>
    after.status !== "full" && after.millions > 0 && (before.status === "full" || before.millions <= 0);

const serverNames = (codes) => codes.map((code) => serverLabel(serverByCode(code)) || code).join(", ");

export const alertListLine = (codes) =>
    codes.length ? `🔔 Tes alertes : **${serverNames(codes)}**` : "🔕 Aucune alerte active.";

function panelLink(guildId, typeId) {
    const entry = read("panels.json").posted?.[typeId];
    if (!entry?.channelId) return null;
    return `https://discord.com/channels/${guildId}/${entry.channelId}${entry.messageId ? `/${entry.messageId}` : ""}`;
}

export function restockEmbed(serverCode, stock) {
    const name = serverLabel(serverByCode(serverCode)) || serverCode;
    return baseEmbed({ color: BRAND.colors.success })
        .setTitle(`🔔 Stock disponible sur ${name}`)
        .setDescription(
            [
                `**${formatMillions(stock.millions)}** prêts à être livrés tout de suite sur **${name}**.`,
                "",
                "Ouvre ton ticket dans le salon achat ou échange, le prix du jour est affiché sur le panneau.",
                "_Cette alerte est maintenant désactivée pour ce serveur. Tu peux la réactiver depuis le bouton 🔔 Alerte stock._",
            ].join("\n"),
        );
}

function restockRow(guildId) {
    const buttons = [
        ["achat", "Acheter", "💎"],
        ["echange", "Échanger", "♻️"],
    ]
        .map(([typeId, label, emoji]) => {
            const url = panelLink(guildId, typeId);
            return url ? new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(label).setEmoji(emoji) : null;
        })
        .filter(Boolean);
    return buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [];
}

/**
 * DM everyone waiting on `serverCode`, then drop that server from their list.
 * Returns how many customers were reached.
 */
export async function notifyRestock(client, serverCode, stock) {
    const waiting = subscribersFor(serverCode);
    let sent = 0;
    for (const { userId, guildId } of waiting) {
        try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [restockEmbed(serverCode, stock)], components: restockRow(guildId) });
            sent += 1;
        } catch {
            // DMs closed or user gone: nothing else to do, the alert is spent either way.
        }
        setAlerts(userId, guildId, alertsFor(userId).filter((code) => code !== serverCode));
        await sleep(DM_DELAY_MS);
    }
    return sent;
}
