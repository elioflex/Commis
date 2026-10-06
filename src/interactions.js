import { AttachmentBuilder, MessageFlags } from "discord.js";

import { CURRENCIES, CURRENCY_CODES, TICKET_TYPES, paymentByCode, serverByCode, serverLabel } from "../config.js";
import {
    alertClearRow,
    alertSelectRow,
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
    offerDecisionRow,
    offerModal,
    offerServerRow,
    paymentSelectRow,
    renameModal,
    reviewButtonRow,
    reviewModal,
    serverSelectRow,
    simpleModal,
    watchClearRow,
    watchSelectRow,
} from "./components.js";
import {
    baseEmbed,
    errorEmbed,
    exchangeRecapEmbed,
    exchangeSimEmbed,
    guaranteeEmbed,
    infoEmbed,
    onOrderLine,
    paymentMethodsEmbed,
    procedureEmbed,
    reviewEmbed,
    successEmbed,
} from "./embeds.js";
import {
    adminModal,
    parseNumber,
    parseSide,
    parseStockStatus,
    priceLine,
    refreshAdminPanelSoon,
    resolveOneServer,
} from "./admin-panel.js";
import { isManager, isStaff, offersChannel } from "./guild-utils.js";
import { refreshGuide, refreshMarketDisplays } from "./live-board.js";
import {
    parseMillions,
    effectiveRate,
    exchangeQuote,
    formatMoney,
    formatMillions,
    parsePriceTable,
    quote,
    resolveServers,
    serverPriceSummary,
    setExchangeFee,
    setFeedEnabled,
    setFeedFactors,
    setServerAdjustments,
    setStock,
    stockFor,
    setServerPrice,
    feedEnabled,
} from "./market.js";
import { runPriceFeed } from "./price-feed.js";

import {
    OFFER_KINDS,
    createOffer,
    decideOffer,
    offerAcceptedEmbed,
    offerById,
    offerRefusedEmbed,
    offerSentEmbed,
    offerStaffEmbed,
    parsePrice,
} from "./offers.js";
import { lockQuote, lockedRate, quoteLockLine, releaseQuote } from "./price-lock.js";
import { WATCH_KINDS, setWatches, watchListLine, watchesFor } from "./price-watch.js";
import { alertListLine, alertsFor, isRestock, notifyRestock, setAlerts, subscribersFor } from "./stock-alerts.js";
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
    if (scope === "info") return handleInfoButton(interaction, rest);
    if (scope === "alert" && rest[0] === "start") return respond(interaction, alertPanel(interaction.user.id));
    if (scope === "alert" && rest[0] === "clear") {
        setAlerts(interaction.user.id, interaction.guildId, []);
        return interaction.update(alertPanel(interaction.user.id));
    }
    if (scope === "admin") return handleAdminButton(client, interaction, rest[0]);
    if (scope === "watch" && WATCH_KINDS.includes(rest[1])) {
        if (rest[0] === "start") return respond(interaction, watchPanel(interaction.user.id, rest[1]));
        if (rest[0] === "clear") {
            setWatches(interaction.user.id, interaction.guildId, rest[1], []);
            return interaction.update(watchPanel(interaction.user.id, rest[1]));
        }
    }
    if (scope === "offer" && rest[0] === "start" && OFFER_KINDS.includes(rest[1])) {
        return respond(interaction, {
            embeds: [
                infoEmbed(
                    "Choisis le serveur, puis indique la quantité et **ton prix par M**. Le staff accepte ou refuse, et tu reçois la réponse en message privé.",
                    "💼 Faire une offre",
                ),
            ],
            components: [offerServerRow(rest[1])],
        });
    }
    if (scope === "offer" && (rest[0] === "accept" || rest[0] === "refuse")) {
        return decideOfferButton(interaction, rest[0], rest[1]);
    }
    return undefined;
}

/* ───────────────────────── 🎛️ pilotage-prix ───────────────────────── */

async function needManager(interaction) {
    if (isManager(interaction.member)) return true;
    await respond(interaction, {
        embeds: [errorEmbed("Réservé au gestionnaire des prix.", "🔒 Accès refusé")],
    });
    return false;
}

const ADMIN_MODALS = ["factors", "fee", "adjust", "price", "stock"];

