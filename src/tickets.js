import { AttachmentBuilder, ChannelType, PermissionFlagsBits } from "discord.js";

import { BRAND, SETTINGS, TICKET_STAGES, TICKET_TYPES, serverByCode } from "../config.js";
import { infoEmbed, reviewRequestEmbed, ticketClosedEmbed, ticketIntroEmbed } from "./embeds.js";
import { ensureCategory, logChannel, staffRole, transcriptChannel } from "./guild-utils.js";
import { quote, effectiveRate } from "./market.js";
import { refreshAdminPanelSoon } from "./admin-panel.js";
import { TICKET_LOCK_HOURS } from "./price-lock.js";
import { read, update } from "./store.js";
import { reviewButtonRow, ticketActionRow } from "./components.js";
import { buildTranscript } from "./transcript.js";

const RATE_KIND_BY_TYPE = { achat: "buy", vente: "sell", echange: "exchange" };

const ticketsFile = () => read("tickets.json");

export const ticketByChannel = (channelId) => ticketsFile().open?.[channelId] ?? null;

export const closedTicketById = (id) => (ticketsFile().closed ?? []).find((ticket) => ticket.id === id) ?? null;

/** A review already left for this ticket, if any: one review per delivered ticket. */
export const reviewForTicket = (id) => (read("reviews.json").entries ?? []).find((entry) => entry.ticketId === id) ?? null;

export const openTicketsFor = (guildId, userId) =>
    Object.values(ticketsFile().open ?? {}).filter(
        (ticket) => ticket.guildId === guildId && ticket.userId === userId && ticket.status === "open",
    );

export const allOpenTickets = (guildId) =>
    Object.values(ticketsFile().open ?? {}).filter((ticket) => ticket.guildId === guildId);

function saveTicket(ticket) {
    update("tickets.json", (data) => {
        data.open[ticket.channelId] = ticket;
        return ticket;
    });
    return ticket;
}

function nextNumber() {
    return update("tickets.json", (data) => {
        data.counter = (data.counter ?? 0) + 1;
        return data.counter;
    });
}

async function uniqueChannelName(guild, base) {
    let name = base;
    let attempt = 1;
    while (guild.channels.cache.some((channel) => channel.name === name)) {
        attempt += 1;
        name = `${base}-${attempt}`;
    }
    return name;
}

/** Category a ticket starts in; falls back to creating it. */
export async function stageCategory(guild, stageId = "nouveau") {
    const stage = TICKET_STAGES.find((s) => s.id === stageId) ?? TICKET_STAGES[0];
    return ensureCategory(guild, stage.name);
}

/**
 * Create a private ticket channel for a member.
 * Returns `{ duplicate }` when the member already has an open ticket.
 */
