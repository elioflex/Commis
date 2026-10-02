import { ChannelType } from "discord.js";

import { LAYOUT, PAYMENT_METHODS, ROLES, SETTINGS, TICKET_STAGES } from "../config.js";
import { panelRows } from "./components.js";
import { panelEmbed } from "./embeds.js";
import { ensureCategory, findTextChannel, sleep, staffOverwrites } from "./guild-utils.js";
import { update } from "./store.js";

const normalize = (name) => name.trim().toLowerCase();

const roleExists = (guild, name) => guild.roles.cache.some((role) => normalize(role.name) === normalize(name));

function channelExists(guild, name) {
    return guild.channels.cache.some((channel) => normalize(channel.name) === normalize(name));
}

/** Cosmetic roles so members can show which payment methods they use. */
export const paymentRoleDefinitions = () =>
    PAYMENT_METHODS.filter((method) => method.code !== "autre").map((method) => ({
        name: method.label,
        color: 0x2b2d31,
        hoist: false,
    }));

/** Every role `/setup` is supposed to end up with. */
export const plannedRoles = ({ withPaymentRoles = false } = {}) =>
    withPaymentRoles ? [...ROLES, ...paymentRoleDefinitions()] : ROLES;

/**
 * Create every role, category and channel the marketplace needs.
 * Safe to run repeatedly: existing roles/channels are left untouched.
 */
export async function setupGuild(
    guild,
    { skipRoles = false, dryRun = false, postPanels = true, withPaymentRoles = false } = {},
) {
    const report = {
        rolesCreated: [],
        rolesSkipped: [],
        categoriesCreated: [],
        categoriesSkipped: [],
        channelsCreated: [],
        channelsSkipped: [],
        panelsPosted: [],
        staffRoleId: null,
        managerRoleId: null,
        logChannelId: null,
        transcriptChannelId: null,
    };

    // Refresh the caches first: both checks below are name-based, and a stale
    // cache would happily create duplicates on a re-run after a partial setup.
    if (!dryRun) {
        await guild.roles.fetch().catch(() => null);
        await guild.channels.fetch().catch(() => null);
    }

    /* ── roles ── */
    for (const definition of plannedRoles({ withPaymentRoles })) {
        if (roleExists(guild, definition.name)) {
            report.rolesSkipped.push(definition.name);
            continue;
        }
        if (skipRoles || dryRun) {
            report.rolesCreated.push(`${definition.name} (prévu)`);
            continue;
        }
        await guild.roles
            .create({
                name: definition.name,
                // discord.js ≥ 14.16 expects `colors`, not the deprecated `color`.
                colors: { primaryColor: definition.color },
                hoist: definition.hoist,
                mentionable: definition.hoist,
                reason: "Setup marketplace",
            })
            .catch((error) => console.error(`[setup] role ${definition.name}:`, error.message));
        report.rolesCreated.push(definition.name);
        await sleep(SETTINGS.setupStepDelayMs);
    }

    if (!dryRun) await guild.roles.fetch();

    /* ── ticket stage categories ── */
    for (const stage of TICKET_STAGES) {
        if (dryRun) {
            report.categoriesCreated.push(`${stage.name} (prévu)`);
            continue;
        }
        const before = guild.channels.cache.size;
        const category = await ensureCategory(guild, stage.name).catch(() => null);
        if (category && guild.channels.cache.size === before) report.categoriesSkipped.push(stage.name);
        else report.categoriesCreated.push(stage.name);
        await sleep(SETTINGS.setupStepDelayMs);
    }

    /* ── layout ── */
    for (const block of LAYOUT) {
        let category;
        const existed = guild.channels.cache.some(
            (channel) => channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalize(block.name),
        );

        if (existed) {
            report.categoriesSkipped.push(block.name);
            category = guild.channels.cache.find(
                (channel) =>
                    channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalize(block.name),
            );
        } else if (dryRun) {
            report.categoriesCreated.push(`${block.name} (prévu)`);
        } else {
            category = await ensureCategory(guild, block.name, { staffOnly: Boolean(block.staffOnly) }).catch(
                (error) => {
                    console.error(`[setup] category ${block.name}:`, error.message);
                    return null;
                },
            );
            if (category) report.categoriesCreated.push(block.name);
            await sleep(SETTINGS.setupStepDelayMs);
        }

        for (const definition of block.channels) {
            if (channelExists(guild, definition.name)) {
                report.channelsSkipped.push(definition.name);
                continue;
            }
            if (dryRun) {
                report.channelsCreated.push(`${definition.name} (prévu)`);
                continue;
            }

            const isVoice = definition.type === "voice";

            const created = await guild.channels
                .create({
                    name: definition.name,
                    type: isVoice ? ChannelType.GuildVoice : ChannelType.GuildText,
                    parent: category?.id,
                    topic: isVoice ? undefined : definition.topic,
                    permissionOverwrites: block.staffOnly ? staffOverwrites(guild) : undefined,
                    reason: "Setup marketplace",
                })
                .catch((error) => {
                    console.error(`[setup] channel ${definition.name}:`, error.message);
                    return null;
                });

            if (created) {
                report.channelsCreated.push(definition.name);

                if (definition.panel && postPanels && created.isTextBased()) {
                    const message = await created
                        .send({
                            embeds: [panelEmbed(definition.panel)],
                            components: panelRows(definition.panel),
                        })
                        .catch(() => null);
                    if (message) {
                        report.panelsPosted.push(definition.panel);
                        update("panels.json", (data) => {
                            data.posted[definition.panel] = {
                                channelId: created.id,
                                messageId: message.id,
                                at: new Date().toISOString(),
                            };
                            return true;
                        });
                    }
                }
            }
            await sleep(SETTINGS.setupStepDelayMs);
        }
    }

    if (!dryRun) await guild.channels.fetch();

    const staff = guild.roles.cache.find((role) => normalize(role.name) === "staff");
    report.staffRoleId = staff?.id ?? null;
    report.managerRoleId = guild.roles.cache.find((role) => normalize(role.name) === "manager")?.id ?? null;
    report.logChannelId = findTextChannel(guild, "🤖・logs")?.id ?? null;
    report.transcriptChannelId = findTextChannel(guild, "📄・transcripts")?.id ?? null;

    return report;
}
