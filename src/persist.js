import { AttachmentBuilder } from "discord.js";

import { BRAND, SETTINGS } from "../config.js";
import { findStateChannel } from "./guild-utils.js";
import { files as STORE_FILES, read, write } from "./store.js";

/**
 * State mirror.
 *
 * Free hosting (Render, Railway…) wipes the filesystem on every redeploy,
 * restart or spin-down, and free databases either expire or live in memory.
 * Discord, on the other hand, keeps messages forever and for free — so the bot
 * stores a JSON snapshot of `data/` as an attachment in a private staff
 * channel, and re-imports it at boot.
 *
 * Only one write path exists in the app (`store.write`), so a single hook
 * keeps the snapshot fresh: no change to the ticket/market code.
 */

const MIRROR_NAME = "etat-comptoir.json";
const SAVE_DEBOUNCE_MS = Number.parseInt(process.env.STATE_MIRROR_DEBOUNCE_MS ?? "", 10) || 8000;
const FETCH_LIMIT = 50;

let client = null;
let channel = null;
let messageId = null;
let timer = null;
let importing = false;
let saving = false;
let dirty = false;
let lastSavedAt = null;

/** Everything that lives in `data/`, as a single JSON document. */
export function buildSnapshot() {
    return {
        version: 1,
        brand: BRAND.name,
        savedAt: new Date().toISOString(),
        files: Object.fromEntries(STORE_FILES.map((name) => [name, read(name)])),
    };
}

/** Is there nothing worth keeping yet? (fresh install / wiped filesystem) */
export function isEmptyState() {
    const tickets = read("tickets.json");
    const market = read("market.json");
    const reviews = read("reviews.json");

    const openCount = Object.keys(tickets.open ?? {}).length;
    const closedCount = (tickets.closed ?? []).length;
    const rateCount = Object.values(market.rates ?? {}).length;
    const reviewCount = (reviews.entries ?? []).length;

    return openCount === 0 && closedCount === 0 && rateCount === 0 && reviewCount === 0;
}

/**
 * `when-empty` (default) protects a rich local state from an older remote
 * snapshot; `always` is what you want on a throwaway host.
 */
export function decideImport({ mode = SETTINGS.stateImport, localEmpty = isEmptyState() } = {}) {
    if (mode === "off") return "off";
    if (mode === "always") return "import";
    return localEmpty ? "import" : "keep-local";
}

/** Write a validated snapshot back into `data/`. Returns the restored file names. */
export function applySnapshot(snapshot) {
    const entries = Object.entries(snapshot?.files ?? {});
    const restored = [];

    importing = true;
    try {
        for (const [name, data] of entries) {
            if (!STORE_FILES.includes(name)) continue;
            if (data === null || typeof data !== "object") continue;
            write(name, data);
            restored.push(name);
        }
    } finally {
        importing = false;
    }

    return restored;
}

/** Compare two Discord ids numerically, falling back to a string compare. */
const isNewer = (candidate, current) => {
    const a = Number(candidate);
    const b = Number(current);
    return Number.isFinite(a) && Number.isFinite(b) ? a > b : String(candidate) > String(current);
};

export function stateMirrorStatus() {
    return {
        enabled: Boolean(client) && SETTINGS.stateMirror !== "off",
        channelId: channel?.id ?? null,
        messageId,
        lastSavedAt,
        pending: timer !== null,
    };
}

async function resolveChannel(readyClient) {
    const guild =
        (SETTINGS.guildId ? await readyClient.guilds.fetch(SETTINGS.guildId).catch(() => null) : null) ??
        readyClient.guilds.cache.first() ??
        null;

    if (!guild) return null;
    return findStateChannel(guild);
}

/**
 * Look for the newest snapshot in the staff channel and import it.
 * Never throws: a missing snapshot must not stop the bot from booting.
 */
export async function restoreState(readyClient, { fetchText = defaultFetchText, mode } = {}) {
    client = readyClient;

    const decision = decideImport({ mode });
    if (SETTINGS.stateMirror === "off" || decision === "off") {
        console.info("[state] miroir désactivé (STATE_MIRROR=off)");
        return { restored: [], reason: "disabled" };
    }

    try {
        channel = await resolveChannel(readyClient);
        if (!channel) {
            console.warn(
                "[state] aucun salon d'état trouvé (⚙️・gestion) — lance /setup ou renseigne STATE_CHANNEL_ID.",
            );
            return { restored: [], reason: "no-channel" };
        }

        const messages = await channel.messages.fetch({ limit: FETCH_LIMIT });
        const snapshots = messages.filter(
            (message) =>
                message.author?.id === readyClient.user.id &&
                message.attachments?.some((attachment) => attachment.name === MIRROR_NAME),
        );
        // Explicitly the newest, whatever order the API hands the page over in.
        const holder = snapshots.reduce(
            (best, message) => (!best || isNewer(message.id, best.id) ? message : best),
            null,
        );

        if (!holder) {
            console.info("[state] aucune sauvegarde en ligne pour l'instant — un instantané sera publié après la première modification.");
            return { restored: [], reason: "no-snapshot" };
        }

        const attachment = holder.attachments.find((item) => item.name === MIRROR_NAME);
        const snapshot = JSON.parse(await fetchText(attachment.url));
        messageId = holder.id;

        if (decision === "keep-local") {
            console.info("[state] état local déjà rempli — la sauvegarde en ligne n'est pas réimportée (STATE_IMPORT=always pour forcer).");
            return { restored: [], reason: "kept-local" };
        }

        const restored = applySnapshot(snapshot);
        console.info(`[state] état restauré depuis Discord (${restored.join(", ")}) — sauvegarde du ${snapshot.savedAt ?? "?"}.`);
        return { restored, reason: "imported", savedAt: snapshot.savedAt ?? null };
    } catch (error) {
        console.error("[state] restauration impossible :", error.message);
        return { restored: [], reason: "error", error: error.message };
    }
}

/** Debounced save — a busy ticket can trigger several writes in a row. */
export function scheduleStateMirror() {
    if (!client || !channel || SETTINGS.stateMirror === "off") return false;
    if (importing) return false;

    dirty = true;
    if (timer) return true;
    timer = setTimeout(() => {
        timer = null;
        void mirrorStateNow();
    }, SAVE_DEBOUNCE_MS);
    if (typeof timer.unref === "function") timer.unref();

    return true;
}

/** Publish (or refresh) the snapshot right now. */
export async function mirrorStateNow() {
    if (!client || !channel || SETTINGS.stateMirror === "off") return null;
    if (importing) return null;
    if (saving) {
        dirty = true;
        return null;
    }

    saving = true;
    dirty = false;

    try {
        const payload = {
            content: `💾 Sauvegarde automatique de **${BRAND.name}** — ne supprime pas ce message.`,
            files: [
                new AttachmentBuilder(Buffer.from(`${JSON.stringify(buildSnapshot(), null, 2)}\n`, "utf8"), {
                    name: MIRROR_NAME,
                }),
            ],
        };

        const message = messageId
            ? await channel.messages.edit(messageId, payload).catch(() => null)
            : null;

        const result = message ?? (await channel.send(payload));
        messageId = result.id;
        lastSavedAt = new Date().toISOString();
        console.info(`[state] sauvegarde publiée (${result.attachments.first()?.size ?? "?"} octets).`);
        return result;
    } catch (error) {
        console.error("[state] sauvegarde impossible :", error.message);
        return null;
    } finally {
        saving = false;
        if (dirty) scheduleStateMirror();
    }
}

const defaultFetchText = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
};

export { MIRROR_NAME };