export async function openTicket({ guild, member, typeId, payload = {} }) {
    const type = TICKET_TYPES[typeId];
    if (!type) throw new Error(`Unknown ticket type: ${typeId}`);

    const own = openTicketsFor(guild.id, member.id);
    if (!payload.force && own.length >= SETTINGS.maxOpenPerUser) {
        return { duplicate: own[0] };
    }

    const number = nextNumber();
    const id = `${typeId}-${String(number).padStart(5, "0")}`;
    const channelName = await uniqueChannelName(guild, id);

    const staff = staffRole(guild);
    const parent = await stageCategory(guild, "nouveau");

    const overwrites = [
        {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
        },
        {
            id: member.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
            ],
        },
        {
            id: guild.members.me.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
            ],
        },
    ];
    if (staff) {
        overwrites.push({
            id: staff.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
            ],
        });
    }

    const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: parent?.id,
        topic: `${type.label} • ${member.user.tag} • ${id}`,
        permissionOverwrites: overwrites,
    });

    const rateKind = RATE_KIND_BY_TYPE[typeId] ?? null;
    const currency = payload.currency ? String(payload.currency).toUpperCase() : type.needsPayment ? "EUR" : null;
    const millions = payload.millions ?? null;
    // Prix spécifique au serveur choisi (taux de base × multiplicateur).
    const rate =
        payload.rate !== undefined && payload.rate !== null
            ? payload.rate
            : currency && rateKind
              ? effectiveRate(currency, rateKind, payload.serverCode)
              : null;
    const priceLockedUntil =
        rate !== null && (rateKind === "buy" || rateKind === "sell")
            ? new Date(Date.now() + TICKET_LOCK_HOURS * 3_600_000).toISOString()
            : null;
    const total = quote(rateKind, millions, rate)?.total ?? null;

    const ticket = {
        id,
        number,
        type: typeId,
        guildId: guild.id,
        channelId: channel.id,
        userId: member.id,
        userTag: member.user.tag,
        status: "open",
        stage: "nouveau",
        stageCategoryId: parent?.id ?? null,
        rateKind,
        currency,
        millions,
        rate,
        total,
        priceLockedUntil,
        offerId: payload.offerId ?? null,
        serverCode: payload.serverCode ?? null,
        transferFrom: payload.transferFrom ?? null,
        transferTo: payload.transferTo ?? null,
        received: payload.received ?? null,
        exchangeFee: payload.exchangeFee ?? null,
        paymentCode: payload.paymentCode ?? null,
        personnage: payload.personnage ?? null,
        subject: payload.subject ?? null,
        notes: payload.notes ?? null,
        openedAt: new Date().toISOString(),
        claimedBy: null,
        claimedAt: null,
        closedAt: null,
    };

    const embed = ticketIntroEmbed(ticket, member, type);
    const message = await channel.send({
        content: staff ? `${member} • <@&${staff.id}>` : `${member}`,
        embeds: [embed],
        components: [ticketActionRow()],
    });

    ticket.messageId = message.id;
    saveTicket(ticket);

    const log = logChannel(guild);
    if (log) {
        log.send({
            embeds: [
                infoEmbed(
                    `🎟️ **${type.label}** ouvert par ${member.user.tag}\nSalon : ${channel}\nServeur : **${serverByCode(ticket.serverCode)?.name ?? "—"}** • Quantité : **${ticket.millions ?? "—"} M** • Devise : **${ticket.currency ?? "—"}**`,
                    `Nouveau ticket #${ticket.number}`,
                ),
            ],
        }).catch(() => {});
    }

    refreshAdminPanelSoon(guild.client);
    return { ticket, channel };
}

/** Mark a ticket as claimed by a staff member and grey out the claim button. */
export async function claimTicket({ channel, ticket, member }) {
    if (ticket.claimedBy) return { already: ticket.claimedBy };

    ticket.claimedBy = member.id;
    ticket.claimedByTag = member.user.tag;
    ticket.claimedAt = new Date().toISOString();
    saveTicket(ticket);

    if (ticket.messageId) {
        const message = await channel.messages.fetch(ticket.messageId).catch(() => null);
        if (message) {
            await message
                .edit({ components: [ticketActionRow({ claimed: true })] })
                .catch(() => {});
        }
    }

    return { ticket };
}

export async function setTicketStage({ channel, ticket, stageId }) {
    const category = await stageCategory(channel.guild, stageId);
    await channel.setParent(category?.id ?? null, { lockPermissions: false });
    ticket.stage = stageId;
    ticket.stageCategoryId = category?.id ?? null;
    saveTicket(ticket);
    return ticket;
}

export async function renameTicket({ channel, ticket, name }) {
    const cleaned = String(name)
        .toLowerCase()
        .replace(/[^a-z0-9\u00e0-\u00ff\u0600-\u06ff-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 90);
    if (!cleaned) throw new Error("Nom invalide");

    const finalName = await uniqueChannelName(channel.guild, cleaned);
    await channel.setName(finalName);
    ticket.name = finalName;
    saveTicket(ticket);
    return finalName;
}

export async function grantAccess({ channel, member, actor }) {
    await channel.permissionOverwrites.edit(member.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
    });
    ticketAccessNote(channel, `➕ ${member} a été ajouté au ticket par ${actor}.`);
}

export async function revokeAccess({ channel, member, actor }) {
    await channel.permissionOverwrites.delete(member.id, { reason: `Retiré par ${actor.tag}` });
    ticketAccessNote(channel, `➖ ${member} a été retiré du ticket par ${actor}.`);
}

function ticketAccessNote(channel, text) {
    channel.send({ embeds: [infoEmbed(text)] }).catch(() => {});
}

/**
 * Close a ticket: transcript → staff channel, DM the client, then archive or delete.
 */