async function handleAdminButton(client, interaction, action) {
    if (!(await needManager(interaction))) return undefined;
    if (ADMIN_MODALS.includes(action)) return interaction.showModal(adminModal(action));
    if (action === "toggle") {
        const enabled = setFeedEnabled(!feedEnabled());
        refreshMarketDisplays(client);
        return respond(interaction, {
            embeds: [
                successEmbed(
                    enabled ? "Prix web réactivés." : "Prix web en pause : retour aux taux de base.",
                    enabled ? "▶️ Prix web" : "⏸️ Prix web",
                ),
            ],
        });
    }
    if (action === "feed") {
        await interaction.deferReply({ ephemeral: true });
        const result = await runPriceFeed({ client });
        refreshMarketDisplays(client);
        return interaction.editReply({
            embeds: [
                result.ok
                    ? successEmbed(
                          `${result.changed} prix modifié(s)${result.held.length ? `, ${result.held.length} saut(s) en attente de confirmation` : ""}.`,
                          "🔄 Relevé terminé",
                      )
                    : errorEmbed("Relevé impossible : les derniers prix connus sont conservés.", "⚠️ Relevé"),
            ],
        });
    }
    return undefined;
}

async function submitAdminModal(client, interaction, kind) {
    if (!(await needManager(interaction))) return undefined;
    const value = (id) => interaction.fields.getTextInputValue(id);
    const fail = (message) => respond(interaction, { embeds: [errorEmbed(`${message}\nRien n'a été modifié.`)] });
    const done = (lines, title) => {
        refreshMarketDisplays(client);
        return respond(interaction, { embeds: [successEmbed([lines].flat().join("\n"), title)] });
    };

    if (kind === "factors") {
        const buy = parseNumber(value("buy"));
        const sell = parseNumber(value("sell"));
        if (!(buy >= 50 && buy <= 150) || !(sell >= 50 && sell <= 150)) return fail("Entre un pourcentage entre 50 et 150.");
        setFeedFactors({ buy: buy / 100, sell: sell / 100 });
        void refreshGuide(client);
        return done(`Vente : **${buy} %** du moins cher · rachat : **${sell} %** du meilleur.`, "🎯 Pourcentages enregistrés");
    }
    if (kind === "fee") {
        const fee = parseNumber(value("fee"));
        if (fee === null || fee < 0 || fee > 50) return fail("Commission entre 0 et 50 %.");
        const applied = setExchangeFee(fee);
        void refreshGuide(client);
        return done(`Commission sur les échanges : **${applied.toLocaleString("fr-FR")} %**`, "💱 Commission enregistrée");
    }
    if (kind === "adjust") {
        const { codes, unknown } = resolveServers(value("servers"));
        const kinds = parseSide(value("side"));
        const percent = parseNumber(value("percent"));
        if (unknown.length || !codes.length) return fail(`Serveur(s) inconnu(s) : ${unknown.join(", ") || "aucun"}.`);
        if (!kinds) return fail("Sens : achat, vente ou les deux.");
        if (percent === null || Math.abs(percent) > 50) return fail("Ajustement entre -50 et +50 %.");
        const applied = setServerAdjustments(codes, kinds, percent);
        const lines = codes.flatMap((code) => kinds.map((k) => priceLine(code, k)));
        return done(
            [
                applied === 0 ? `Ajustement retiré sur ${codes.length} serveur(s).` : `Ajustement **${applied > 0 ? "+" : ""}${applied} %** sur ${codes.length} serveur(s).`,
                ...(lines.length > 30 ? [...lines.slice(0, 30), `… et ${lines.length - 30} autre(s)`] : lines),
            ],
            "🎚️ Prix ajustés",
        );
    }
    if (kind === "price") {
        const code = resolveOneServer(value("server"));
        const kinds = parseSide(value("side"), { allowBoth: false });
        const price = parseNumber(value("price"));
        if (!code) return fail("Indique un seul serveur connu.");
        if (!kinds) return fail("Sens : achat ou vente.");
        if (price === null || price < 0 || price > 1000) return fail("Prix invalide.");
        setServerPrice(code, kinds[0], price);
        return done(
            [price === 0 ? "Prix manuel retiré : le prix web reprend la main." : "Prix manuel enregistré (prioritaire sur le web).", priceLine(code, kinds[0])],
            "📌 Prix manuel",
        );
    }
    if (kind === "stock") {
        const code = resolveOneServer(value("server"));
        const millions = parseNumber(value("millions"));
        if (!code) return fail("Indique un seul serveur connu.");
        if (millions === null || millions < 0) return fail("Quantité invalide.");
        const status = parseStockStatus(value("status"), millions);
        if (!status) return fail("Statut : dispo, limite ou sur commande.");
        const before = stockFor(code);
        setStock(code, millions, status);
        const after = stockFor(code);
        const waiting = isRestock(before, after) ? subscribersFor(code).length : 0;
        await done(
            [
                `**${serverLabel(serverByCode(code)) || code}** → ${formatMillions(millions)} (${status})`,
                waiting ? `🔔 ${waiting} client(s) en alerte, message privé en cours d'envoi.` : null,
            ].filter(Boolean),
            "📦 Stock mis à jour",
        );
        if (waiting) await notifyRestock(client, code, after);
        return undefined;
    }
    return undefined;
}

