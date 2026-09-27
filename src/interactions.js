import { AttachmentBuilder } from "discord.js";

import { CURRENCY_CODES, TICKET_TYPES, serverByCode } from "../config.js";
import {
    closeReason,
    closeReasonRow,
    confirmRow,
    continueRow,
    marketModal,
    memberModeRow,
    memberSelectRow,
    moveStageRow,
    paymentSelectRow,
    renameModal,
    serverSelectRow,
    simpleModal,
} from "./components.js";
import { baseEmbed, errorEmbed, infoEmbed, successEmbed } from "./embeds.js";
import { isStaff } from "./guild-utils.js";
import { parseMillions, rateFor, formatMoney, formatMillions, quote } from "./market.js";
import { update } from "./store.js";
import { buildTranscript } from "./transcript.js";
import {
    claimTicket,
    closeTicket,
    grantAccess,
    openTicket,
    renameTicket,
    revokeAccess,
    setTicketStage,
    ticketByChannel,
} from "./tickets.js";
import { runCommand } from "./commands.js";

/* ───────────────────────── helpers ───────────────────────── */

async function respond(interaction, payload) {
    if (interaction.deferred) return interaction.editReply(payload);
    if (interaction.replied) return interaction.followUp({ ...payload, ephemeral: true });
    return interaction.reply({ ...payload, ephemeral: true });
}

async function needStaff(interaction) {
    if (isStaff(interaction.member)) return true;
    await respond(interaction, {
        embeds: [errorEmbed("Cette action est réservée au staff.", "🔒 Accès refusé")],
    });
    return false;
}

async function needTicket(interaction) {
    const ticket = ticketByChannel(interaction.channelId);
    if (ticket) return ticket;
    await respond(interaction, {
        embeds: [errorEmbed("Cette action doit être utilisée dans un ticket.", "🎟️ Hors ticket")],
    });
    return null;
}

/* ───────────────────────── entry point ───────────────────────── */

export async function handleInteraction(client, interaction) {
    try {
        if (interaction.isChatInputCommand()) return await runCommand(client, interaction);
        if (interaction.isButton()) return await handleButton(client, interaction);
        if (interaction.isStringSelectMenu()) return await handleSelect(client, interaction);
        if (interaction.isUserSelectMenu()) return await handleUserSelect(interaction);
        if (interaction.isModalSubmit()) return await handleModal(client, interaction);
        return undefined;
    } catch (error) {
        console.error("[interaction] unhandled error:", error);
        try {
            await respond(interaction, {
                embeds: [errorEmbed(`\`\`\`\n${String(error.message ?? error).slice(0, 1500)}\n\`\`\``)],
            });
        } catch {
            /* interaction already gone */
        }
        return undefined;
    }
}

/* ───────────────────────── buttons ───────────────────────── */

async function handleButton(client, interaction) {
    const [scope, ...rest] = interaction.customId.split(":");

    if (scope === "panel") return handlePanelButton(interaction, rest[0]);
    if (scope === "flow" && rest[0] === "go") return handleFlowGo(interaction, rest[1], rest[2], rest[3]);
    if (scope === "ticket") return handleTicketButton(client, interaction, rest);
    return undefined;
}

async function handlePanelButton(interaction, typeId) {
    const type = TICKET_TYPES[typeId];
    if (!type) {
        return respond(interaction, { embeds: [errorEmbed(`Type de ticket inconnu : \`${typeId}\``)] });
    }

    if (!type.needsDofus) {
        return interaction.showModal(simpleModal(typeId));
    }

    return respond(interaction, {
        embeds: [
            infoEmbed(
                `${type.emoji} **${type.label}**\n\n${type.blurb}\n\nChoisis d'abord ton serveur Dofus 👇`,
                "🌍 Première étape",
            ),
        ],
        components: [serverSelectRow(typeId)],
    });
}

async function handleFlowGo(interaction, typeId, serverCode, paymentCode) {
    if (!TICKET_TYPES[typeId]) {
        return respond(interaction, { embeds: [errorEmbed("Type de ticket inconnu.")] });
    }
    return interaction.showModal(marketModal(typeId, serverCode, paymentCode));
}

