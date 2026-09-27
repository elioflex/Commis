import { GatewayIntentBits, PermissionFlagsBits } from "discord.js";

import { LAYOUT, SETTINGS, TICKET_STAGES } from "../config.js";
import { staffRole } from "./guild-utils.js";
import { plannedRoles } from "./setup.js";

/**
 * Deployment diagnostics.
 *
 * Everything that silently breaks a setup — missing permissions, a bot role
 * below Staff, a privileged intent left off — is checked *before* the bot
 * starts touching the API, so the failure is readable instead of a stack trace.
 *
 * Levels: "error" = the setup will fail, "warn" = worth fixing, "ok" = fine.
 */

const REQUIRED_PERMISSIONS = [
    ["ViewChannel", "Voir les salons"],
    ["ManageChannels", "Gérer les salons"],
    ["ManageRoles", "Gérer les rôles"],
    ["SendMessages", "Envoyer des messages"],
    ["EmbedLinks", "Intégrer des liens"],
    ["AttachFiles", "Joindre des fichiers"],
    ["ReadMessageHistory", "Voir l'historique des messages"],
];

const normalize = (name) => String(name).trim().toLowerCase();

export const plannedCategories = () => [
    ...TICKET_STAGES.map((stage) => stage.name),
    ...LAYOUT.map((block) => block.name),
];

export const plannedChannels = () => LAYOUT.flatMap((block) => block.channels.map((channel) => channel.name));

/**
 * How much of the target structure already exists. Cheap (cache only) and it
 * tells you at a glance whether `/setup` still has work to do.
 */
export function describeInventory(guild, { withPaymentRoles = false } = {}) {
    const roleNames = new Set(guild.roles?.cache?.map((role) => normalize(role.name)) ?? []);
    const channelNames = new Set(guild.channels?.cache?.map((channel) => normalize(channel.name)) ?? []);

    const count = (names, existing) => {
        const missing = names.filter((name) => !existing.has(normalize(name)));
        return { planned: names.length, missing: missing.length, missingNames: missing };
    };

    return {
        roles: count(
            plannedRoles({ withPaymentRoles }).map((role) => role.name),
            roleNames,
        ),
        categories: count(plannedCategories(), channelNames),
        channels: count(plannedChannels(), channelNames),
    };
}

/**
 * Sync checks — safe to call anywhere, never hits the API.
 * @returns {{ checks: Array<{level: string, title: string, detail: string}>, inventory: object, ok: boolean }}
 */
export function checkGuild(guild, client = null, { withPaymentRoles = false } = {}) {
    const checks = [];
    const add = (level, title, detail) => checks.push({ level, title, detail });

    if (!guild) {
        add("error", "Serveur introuvable", "Vérifie GUILD_ID dans `.env` et que le bot est bien invité.");
        return finish(checks, null);
    }

    const me = guild.members?.me ?? null;

    if (!me) {
        add(
            "error",
            "Bot introuvable sur le serveur",
            "Invite-le avec le scope `bot` + `applications.commands`, et active **SERVER MEMBERS INTENT**.",
        );
    } else {
        for (const [key, label] of REQUIRED_PERMISSIONS) {
            const granted = Boolean(me.permissions?.has?.(PermissionFlagsBits[key]));
            add(granted ? "ok" : "error", label, granted ? "Accordée" : `À accorder au rôle du bot (\`${key}\`).`);
        }

        const staff = staffRole(guild);
        const highest = me.roles?.highest ?? null;
        if (staff && highest) {
            const above = highest.position > staff.position;
            add(
                above ? "ok" : "error",
                "Hiérarchie des rôles",
                above
                    ? `« ${highest.name} » est bien au-dessus de « ${staff.name} ».`
                    : `Le rôle le plus haut du bot (« ${highest.name} ») doit être glissé **au-dessus** de « ${staff.name} » dans Paramètres → Rôles.`,
            );
        }
    }

    if (client) {
        const codeSide = client.options?.intents?.has?.(GatewayIntentBits.GuildMembers) ?? false;
        add(
            codeSide ? "ok" : "error",
            "Intent SERVER MEMBERS (code)",
            codeSide ? "Activé dans `src/index.js`" : "`GatewayIntentBits.GuildMembers` doit être activé dans `src/index.js`.",
        );
    }

    if (SETTINGS.guildId && SETTINGS.guildId !== guild.id) {
        add(
            "warn",
            "GUILD_ID différent",
            `\`.env\` pointe sur ${SETTINGS.guildId} mais le bot regarde le serveur ${guild.id}.`,
        );
    }

    return finish(checks, describeInventory(guild, { withPaymentRoles }));
}

/**
 * Adds the checks that need a round-trip to Discord: the portal-side intents
 * (which never show up in the gateway data) and the ability to read members.
 */
export async function checkGuildLive(guild, client = null, options = {}) {
    const result = checkGuild(guild, client, options);
    const probe = await probeMemberIntent(guild);
    if (probe) result.checks.push(probe);
    return finish(result.checks, result.inventory);
}

export async function probeMemberIntent(guild) {
    if (typeof guild?.members?.fetch !== "function") return null;

    try {
        await guild.members.fetch({ limit: 1 });
        return {
            level: "ok",
            title: "Intent SERVER MEMBERS (portail)",
            detail: "Le bot peut lire la liste des membres.",
        };
    } catch (error) {
        return {
            level: "error",
            title: "Intent SERVER MEMBERS (portail)",
            detail: `Developer Portal → Bot → **Privileged Gateway Intents** → active SERVER MEMBERS INTENT (${error.message}).`,
        };
    }
}

function finish(checks, inventory) {
    return {
        checks,
        inventory,
        ok: !checks.some((check) => check.level === "error"),
    };
}

const ICONS = { ok: "✅", warn: "⚠️", error: "❌" };

/** Lines ready to be joined into an embed description. */
export function formatChecks({ checks, inventory }) {
    const lines = checks.map((check) => `${ICONS[check.level] ?? "•"} **${check.title}** — ${check.detail}`);

    if (inventory) {
        const { roles, categories, channels } = inventory;
        const done = roles.missing === 0 && categories.missing === 0 && channels.missing === 0;
        lines.push(
            "",
            done
                ? "✅ **Structure du serveur** — tout est déjà en place."
                : `🧱 **Structure du serveur** — il manque ${roles.missing} rôle(s), ${categories.missing} catégorie(s) et ${channels.missing} salon(s). Lance \`/setup\`.`,
        );
    }

    return lines;
}
