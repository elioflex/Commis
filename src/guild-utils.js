import { ChannelType, PermissionFlagsBits } from "discord.js";

import { SETTINGS } from "../config.js";

/** The staff role: resolved by id first, then by name, then null. */
export function staffRole(guild) {
    if (SETTINGS.staffRoleId) {
        const byId = guild.roles.cache.get(SETTINGS.staffRoleId);
        if (byId) return byId;
    }
    return (
        guild.roles.cache.find((role) => role.name.toLowerCase() === SETTINGS.staffRoleName.toLowerCase()) ??
        guild.roles.cache.find((role) => role.name.toLowerCase().includes("staff")) ??
        null
    );
}

export function managerRole(guild) {
    if (SETTINGS.managerRoleId) {
        const byId = guild.roles.cache.get(SETTINGS.managerRoleId);
        if (byId) return byId;
    }
    return guild.roles.cache.find((role) => /manager|admin/i.test(role.name)) ?? null;
}

const normalize = (name) => name.trim().toLowerCase();

export function findCategory(guild, name) {
    return guild.channels.cache.find(
        (channel) => channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalize(name),
    );
}

export function findTextChannel(guild, name) {
    return guild.channels.cache.find(
        (channel) => normalize(channel.name) === normalize(name) && channel.isTextBased(),
    );
}

const STAFF_ONLY_KEYS = [
    "ViewChannel",
    "SendMessages",
    "ReadMessageHistory",
    "ManageChannels",
    "AttachFiles",
    "EmbedLinks",
];

const staffAllow = () => STAFF_ONLY_KEYS.map((key) => PermissionFlagsBits[key]);

/**
 * Overwrites for a staff-only channel.
 *
 * The bot is *not* in the Staff role, and "Manage Channels" does not bypass a
 * ViewChannel deny — so without its own explicit allow the bot could not read
 * its logs, its transcripts or the channel holding the state snapshot.
 */
export function staffOverwrites(guild) {
    const staff = staffRole(guild);
    const overwrites = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];

    if (staff) overwrites.push({ id: staff.id, allow: staffAllow() });

    const me = guild.members?.me;
    if (me) overwrites.push({ id: me.id, allow: staffAllow() });

    return overwrites;
}

export async function ensureCategory(guild, name, { staffOnly = false } = {}) {
    const existing = findCategory(guild, name);
    if (existing) return existing;

    return guild.channels.create({
        name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: staffOnly ? staffOverwrites(guild) : undefined,
    });
}

/** Where customers' price offers land for the staff (falls back to the logs). */
export function offersChannel(guild) {
    return findTextChannel(guild, "💼・offres") ?? findTextChannel(guild, "offres") ?? logChannel(guild);
}

/** The channel where the bot writes logs (setup result, ticket openings, errors). */
export function logChannel(guild) {
    if (SETTINGS.logChannelId) {
        const byId = guild.channels.cache.get(SETTINGS.logChannelId);
        if (byId) return byId;
    }
    return findTextChannel(guild, "🤖・logs") ?? findTextChannel(guild, "logs") ?? null;
}

/**
 * The private staff channel that holds the state snapshot (see `persist.js`).
 * Resolved by id, then by name, then it falls back to the log channel.
 */
export function findStateChannel(guild) {
    if (SETTINGS.stateChannelId) {
        const byId = guild.channels.cache.get(SETTINGS.stateChannelId);
        if (byId) return byId;
    }
    return (
        findTextChannel(guild, "⚙️・gestion") ??
        findTextChannel(guild, "gestion") ??
        findTextChannel(guild, "💾・sauvegardes") ??
        logChannel(guild)
    );
}

/** The channel that receives closed-ticket transcripts. */
export function transcriptChannel(guild) {
    if (SETTINGS.transcriptChannelId) {
        const byId = guild.channels.cache.get(SETTINGS.transcriptChannelId);
        if (byId) return byId;
    }
    return (
        findTextChannel(guild, "📄・transcripts") ??
        findTextChannel(guild, "transcripts") ??
        logChannel(guild)
    );
}

/** Is this member part of the staff? */
export function isStaff(member) {
    if (!member) return false;
    if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    const staff = staffRole(member.guild);
    return Boolean(staff && member.roles.cache.has(staff.id));
}

export function isManager(member) {
    if (!member) return false;
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
    const manager = managerRole(member.guild);
    return Boolean(manager && member.roles.cache.has(manager.id));
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
