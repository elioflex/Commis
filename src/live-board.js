import { SETTINGS } from "../config.js";
import { boardEmbed, panelEmbed } from "./embeds.js";
import { findTextChannel } from "./guild-utils.js";
import { read, update } from "./store.js";

/**
 * Keeps every price display in sync with market.json: the three market panels
 * (achat / vente / échange, edited in place from panels.json) and the live
 * board in 📈・taux-du-jour (three messages, created once then edited).
 *
 * Staff commands call `refreshMarketDisplays` after each change; bursts are
 * coalesced so a bulk edit only costs one round of API calls.
 */

const MARKET_PANELS = ["achat", "vente", "echange"];
const BOARD_KINDS = ["buy", "sell", "exchange"];
const DEBOUNCE_MS = 2_000;

let timer = null;
let running = null;

export function boardChannel(guild) {
    return (
        findTextChannel(guild, "📈・taux-du-jour") ??
        guild.channels.cache.find((channel) => channel.isTextBased?.() && /taux-du-jour/i.test(channel.name)) ??
        null
    );
}

async function fetchMessage(client, channelId, messageId) {
    if (!channelId || !messageId) return null;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return null;
    return channel.messages.fetch(messageId).catch(() => null);
}

async function refreshPanels(client) {
    const posted = read("panels.json").posted ?? {};
    let edited = 0;
    for (const typeId of MARKET_PANELS) {
        const entry = posted[typeId];
        const message = await fetchMessage(client, entry?.channelId, entry?.messageId);
        if (!message) {
            if (entry) console.warn(`[live-board] panneau ${typeId} introuvable — republie-le avec /panel`);
            continue;
        }
        await message.edit({ embeds: [panelEmbed(typeId)] });
        edited += 1;
    }
    return edited;
}

async function refreshBoard(client) {
    const guild = SETTINGS.guildId ? client.guilds.cache.get(SETTINGS.guildId) : client.guilds.cache.first();
    if (!guild) return 0;

    const channel = boardChannel(guild);
    if (!channel) return 0;

    const saved = read("panels.json").board ?? {};
    const sameChannel = saved.channelId === channel.id;
    const messageIds = {};

    for (const kind of BOARD_KINDS) {
        const payload = { embeds: [boardEmbed(kind)] };
        const existing = sameChannel ? await fetchMessage(client, channel.id, saved.messages?.[kind]) : null;
        const message = existing ? await existing.edit(payload) : await channel.send(payload);
        messageIds[kind] = message.id;
    }

    const changed = !sameChannel || BOARD_KINDS.some((kind) => saved.messages?.[kind] !== messageIds[kind]);
    if (changed) {
        update("panels.json", (data) => {
            data.board = { channelId: channel.id, messages: messageIds };
            return true;
        });
    }
    return BOARD_KINDS.length;
}

/** Edit all price displays now. Errors are logged, never thrown at the caller. */
export async function refreshMarketDisplaysNow(client) {
    if (!client?.isReady?.()) return { panels: 0, board: 0 };
    if (running) await running.catch(() => null);

    running = (async () => {
        const panels = await refreshPanels(client).catch((error) => {
            console.error("[live-board] panneaux :", error.message);
            return 0;
        });
        const board = await refreshBoard(client).catch((error) => {
            console.error("[live-board] taux-du-jour :", error.message);
            return 0;
        });
        return { panels, board };
    })();

    try {
        return await running;
    } finally {
        running = null;
    }
}

/** Debounced refresh — safe to call after every single price or stock change. */
export function refreshMarketDisplays(client) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        void refreshMarketDisplaysNow(client);
    }, DEBOUNCE_MS);
    timer.unref?.();
}
