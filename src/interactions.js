import { AttachmentBuilder, MessageFlags } from "discord.js";

import { CURRENCY_CODES, TICKET_TYPES, paymentByCode, serverByCode, serverLabel } from "../config.js";
import {
    closeReason,
    closeReasonRow,
    confirmRow,
    continueRow,
    exchangeContinueRow,
    exchangeDestinationRow,
    exchangeModal,
    exchangeSimModal,
    exchangeSourceRow,
    marketModal,
    memberModeRow,
    memberSelectRow,
    moveStageRow,
    paymentSelectRow,
    renameModal,
    reviewButtonRow,
    reviewModal,
    serverSelectRow,
    simpleModal,
} from "./components.js";
import { baseEmbed, errorEmbed, exchangeRecapEmbed, exchangeSimEmbed, infoEmbed, onOrderLine, reviewEmbed, successEmbed } from "./embeds.js";
import { isManager, isStaff } from "./guild-utils.js";
import { refreshMarketDisplays } from "./live-board.js";
import {
    parseMillions,
    effectiveRate,
    exchangeQuote,
    formatMoney,
    formatMillions,
    parsePriceTable,
    quote,
    serverPriceSummary,
    stockFor,
    setServerPrice,
} from "./market.js";

import { update } from "./store.js";
import { buildTranscript } from "./transcript.js";
import {
    claimTicket,
    closeTicket,
    closedTicketById,
    grantAccess,
    openTicket,
    renameTicket,
    reviewForTicket,
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
        if (interaction.isStringSelectMenu()) return await handleSelect(interaction);
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
    if (scope === "xchg" && rest[0] === "go") return interaction.showModal(exchangeModal(rest[1], rest[2], rest[3]));
    if (scope === "xchg" && rest[0] === "restart") return interaction.update(exchangeStart());
    if (scope === "xchg" && rest[0] === "sim") {
        // From the public panel: new ephemeral reply. From a simulation result: start over in place.
        const fromPanel = !interaction.message?.flags?.has(MessageFlags.Ephemeral);
        return fromPanel ? respond(interaction, exchangeStart("sim")) : interaction.update(exchangeStart("sim"));
    }
    if (scope === "ticket") return handleTicketButton(client, interaction, rest);
    if (scope === "review" && rest[0] === "open") return openReview(interaction, rest[1]);
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

    if (typeId === "echange") return respond(interaction, exchangeStart());

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

/** Exchange step 1: pick the server the customer gives kamas on. */
function exchangeStart(mode = "ticket") {
    const type = TICKET_TYPES.echange;
    const intro = mode === "sim" ? "🧮 **Simulation d'échange**, sans engagement." : `${type.emoji} **${type.label}**\n\n${type.blurb}`;
    return {
        embeds: [infoEmbed(`${intro}\n\n**1.** Sur quel serveur tu **donnes** tes kamas ? 👇`, "📤 Serveur source")],
        components: [exchangeSourceRow(mode)],
    };
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

        const label = serverLabel(serverByCode(serverCode)) || serverCode;
        const kind = typeId === "achat" ? "buy" : typeId === "vente" ? "sell" : "exchange";
        const rate = effectiveRate("EUR", kind, serverCode);
        const priceLine =
            rate === null
                ? "Taux : à confirmer avec le staff"
                : `Prix sur ce serveur (par M) : **${serverPriceSummary(kind, serverCode)}**`;

        if (!type.needsPayment) {
            return interaction.update({
                embeds: [infoEmbed(`Serveur choisi : **${label}**\n${priceLine}`, "🌍 Étape suivante")],
                components: [continueRow(typeId, serverCode, "none")],
            });
        }

        return interaction.update({
            embeds: [infoEmbed(`Serveur choisi : **${label}**\n${priceLine}\n\nComment souhaites-tu être payé ?`, "💳 Étape suivante")],
            components: [paymentSelectRow(typeId, serverCode)],
        });
    }

    if (scope === "xchg" && rest[0] === "from") {
        const mode = rest[1] === "sim" ? "sim" : "ticket";
        const fromCode = interaction.values[0];
        const name = serverLabel(serverByCode(fromCode)) || fromCode;
        return interaction.update({
            embeds: [
                infoEmbed(
                    `📤 Tu donnes sur : **${name}**\n\n**2.** Sur quel serveur tu veux **recevoir** tes kamas ? 👇`,
                    "📥 Serveur destination",
                ),
            ],
            components: [exchangeDestinationRow(fromCode, mode)],
        });
    }

    if (scope === "xchg" && rest[0] === "to") {
        const [, mode, fromCode] = rest;
        const toCode = interaction.values[0];
        if (mode === "sim") return interaction.showModal(exchangeSimModal(fromCode, toCode));
        return interaction.update({
            embeds: [exchangeRecapEmbed(fromCode, toCode)],
            components: [exchangeContinueRow(fromCode, toCode)],
        });
    }

    if (scope === "flow" && rest[0] === "pay") {
        const typeId = rest[1];
        const serverCode = rest[2];
        const paymentCode = interaction.values[0];
        const type = TICKET_TYPES[typeId];
        const rateKind = typeId === "achat" ? "buy" : typeId === "vente" ? "sell" : "exchange";
        const rate = effectiveRate("EUR", rateKind, serverCode);
        const paymentLabel = paymentByCode(paymentCode);
        return interaction.update({
            embeds: [
                baseEmbed({ color: type.color })
                    .setTitle(`${type.emoji}  Récapitulatif`)
                    .setDescription(
                        [
                            `**Serveur Dofus :** ${serverLabel(serverByCode(serverCode)) || serverCode}`,
                            `**Paiement :** ${paymentLabel.emoji} ${paymentLabel.label}`,
                            `**Taux sur ce serveur (EUR) :** ${rate === null ? "à confirmer avec le staff" : `${formatMoney(rate, "EUR")}/M`}`,
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

    if (scope === "modal" && rest[0] === "xchgsim") {
        const [, fromCode, toCode] = rest;
        const given = parseMillions(interaction.fields.getTextInputValue("millions"));
        if (given === null || !serverByCode(fromCode) || !serverByCode(toCode)) {
            return respond(interaction, {
                embeds: [errorEmbed("Quantité invalide. Utilise un nombre de millions, ex : `1000` ou `12.5` (ou `1200k`).")],
            });
        }
        const result = { embeds: [exchangeSimEmbed(fromCode, toCode, given)], components: [exchangeContinueRow(fromCode, toCode, given)] };
        return interaction.isFromMessage() ? interaction.update(result) : respond(interaction, result);
    }

    if (scope === "modal" && rest[0] === "xchg") {
        return createExchangeTicket(interaction, rest[1], rest[2]);
    }

    if (scope === "modal" && rest[0] === "simple") {
        const typeId = rest[1];
        return createTicketFromModal(interaction, typeId, null, null);
    }

    if (scope === "modal" && rest[0] === "prices") {
        if (!isManager(interaction.member)) {
            return respond(interaction, { embeds: [errorEmbed("Seul le manager peut modifier les prix.", "🔒 Accès refusé")] });
        }
        const { updates, errors } = parsePriceTable(interaction.fields.getTextInputValue("table"));

        // All-or-nothing: a typo must not leave half the servers updated.
        if (errors.length) {
            return respond(interaction, {
                embeds: [
                    errorEmbed(
                        `${errors.slice(0, 15).join("\n")}${errors.length > 15 ? `\n… et ${errors.length - 15} autre(s)` : ""}\n\nAucun prix n'a été modifié.`,
                        "❌ Tableau non enregistré",
                    ),
                ],
            });
        }

        let changed = 0;
        for (const { serverCode, kind, price } of updates) {
            if (effectiveRate("EUR", kind, serverCode) === Math.round(price * 1000) / 1000) continue;
            setServerPrice(serverCode, kind, price);
            changed += 1;
        }
        if (changed) refreshMarketDisplays(client);

        return respond(interaction, {
            embeds: [
                successEmbed(
                    changed
                        ? `**${changed}** prix modifié(s). Panneaux et 📈・taux-du-jour mis à jour dans quelques secondes.`
                        : "Aucun changement.",
                    "🖥️ Prix par serveur",
                ),
            ],
        });
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

    if (scope === "modal" && rest[0] === "review") return submitReview(client, interaction, rest[1]);

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
        // Prix réel : taux de base × multiplicateur du serveur choisi.
        const rate = effectiveRate(currency, rateKind, serverCode);
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
            ? `\n**${formatMillions(payload.millions)}** • ${payload.currency} • ${serverLabel(serverByCode(serverCode))}` +
              (payload.totalPreview ? `\nTotal estimé : **${formatMoney(payload.totalPreview, payload.currency)}**` : "")
            : "";

    return interaction.editReply({
        embeds: [
            successEmbed(`${type.emoji} Ton ticket est ouvert : ${channel}${summary}`, `✅ Ticket #${ticket.number}`),
        ],
    });
}

async function createExchangeTicket(interaction, fromCode, toCode) {
    if (!serverByCode(fromCode) || !serverByCode(toCode) || fromCode === toCode) {
        return respond(interaction, { embeds: [errorEmbed("Serveurs invalides. Recommence depuis le panneau d'échange.")] });
    }

    const given = parseMillions(interaction.fields.getTextInputValue("millions"));
    if (given === null) {
        return respond(interaction, {
            embeds: [errorEmbed("Quantité invalide. Utilise un nombre de millions, ex : `1000` ou `12.5` (ou `1200k`).")],
        });
    }

    const exchange = exchangeQuote(fromCode, toCode, given);
    const payload = {
        serverCode: toCode,
        transferFrom: fromCode,
        transferTo: toCode,
        millions: given,
        received: exchange?.received ?? null,
        exchangeFee: exchange?.fee ?? null,
        personnage: interaction.fields.getTextInputValue("personnage").trim(),
    };
    const notes = interaction.fields.getTextInputValue("notes").trim();
    if (notes) payload.notes = notes;

    await interaction.deferReply({ ephemeral: true });
    const result = await openTicket({ guild: interaction.guild, member: interaction.member, typeId: "echange", payload });

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
    const name = (code) => serverLabel(serverByCode(code)) || code;
    const stock = stockFor(toCode);
    const lines = [
        `♻️ Ton ticket est ouvert : ${channel}`,
        `📤 Tu donnes **${formatMillions(given)}** sur ${name(fromCode)}`,
        exchange
            ? `📥 Tu reçois **${formatMillions(exchange.received)}** sur ${name(toCode)} (commission ${exchange.fee.toLocaleString("fr-FR")} % incluse)`
            : `📥 Quantité reçue sur ${name(toCode)} : à confirmer avec le staff`,
    ];
    if (exchange && (stock.status === "full" || exchange.received > stock.millions)) lines.push("", onOrderLine(name(toCode)));

    return interaction.editReply({ embeds: [successEmbed(lines.join("\n"), `✅ Ticket #${ticket.number}`)] });
}

/* ───────────────────────── reviews ───────────────────────── */

/** Only the customer of a delivered ticket may review it, once. Returns an error text or the ticket. */
function reviewableTicket(interaction, ticketId) {
    const ticket = ticketId ? closedTicketById(ticketId) : null;
    if (!ticket || ticket.userId !== interaction.user.id) return { error: "Cet avis n'est pas lié à une de tes commandes." };
    if (reviewForTicket(ticket.id)) return { error: "Tu as déjà laissé un avis pour cette commande. Merci ! 💛" };
    return { ticket };
}

async function openReview(interaction, ticketId) {
    const { ticket, error } = reviewableTicket(interaction, ticketId);
    if (!ticket) return respond(interaction, { embeds: [errorEmbed(error, "⭐ Avis")] });
    return interaction.showModal(reviewModal(ticket.id));
}

async function submitReview(client, interaction, ticketId) {
    const { ticket, error } = reviewableTicket(interaction, ticketId);
    if (!ticket) return respond(interaction, { embeds: [errorEmbed(error, "⭐ Avis")] });

    const ratingRaw = Number.parseInt(interaction.fields.getTextInputValue("rating"), 10);
    const text = interaction.fields.getTextInputValue("text").trim();
    const rating = Math.min(5, Math.max(1, Number.isFinite(ratingRaw) ? ratingRaw : 5));

    // The button usually sits in a DM: find the shop's server from the ticket.
    const guild = client.guilds.cache.get(ticket.guildId);
    const channel = guild?.channels.cache.find((c) => c.isTextBased() && /avis|review/i.test(c.name));
    if (!channel) {
        return respond(interaction, { embeds: [errorEmbed("Le salon des avis est introuvable, préviens le staff.", "⭐ Avis")] });
    }

    await channel.send({
        embeds: [
            reviewEmbed({
                author: { tag: interaction.user.tag, displayAvatarURL: () => interaction.user.displayAvatarURL() },
                rating,
                text,
                ticket,
            }),
        ],
    });

    const entry = {
        ticketId: ticket.id,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        type: ticket.type,
        rating,
        text,
        at: new Date().toISOString(),
    };
    update("reviews.json", (data) => {
        data.entries = [entry, ...(data.entries ?? [])].slice(0, 5000);
        return entry;
    });

    const thanks = { embeds: [successEmbed(`Merci pour ton avis ! 💛 Il est publié dans ${channel}.`, "⭐ Avis publié")] };
    // Grey out the button so it can't be pressed again.
    if (interaction.isFromMessage()) {
        return interaction.update({ ...thanks, components: [reviewButtonRow(ticket.id, { done: true })] });
    }
    return respond(interaction, thanks);
}