async function handleTicketButton(client, interaction, rest) {
    const [action, sub, extra] = rest;

    if (action === "claim") {
        if (!(await needStaff(interaction))) return undefined;
        const ticket = await needTicket(interaction);
        if (!ticket) return undefined;
        const { already } = await claimTicket({ channel: interaction.channel, ticket, member: interaction.member });
        return respond(interaction, {
            embeds: [
                already
                    ? infoEmbed(`Déjà pris en charge par <@${already}>.`, "🎯 Ticket")
                    : successEmbed(`<@${interaction.user.id}> prend en charge ce ticket.`, "🎯 Prise en charge"),
            ],
        });
    }

    if (action === "close") {
        if (sub === "reason") {
            const ticket = await needTicket(interaction);
            if (!ticket) return undefined;
            const reason = closeReason(interaction.values[0]);
            return interaction.update({
                embeds: [
                    infoEmbed(
                        `Fermer le ticket **#${ticket.number}** ?\nMotif retenu : **${reason?.label ?? "non précisé"}**\n\nLa transcription sera envoyée au staff et le salon sera supprimé.`,
                        "🔒 Confirmation",
                    ),
                ],
                components: [confirmRow("close", reason?.code ?? "autre")],
            });
        }

        if (sub === "yes") {
            if (!(await needStaff(interaction))) return undefined;
            const channelTicket = await needTicket(interaction);
            if (!channelTicket) return undefined;
            const reason = closeReason(extra) ?? closeReason("autre");
            await respond(interaction, {
                embeds: [infoEmbed("Fermeture en cours, génération de la transcription…", "⏳ Patience")],
            });
            await closeTicket({
                channel: interaction.channel,
                ticket: channelTicket,
                closedBy: interaction.user,
                reasonCode: reason.code,
                reasonLabel: reason.label,
                client,
            });
            return undefined;
        }

        if (sub === "no") {
            return interaction.update({
                embeds: [infoEmbed("Fermeture annulée.", "↩️ Annulé")],
                components: [],
            });
        }

        // Fresh close request.
        const ticket = await needTicket(interaction);
        if (!ticket) return undefined;
        return respond(interaction, {
            embeds: [infoEmbed("Pourquoi fermes-tu ce ticket ?", "🔒 Fermeture")],
            components: [closeReasonRow()],
        });
    }

    if (action === "move") {
        if (!(await needStaff(interaction))) return undefined;
        const ticket = await needTicket(interaction);
        if (!ticket) return undefined;
        return respond(interaction, {
            embeds: [infoEmbed(`Étape actuelle : **${ticket.stage}**`, "🗂️ Déplacer")],
            components: [moveStageRow()],
        });
    }

    if (action === "members") {
        if (!(await needStaff(interaction))) return undefined;
        if (!(await needTicket(interaction))) return undefined;
        return respond(interaction, {
            embeds: [infoEmbed("Ajoute ou retire des membres de ce ticket.", "👥 Accès")],
            components: [memberModeRow()],
        });
    }

    if (action === "member") {
        if (!(await needStaff(interaction))) return undefined;
        if (!sub) {
            return respond(interaction, {
                embeds: [infoEmbed("Ajoute ou retire des membres de ce ticket.", "👥 Accès")],
                components: [memberModeRow()],
            });
        }
        return interaction.update({
            embeds: [infoEmbed(sub === "add" ? "Qui ajouter ?" : "Qui retirer ?", "👥 Accès")],
            components: [memberSelectRow(sub)],
        });
    }

    if (action === "transcript") {
        const ticket = await needTicket(interaction);
        if (!ticket) return undefined;
        if (!isStaff(interaction.member) && interaction.user.id !== ticket.userId) {
            return respond(interaction, { embeds: [errorEmbed("Action réservée au staff ou au client du ticket.")] });
        }
        await interaction.deferReply({ ephemeral: true });
        const { html, count } = await buildTranscript(
            interaction.channel,
            {
                title: `Ticket ${TICKET_TYPES[ticket.type]?.label ?? ticket.type}`,
                number: ticket.number,
                type: ticket.type,
                userId: ticket.userId,
                userTag: ticket.userTag,
                closedByTag: interaction.user.tag,
                closedAt: new Date(),
            },
            { limit: 2000 },
        );
        return interaction.editReply({
            embeds: [successEmbed(`${count} message(s) archivés.`, "📄 Transcription")],
            files: [
                new AttachmentBuilder(Buffer.from(html, "utf8"), {
                    name: `${ticket.id}-transcript.html`,
                    description: `Transcription du ticket ${ticket.id}`,
                }),
            ],
        });
    }

    if (action === "rename") {
        if (!(await needStaff(interaction))) return undefined;
        return interaction.showModal(renameModal());
    }

    return undefined;
}

/* ───────────────────────── selects ───────────────────────── */