function watchPanel(userId, kind) {
    const current = watchesFor(userId, kind);
    const what = kind === "buy" ? "notre **prix de vente**" : "notre **prix de rachat**";
    return {
        embeds: [
            infoEmbed(
                [
                    `Choisis les serveurs dont tu veux suivre ${what} : je t'envoie un **message privé** quand il bouge de 3 % ou plus.`,
                    "_Pense à autoriser les messages privés de ce serveur._",
                    "",
                    watchListLine(current),
                ].join("\n"),
                "📈 Suivi prix",
            ),
        ],
        components: [watchSelectRow(kind, current), watchClearRow(kind)],
    };
}

async function dm(client, userId, payload) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(payload);
        return true;
    } catch {
        return false;
    }
}

/** Staff decision on a 💼 offer: accept opens a ticket at the agreed price. */
async function decideOfferButton(interaction, action, offerId) {
    if (!(await needStaff(interaction))) return undefined;
    const pending = offerById(offerId);
    if (!pending) return respond(interaction, { embeds: [errorEmbed("Offre introuvable.")] });

    const offer = decideOffer(offerId, action === "accept" ? "accepted" : "refused", interaction.user.id);
    if (!offer) {
        return respond(interaction, { embeds: [infoEmbed("Cette offre a déjà été traitée.", "💼 Offre")] });
    }
    await interaction.update({ embeds: [offerStaffEmbed(offer)], components: [offerDecisionRow(offer.id, { disabled: true })] });
    refreshAdminPanelSoon(interaction.client);

    if (action === "refuse") {
        const reached = await dm(interaction.client, offer.userId, { embeds: [offerRefusedEmbed(offer)] });
        if (!reached) await interaction.followUp({ content: `⚠️ <@${offer.userId}> n'accepte pas les MP : préviens-le autrement.`, ephemeral: true });
        return undefined;
    }

    const member = await interaction.guild.members.fetch(offer.userId).catch(() => null);
    if (!member) {
        return interaction.followUp({ content: "⚠️ Le client n'est plus sur le serveur : aucun ticket ouvert.", ephemeral: true });
    }
    const result = await openTicket({
        guild: interaction.guild,
        member,
        typeId: offer.kind === "buy" ? "achat" : "vente",
        payload: {
            serverCode: offer.serverCode,
            millions: offer.millions,
            currency: offer.currency,
            rate: offer.price,
            personnage: offer.personnage ?? undefined,
            notes: `💼 Offre acceptée \`${offer.id}\` par <@${interaction.user.id}> : ${formatMoney(offer.price, offer.currency)}/M.`,
            offerId: offer.id,
        },
    });

    if (result.duplicate) {
        // One open ticket per customer: the agreed price goes into the one they already have.
        const channel = interaction.guild.channels.cache.get(result.duplicate.channelId);
        await channel
            ?.send({ embeds: [offerAcceptedEmbed(offer, null)], content: `<@${offer.userId}>` })
            .catch(() => null);
        await dm(interaction.client, offer.userId, { embeds: [offerAcceptedEmbed(offer, result.duplicate.channelId)] });
        return interaction.followUp({
            content: `ℹ️ Le client a déjà un ticket ouvert (<#${result.duplicate.channelId}>) : l'offre y a été postée, le prix est à appliquer à la main.`,
            ephemeral: true,
        });
    }
    await dm(interaction.client, offer.userId, { embeds: [offerAcceptedEmbed(offer, result.channel.id)] });
    return interaction.followUp({ content: `🎟️ Ticket ouvert : <#${result.channel.id}>`, ephemeral: true });
}

/** 🛡️ Garantie / 📦 Procédure / 💳 Méthodes: private answers from the panels. */
function handleInfoButton(interaction, rest) {
    if (rest[0] === "guarantee") return respond(interaction, { embeds: [guaranteeEmbed()] });
    if (rest[0] === "proc" && TICKET_TYPES[rest[1]]) return respond(interaction, { embeds: [procedureEmbed(rest[1])] });
    if (rest[0] === "pay") return respond(interaction, { embeds: [paymentMethodsEmbed()] });
    return undefined;
}

