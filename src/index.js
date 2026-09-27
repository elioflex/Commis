import "dotenv/config";

import { ActivityType, Client, Events, GatewayIntentBits, Partials } from "discord.js";

import { BRAND, SETTINGS } from "../config.js";
import { startHealthServer } from "./health.js";
import { handleInteraction } from "./interactions.js";
import { mirrorStateNow, restoreState, scheduleStateMirror, stateMirrorStatus } from "./persist.js";
import { read, setWriteHook } from "./store.js";
import { ticketStats } from "./tickets.js";

const token = process.env.DISCORD_TOKEN?.trim();
if (!token) {
    console.error(
        "DISCORD_TOKEN manquant.\nCopie `.env.example` vers `.env`, colle le token d'un BOT Discord puis relance.",
    );
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

let healthServer = null;

/** Payload served on `/` — also the signal a keep-alive cron can watch. */
const buildStatus = (readyClient = client) => {
    const stats = SETTINGS.guildId ? ticketStats(SETTINGS.guildId) : { openCount: 0, closedCount: 0 };

    return {
        ok: readyClient.isReady(),
        brand: BRAND.name,
        bot: readyClient.user?.tag ?? null,
        uptimeSeconds: Math.round(process.uptime()),
        guilds: readyClient.guilds.cache.size,
        tickets: { open: stats.openCount ?? 0, closed: stats.closedCount ?? 0 },
        marketUpdatedAt: read("market.json").updatedAt,
        stateMirror: stateMirrorStatus(),
        memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
    };
};

client.once(Events.ClientReady, async (readyClient) => {
    console.info(`[bot] Connecté en tant que ${readyClient.user.tag}`);
    console.info(`[bot] ${readyClient.guilds.cache.size} serveur(s) • ${BRAND.name}`);

    readyClient.user.setPresence({
        status: "online",
        activities: [{ name: `${BRAND.emoji} ${BRAND.name} • taux du jour`, type: ActivityType.Watching }],
    });

    if (!SETTINGS.guildId) {
        console.warn("[bot] GUILD_ID non défini : les commandes de serveur ne seront pas proposées.");
    }

    // Free hosts wipe `data/` on restart: pull the Discord snapshot back first,
    // so tickets opened before the restart keep working.
    await restoreState(readyClient);

    // Then keep it fresh — one hook covers tickets, reviews, panels and market.
    setWriteHook(() => scheduleStateMirror());

    // Warm the caches so the first ticket creation is instant.
    read("tickets.json");
});

client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(client, interaction);
});

client.on(Events.GuildCreate, (guild) => {
    console.info(`[bot] Nouveau serveur : ${guild.name} (${guild.id})`);
});

client.on(Events.Error, (error) => console.error("[client] error:", error));
client.on(Events.Warn, (message) => console.warn("[client] warn:", message));

const shutdown = async (signal) => {
    console.info(`\n[bot] ${signal} reçu — sauvegarde puis fermeture…`);
    await mirrorStateNow().catch(() => null);
    healthServer?.close();
    await client.destroy();
    process.exit(0);
};

// Bound *before* the Discord login: a host like Render fails the deploy if the
// port never opens, so the health endpoint must not wait for the gateway.
healthServer = startHealthServer(() => buildStatus());

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => console.error("[process] unhandledRejection:", error));

await client.login(token).catch((error) => {
    console.error(`[bot] Connexion échouée : ${error.message}`);
    if (/token/i.test(error.message)) {
        console.error("Vérifie que DISCORD_TOKEN est bien un token de BOT (Developer Portal → Bot → Reset Token).");
    }
    process.exit(1);
});