async function handleSelect(interaction) {
    const [scope, ...rest] = interaction.customId.split(":");

    if (scope === "flow" && rest[0] === "srv") {
        const typeId = rest[1];
        const serverCode = interaction.values[0];
        const type = TICKET_TYPES[typeId];
        if (!type) return respond(interaction, { embeds: [errorEmbed("Type de ticket inconnu.")] });

        const label = serverByCode(serverCode)?.name ?? serverCode;

        if (!type.needsPayment) {
            return interaction.update({
                embeds: [infoEmbed(`Serveur choisi : **${label}**`, "🌍 Étape suivante")],
                components: [continueRow(typeId, serverCode, "none")],
            });
        }

        return interaction.update({
            embeds: [infoEmbed(`Serveur choisi : **${label}**\n\nComment souhaites-tu être payé ?`, "💳 Étape suivante")],
            components: [paymentSelectRow(typeId, serverCode)],
        });
    }

    if (scope === "flow" && rest[0] === "pay") {
        const typeId = rest[1];
        const serverCode = rest[2];
        const paymentCode = interaction.values[0];
        const type = TICKET_TYPES[typeId];
        const rateKind = typeId === "achat" ? "buy" : typeId === "vente" ? "sell" : "exchange";
        const rate = rateFor("EUR", rateKind);
        return interaction.update({
            embeds: [
                baseEmbed({ color: type.color })
                    .setTitle(`${type.emoji}  Récapitulatif`)
                    .setDescription(
                        [
                            `**Serveur Dofus :** ${serverByCode(serverCode)?.name ?? serverCode}`,
                            `**Paiement :** ${paymentCode}`,
                            `**Taux indicatif (EUR) :** ${rate === null ? "à confirmer avec le staff" : `${formatMoney(rate, "EUR")}/M`}`,
                            "",
                            "Clique sur le bouton pour décrire ta demande — le staff arrive juste après 👇",
                        ].join("\n"),
                    ),
            ],
            components: [continueRow(typeId, serverCode, paymentCode)],
        });
    }

    if (scope === "ticket" && rest[0] === "move") {
        if (!(await needStaff(interaction))) return undefined;
        const ticket = await needTicket(interaction);
        if (!ticket) return undefined;
        const stageId = interaction.values[0];
        await setTicketStage({ channel: interaction.channel, ticket, stageId });
        return interaction.update({
            embeds: [successEmbed(`Ticket déplacé vers **${stageId}**.`, "🗂️ Étape mise à jour")],
            components: [],
        });
    }

    if (scope === "ticket" && rest[0] === "close") {
        const ticket = await needTicket(interaction);
        if (!ticket) return undefined;
        const reason = closeReason(interaction.values[0]);
        return interaction.update({
            embeds: [
                infoEmbed(
                    `Fermer le ticket **#${ticket.number}** ?\nMotif retenu : **${reason?.label ?? "non précisé"}**`,
                    "🔒 Confirmation",
                ),
            ],
            components: [confirmRow("close", reason?.code ?? "autre")],
        });
    }

    return undefined;
}

async function handleUserSelect(interaction) {
    const [scope, , action, mode] = interaction.customId.split(":");

    if (scope === "ticket" && action === "do") {
        if (!(await needStaff(interaction))) return undefined;
        if (!(await needTicket(interaction))) return undefined;
        const members = await Promise.all(
            interaction.values.map((id) => interaction.guild.members.fetch(id).catch(() => null)),
        );
        for (const member of members.filter(Boolean)) {
            if (mode === "add") await grantAccess({ channel: interaction.channel, member, actor: interaction.user });
            else await revokeAccess({ channel: interaction.channel, member, actor: interaction.user });
        }
        return interaction.update({
            embeds: [
                successEmbed(
                    `${members.filter(Boolean).length} membre(s) ${mode === "add" ? "ajouté(s) à" : "retiré(s) de"} ce ticket.`,
                    "👥 Accès mis à jour",
                ),
            ],
            components: [],
        });
    }

    return undefined;
}

/* ───────────────────────── modals ───────────────────────── */