export async function closeTicket({ channel, ticket, closedBy, reasonCode, reasonLabel, client }) {
    const guild = channel.guild;
    const type = TICKET_TYPES[ticket.type] ?? TICKET_TYPES.support;
    const reason = reasonLabel ?? null;

    let transcriptFile = null;
    let transcriptCount = 0;
    try {
        const { html, count } = await buildTranscript(
            channel,
            {
                title: `Ticket ${type.label}`,
                number: ticket.number,
                type: type.label,
                userId: ticket.userId,
                userTag: ticket.userTag,
                closedByTag: closedBy.tag,
                closedAt: new Date(),
            },
            { limit: 2000 },
        );
        transcriptCount = count;
        transcriptFile = new AttachmentBuilder(Buffer.from(html, "utf8"), {
            name: `${ticket.id}-transcript.html`,
            description: `Transcription du ticket ${ticket.id}`,
        });
    } catch (error) {
        console.error("[ticket] transcript failed:", error);
    }

    const target = transcriptChannel(guild);
    if (target && transcriptFile) {
        await target
            .send({
                embeds: [
                    infoEmbed(
                        [
                            `**Ticket :** #${ticket.number} (\`${ticket.id}\`)`,
                            `**Type :** ${type.label}`,
                            `**Client :** <@${ticket.userId}> (\`${ticket.userTag}\`)`,
                            `**Pris en charge par :** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : "personne"}`,
                            `**Fermé par :** ${closedBy}`,
                            `**Motif :** ${reason ?? "non précisé"}`,
                            `**Messages :** ${transcriptCount}`,
                        ].join("\n"),
                        `📄 Transcript • ticket #${ticket.number}`,
                    ),
                ],
                files: [transcriptFile],
            })
            .catch((error) => console.error("[ticket] transcript post failed:", error));
    }

    // Delivered: the customer gets a button to review this order (the only way to review).
    if (reasonCode === "livre") {
        const request = { embeds: [reviewRequestEmbed(ticket, type)], components: [reviewButtonRow(ticket.id)] };
        const user = await client.users.fetch(ticket.userId).catch(() => null);
        const sent = user ? await user.send(request).catch(() => null) : null;
        if (!sent) {
            // DMs closed: an archived ticket keeps the customer's access, so the button can live there.
            const kept = SETTINGS.closeAction === "archive";
            if (kept) await channel.send({ content: `<@${ticket.userId}>`, ...request }).catch(() => {});
            const where = kept ? `demande d'avis laissée dans le ticket #${ticket.number}` : "demande d'avis non reçue";
            logChannel(guild)
                ?.send({ embeds: [infoEmbed(`⭐ MP fermés pour <@${ticket.userId}> : ${where}.`)] })
                .catch(() => {});
        }
    }

    ticket.status = "closed";
    ticket.closedAt = new Date().toISOString();
    ticket.closedBy = closedBy.id;
    ticket.closedByTag = closedBy.tag;
    ticket.reason = reasonCode ?? null;

    update("tickets.json", (data) => {
        delete data.open[ticket.channelId];
        data.closed = [ticket, ...(data.closed ?? [])].slice(0, 2000);
        return ticket;
    });
    refreshAdminPanelSoon(channel.client);

    await channel
        .send({ embeds: [ticketClosedEmbed({ user: `<@${ticket.userId}>`, closedBy, reason })] })
        .catch(() => {});

    if (SETTINGS.closeAction === "archive") {
        await setTicketStage({ channel, ticket, stageId: "archive" }).catch(() => {});
        await channel.permissionOverwrites
            .edit(guild.roles.everyone.id, { ViewChannel: false, SendMessages: false })
            .catch(() => {});
    } else {
        setTimeout(() => {
            channel.delete(`Ticket fermé par ${closedBy.tag}`).catch(() => {});
        }, 5000);
    }

    return { transcriptCount };
}

export function ticketStats(guildId) {
    const data = ticketsFile();
    const open = allOpenTickets(guildId);
    const closed = (data.closed ?? []).filter((t) => t.guildId === guildId);
    const byType = {};
    for (const ticket of [...open, ...closed]) {
        byType[ticket.type] = (byType[ticket.type] ?? 0) + 1;
    }
    return { openCount: open.length, closedCount: closed.length, byType, total: data.counter ?? 0 };
}