function alertPanel(userId) {
    const current = alertsFor(userId);
    return {
        embeds: [
            infoEmbed(
                [
                    "Choisis les serveurs à surveiller : dès qu'on a du stock prêt à livrer sur l'un d'eux, je t'envoie un **message privé**.",
                    "_Pense à autoriser les messages privés de ce serveur._",
                    "",
                    alertListLine(current),
                ].join("\n"),
                "🔔 Alerte stock",
            ),
        ],
        components: [alertSelectRow(current), alertClearRow()],
    };
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

/** "1,55 € · 16,68 DH" at the prices held for this customer. */
function lockedSummary(userId, kind, serverCode) {
    const cells = CURRENCIES.map((currency) => {
        const rate = lockedRate(userId, kind, serverCode, currency.code);
        return rate === null ? null : formatMoney(rate, currency.code);
    }).filter(Boolean);
    return cells.length ? cells.join(" · ") : serverPriceSummary(kind, serverCode);
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

    if (scope === "alert" && rest[0] === "set") {
        setAlerts(interaction.user.id, interaction.guildId, interaction.values);
        return interaction.update(alertPanel(interaction.user.id));
    }
    if (scope === "watch" && rest[0] === "set" && WATCH_KINDS.includes(rest[1])) {
        setWatches(interaction.user.id, interaction.guildId, rest[1], interaction.values);
        return interaction.update(watchPanel(interaction.user.id, rest[1]));
    }
    if (scope === "offer" && rest[0] === "srv" && OFFER_KINDS.includes(rest[1])) {
        return interaction.showModal(offerModal(rest[1], interaction.values[0]));
    }

    if (scope === "flow" && rest[0] === "srv") {
        const typeId = rest[1];
        const serverCode = interaction.values[0];
        const type = TICKET_TYPES[typeId];
        if (!type) return respond(interaction, { embeds: [errorEmbed("Type de ticket inconnu.")] });

        const label = serverLabel(serverByCode(serverCode)) || serverCode;
        const kind = typeId === "achat" ? "buy" : typeId === "vente" ? "sell" : "exchange";
        const rate = effectiveRate("EUR", kind, serverCode);
        const lockUntil = rate !== null && kind !== "exchange" ? lockQuote(interaction.user.id, kind, serverCode) : null;
        const priceLine =
            rate === null
                ? "Taux : à confirmer avec le staff"
                : [`Prix sur ce serveur (par M) : **${lockedSummary(interaction.user.id, kind, serverCode)}**`, quoteLockLine(lockUntil)]
                      .filter(Boolean)
                      .join("\n");

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
        const rate = lockedRate(interaction.user.id, rateKind, serverCode, "EUR");
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
    if (scope === "offer" && rest[0] === "modal") return submitOffer(interaction, rest[1], rest[2]);
    if (scope === "admin" && rest[0] === "modal") return submitAdminModal(client, interaction, rest[1]);

    return undefined;
}

async function submitOffer(interaction, kind, serverCode) {
    if (!OFFER_KINDS.includes(kind) || !serverByCode(serverCode)) {
        return respond(interaction, { embeds: [errorEmbed("Offre invalide.")] });
    }
    const millions = parseMillions(interaction.fields.getTextInputValue("millions"));
    const price = parsePrice(interaction.fields.getTextInputValue("price"));
    const currency = interaction.fields.getTextInputValue("currency").trim().toUpperCase();
    const problems = [
        millions === null && "Quantité invalide (ex : `500`).",
        price === null && "Prix par M invalide (ex : `1.40`).",
        !CURRENCY_CODES.includes(currency) && `Devise inconnue : utilise ${CURRENCY_CODES.join(" ou ")}.`,
    ].filter(Boolean);
    if (problems.length) return respond(interaction, { embeds: [errorEmbed(problems.join("\n"))] });

    const channel = offersChannel(interaction.guild);
    if (!channel) {
        return respond(interaction, { embeds: [errorEmbed("Les offres sont indisponibles pour le moment. Ouvre un ticket à la place.")] });
    }
    const offer = createOffer({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        kind,
        serverCode,
        millions,
        price,
        currency,
        personnage: interaction.fields.getTextInputValue("personnage").trim(),
    });
    await channel.send({ embeds: [offerStaffEmbed(offer)], components: [offerDecisionRow(offer.id)] });
    refreshAdminPanelSoon(interaction.client);
    return respond(interaction, { embeds: [offerSentEmbed(offer)] });
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
        // Price held since the server was picked (or today's, if better for the customer).
        const rate = lockedRate(interaction.user.id, rateKind, serverCode, currency);
        payload.rate = rate;
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
    if (ticket.rateKind) releaseQuote(interaction.user.id, ticket.rateKind, serverCode);
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