async function handleModal(client, interaction) {
    const [scope, ...rest] = interaction.customId.split(":");

    if (scope === "modal" && rest[0] === "market") {
        const [, , typeId, serverCode, paymentCode] = [scope, ...rest];
        return createTicketFromModal(interaction, typeId, serverCode, paymentCode);
    }

    if (scope === "modal" && rest[0] === "simple") {
        const typeId = rest[1];
        return createTicketFromModal(interaction, typeId, null, null);
    }

    if (scope === "modal" && rest[0] === "rename") {
        if (!(await needStaff(interaction))) return undefined;
        const ticket = await needTicket(interaction);
        if (!ticket) return undefined;
        const name = interaction.fields.getTextInputValue("name");
        const finalName = await renameTicket({ channel: interaction.channel, ticket, name });
        return respond(interaction, {
            embeds: [successEmbed(`Ticket renommé en \`${finalName}\`.`, "✏️ Renommé")],
        });
    }

    if (scope === "modal" && rest[0] === "review") {
        const ratingRaw = Number.parseInt(interaction.fields.getTextInputValue("rating"), 10);
        const text = interaction.fields.getTextInputValue("text").trim();
        const rating = Math.min(5, Math.max(1, Number.isFinite(ratingRaw) ? ratingRaw : 5));

        await interaction.deferReply({ ephemeral: true });

        const { reviewEmbed } = await import("./embeds.js");
        const channel =
            interaction.guild.channels.cache.find((c) => /avis|review/i.test(c.name)) ?? interaction.channel;

        const entry = {
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            rating,
            text,
            at: new Date().toISOString(),
        };

        await channel.send({
            embeds: [
                reviewEmbed({
                    author: { tag: interaction.user.tag, displayAvatarURL: () => interaction.user.displayAvatarURL() },
                    rating,
                    text,
                    kindLabelText: "Commande vérifiée",
                }),
            ],
        });

        update("reviews.json", (data) => {
            data.entries = [entry, ...(data.entries ?? [])].slice(0, 5000);
            return entry;
        });

        return interaction.editReply({
            embeds: [successEmbed("Merci pour ton avis ! 💛", "⭐ Avis publié")],
        });
    }

    return undefined;
}

async function createTicketFromModal(interaction, typeId, serverCode, paymentCode) {
    const type = TICKET_TYPES[typeId];
    if (!type) return respond(interaction, { embeds: [errorEmbed("Type de ticket inconnu.")] });

    const payload = { serverCode, paymentCode };

    if (type.needsQuantity) {
        const millions = parseMillions(interaction.fields.getTextInputValue("millions"));
        if (millions === null) {
            return respond(interaction, {
                embeds: [
                    errorEmbed(
                        "Quantité invalide. Utilise un nombre de millions, ex : `50` ou `12.5` (ou `1200k`).",
                    ),
                ],
            });
        }
        payload.millions = millions;

        const currency = interaction.fields.getTextInputValue("currency").trim().toUpperCase();
        if (!CURRENCY_CODES.includes(currency)) {
            return respond(interaction, {
                embeds: [
                    errorEmbed(`Devise inconnue \`${currency}\`. Devises acceptées : ${CURRENCY_CODES.join(", ")}.`),
                ],
            });
        }
        payload.currency = currency;
        payload.personnage = interaction.fields.getTextInputValue("personnage").trim();
        const notes = interaction.fields.getTextInputValue("notes").trim();
        if (notes) payload.notes = notes;

        const rateKind = typeId === "achat" ? "buy" : typeId === "vente" ? "sell" : "exchange";
        const rate = rateFor(currency, rateKind);
        const q = quote(rateKind, millions, rate);
        if (q) payload.totalPreview = q.total;
    } else {
        payload.subject = interaction.fields.getTextInputValue("subject").trim();
        payload.notes = interaction.fields.getTextInputValue("details").trim();
        const reference = interaction.fields.getTextInputValue("reference").trim();
        if (reference) payload.notes += `\n\nRéférence : ${reference}`;
    }

    await interaction.deferReply({ ephemeral: true });

    const result = await openTicket({
        guild: interaction.guild,
        member: interaction.member,
        typeId,
        payload,
    });

    if (result.duplicate) {
        return interaction.editReply({
            embeds: [
                infoEmbed(
                    `Tu as déjà un ticket ouvert : <#${result.duplicate.channelId}>\nFerme-le avant d'en ouvrir un nouveau.`,
                    "⚠️ Ticket existant",
                ),
            ],
        });
    }

    const { ticket, channel } = result;
    const summary =
        type.needsQuantity && payload.millions
            ? `\n**${formatMillions(payload.millions)}** • ${payload.currency} • ${serverByCode(serverCode)?.name ?? ""}` +
              (payload.totalPreview ? `\nTotal estimé : **${formatMoney(payload.totalPreview, payload.currency)}**` : "")
            : "";

    return interaction.editReply({
        embeds: [
            successEmbed(`${type.emoji} Ton ticket est ouvert : ${channel}${summary}`, `✅ Ticket #${ticket.number}`),
        ],
    });
}
