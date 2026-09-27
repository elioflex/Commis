import { AttachmentBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import {
    BRAND,
    CURRENCIES,
    DOFUS_SERVERS,
    TICKET_STAGES,
    TICKET_TYPE_IDS,
    TICKET_TYPES,
    serverByCode,
} from "../config.js";
import { panelRow, reviewModal } from "./components.js";
import { errorEmbed, helpEmbed, infoEmbed, panelEmbed, rateEmbed, stockEmbed, successEmbed } from "./embeds.js";
import { isStaff } from "./guild-utils.js";
import {
    effectiveRate,
    formatMillions,
    formatMoney,
    setRate,
    setServerMultiplier,
    setStock,
} from "./market.js";
import { checkGuild, formatChecks } from "./preflight.js";
import { setupGuild } from "./setup.js";
import { update } from "./store.js";
import {
    claimTicket,
    closeTicket,
    grantAccess,
    renameTicket,
    revokeAccess,
    setTicketStage,
    ticketByChannel,
    ticketStats,
} from "./tickets.js";
import { buildTranscript } from "./transcript.js";

const RATE_KIND_CHOICES = [
    { name: "Achat client (nous vendons)", value: "buy" },
    { name: "Vente client (nous achetons)", value: "sell" },
    { name: "Échange inter-serveurs", value: "exchange" },
];

const STOCK_STATUS_CHOICES = [
    { name: "🟢 Disponible", value: "open" },
    { name: "🟡 Stock limité", value: "low" },
    { name: "🔴 Complet", value: "full" },
];

const RATE_KINDS_PREVIEW = ["buy", "sell", "exchange"];

export const commandData = [
    new SlashCommandBuilder()
        .setName("panel")
        .setDescription("Poster un panneau de tickets dans ce salon")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption((option) =>
            option
                .setName("type")
                .setDescription("Type de ticket à proposer")
                .setRequired(true)
                .addChoices(...TICKET_TYPE_IDS.map((id) => ({ name: TICKET_TYPES[id].label, value: id }))),
        ),

    new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Gérer le ticket du salon courant")
        .addSubcommand((sub) =>
            sub
                .setName("close")
                .setDescription("Fermer le ticket courant")
                .addStringOption((option) => option.setName("motif").setDescription("Motif de fermeture (optionnel)")),
        )
        .addSubcommand((sub) => sub.setName("claim").setDescription("Prendre en charge le ticket (staff)"))
        .addSubcommand((sub) =>
            sub
                .setName("add")
                .setDescription("Ajouter un membre au ticket (staff)")
                .addUserOption((option) => option.setName("membre").setDescription("Membre à ajouter").setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub
                .setName("remove")
                .setDescription("Retirer un membre du ticket (staff)")
                .addUserOption((option) =>
                    option.setName("membre").setDescription("Membre à retirer").setRequired(true),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName("rename")
                .setDescription("Renommer le salon du ticket (staff)")
                .addStringOption((option) => option.setName("nom").setDescription("Nouveau nom").setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub
                .setName("move")
                .setDescription("Déplacer le ticket vers une étape (staff)")
                .addStringOption((option) =>
                    option
                        .setName("etape")
                        .setDescription("Étape de destination")
                        .setRequired(true)
                        .addChoices(
                            ...TICKET_STAGES.map((stage) => ({ name: stage.name, value: stage.id })),
                        ),
                ),
        )
        .addSubcommand((sub) => sub.setName("transcript").setDescription("Générer la transcription du ticket"))
        .addSubcommand((sub) => sub.setName("stats").setDescription("Statistiques des tickets (staff)")),

    new SlashCommandBuilder()
        .setName("rate")
        .setDescription("Afficher ou modifier les taux de kamas")
        .addSubcommand((sub) => sub.setName("voir").setDescription("Afficher les taux actuels"))
        .addSubcommand((sub) =>
            sub
                .setName("set")
                .setDescription("Définir le taux de base (staff)")
                .addStringOption((option) =>
                    option
                        .setName("devise")
                        .setDescription("Devise")
                        .setRequired(true)
                        .addChoices(...CURRENCIES.map((currency) => ({ name: currency.code, value: currency.code }))),
                )
                .addStringOption((option) =>
                    option
                        .setName("sens")
                        .setDescription("Type de taux")
                        .setRequired(true)
                        .addChoices(...RATE_KIND_CHOICES),
                )
                .addNumberOption((option) =>
                    option
                        .setName("prix")
                        .setDescription("Prix de base par million de kamas")
                        .setRequired(true)
                        .setMinValue(0.0001),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName("serveur")
                .setDescription("Ajuster le prix d'un serveur (staff)")
                .addStringOption((option) =>
                    option
                        .setName("serveur")
                        .setDescription("Serveur Dofus")
                        .setRequired(true)
                        .addChoices(...DOFUS_SERVERS.map((server) => ({ name: server.name, value: server.code }))),
                )
                .addNumberOption((option) =>
                    option
                        .setName("multiplicateur")
                        .setDescription("1 = prix de base · 1.1 = +10 % · 0.9 = -10 %")
                        .setRequired(true)
                        .setMinValue(0.1)
                        .setMaxValue(5),
                ),
        ),

    new SlashCommandBuilder()
        .setName("stock")
        .setDescription("Afficher ou modifier le stock par serveur Dofus")
        .addSubcommand((sub) => sub.setName("voir").setDescription("Afficher le stock actuel"))
        .addSubcommand((sub) =>
            sub
                .setName("set")
                .setDescription("Définir le stock d'un serveur (staff)")
                .addStringOption((option) =>
                    option
                        .setName("serveur")
                        .setDescription("Serveur Dofus")
                        .setRequired(true)
                        .addChoices(...DOFUS_SERVERS.map((server) => ({ name: server.name, value: server.code }))),
                )
                .addNumberOption((option) =>
                    option.setName("millions").setDescription("Millions disponibles").setRequired(true).setMinValue(0),
                )
                .addStringOption((option) =>
                    option
                        .setName("statut")
                        .setDescription("Statut du stock")
                        .setRequired(false)
                        .addChoices(...STOCK_STATUS_CHOICES),
                ),
        ),

    new SlashCommandBuilder().setName("avis").setDescription("Laisser un avis sur ta dernière commande"),

    new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Créer les rôles, catégories et salons du serveur")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addBooleanOption((option) =>
            option.setName("seulement_salons").setDescription("Ne pas créer les rôles (plus rapide)"),
        )
        .addBooleanOption((option) =>
            option
                .setName("roles_paiement")
                .setDescription("Créer aussi un rôle par moyen de paiement (PayPal, Wafacash, USDT…)"),
        ),

    new SlashCommandBuilder()
        .setName("check")
        .setDescription("Diagnostic : permissions du bot, hiérarchie des rôles, structure manquante")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addBooleanOption((option) =>
            option.setName("roles_paiement").setDescription("Vérifier aussi les rôles de paiement"),
        ),

    new SlashCommandBuilder().setName("help").setDescription("Afficher l'aide du bot"),
].map((command) => command.toJSON());

/* ───────────────────────── handlers ───────────────────────── */

const reply = (interaction, payload) =>
    interaction.deferred || interaction.replied
        ? interaction.editReply(payload)
        : interaction.reply({ ...payload, ephemeral: true });

async function guardStaff(interaction) {
    if (isStaff(interaction.member)) return true;
    await reply(interaction, { embeds: [errorEmbed("Commande réservée au staff.", "🔒 Accès refusé")] });
    return false;
}

async function currentTicket(interaction) {
    const ticket = ticketByChannel(interaction.channelId);
    if (ticket) return ticket;
    await reply(interaction, { embeds: [errorEmbed("Cette commande doit être utilisée dans un ticket.")] });
    return null;
}

export async function runCommand(client, interaction) {
    const { commandName } = interaction;

    if (commandName === "help") {
        return reply(interaction, { embeds: [helpEmbed(`${BRAND.name} • `)] });
    }

    if (commandName === "ping") {
        return reply(interaction, {
            embeds: [infoEmbed(`Latence : **${client.ws.ping} ms**`, "🏓 Pong")],
        });
    }

    if (commandName === "panel") {
        if (!(await guardStaff(interaction))) return undefined;
        const typeId = interaction.options.getString("type", true);
        const type = TICKET_TYPES[typeId];

        const message = await interaction.channel.send({
            embeds: [panelEmbed(typeId)],
            components: [panelRow(typeId)],
        });

        update("panels.json", (data) => {
            data.posted[typeId] = {
                channelId: interaction.channelId,
                messageId: message.id,
                at: new Date().toISOString(),
            };
            return true;
        });

        return reply(interaction, {
            embeds: [successEmbed(`Panneau **${type.label}** publié dans ${interaction.channel}.`, "✅ Panneau posté")],
        });
    }

    if (commandName === "avis") {
        return interaction.showModal(reviewModal());
    }

    if (commandName === "check") {
        if (!(await guardStaff(interaction))) return undefined;
        await interaction.deferReply({ ephemeral: true });
        const withPaymentRoles = interaction.options.getBoolean("roles_paiement") ?? false;
        const diagnostics = checkGuild(interaction.guild, client, { withPaymentRoles });
        const lines = formatChecks(diagnostics).join("\n");

        return interaction.editReply({
            embeds: [
                diagnostics.ok
                    ? successEmbed(lines, "🩺 Diagnostic — tout est bon")
                    : errorEmbed(lines, "🩺 Diagnostic — à corriger avant `/setup`"),
            ],
        });
    }

    if (commandName === "setup") {
        if (!(await guardStaff(interaction))) return undefined;
        await interaction.deferReply({ ephemeral: true });
        const onlyChannels = interaction.options.getBoolean("seulement_salons") ?? false;
        const withPaymentRoles = interaction.options.getBoolean("roles_paiement") ?? false;

        const diagnostics = checkGuild(interaction.guild, client, { withPaymentRoles });
        if (!diagnostics.ok) {
            return interaction.editReply({
                embeds: [
                    errorEmbed(
                        `${formatChecks(diagnostics).join("\n")}\n\nCorrige ces points puis relance \`/setup\`.`,
                        "❌ Configuration impossible",
                    ),
                ],
            });
        }

        const report = await setupGuild(interaction.guild, { skipRoles: onlyChannels, withPaymentRoles });

        return interaction.editReply({
            embeds: [
                successEmbed(
                    [
                        `**Rôles créés :** ${report.rolesCreated.length}`,
                        report.rolesCreated.length ? `> ${report.rolesCreated.join(", ")}` : null,
                        `**Catégories créées :** ${report.categoriesCreated.length}`,
                        report.categoriesCreated.length ? `> ${report.categoriesCreated.join(", ")}` : null,
                        `**Salons créés :** ${report.channelsCreated.length}`,
                        report.channelsCreated.length ? `> ${report.channelsCreated.join(", ")}` : null,
                        report.staffRoleId ? `\n**STAFF_ROLE_ID** = \`${report.staffRoleId}\`` : null,
                        report.managerRoleId ? `**MANAGER_ROLE_ID** = \`${report.managerRoleId}\`` : null,
                        report.logChannelId ? `**LOG_CHANNEL_ID** = \`${report.logChannelId}\`` : null,
                        report.transcriptChannelId ? `**TRANSCRIPT_CHANNEL_ID** = \`${report.transcriptChannelId}\`` : null,
                        "\nCopie ces valeurs dans ton `.env` pour que le bot cesse de chercher par nom.",
                    ]
                        .filter(Boolean)
                        .join("\n"),
                    "🏗️ Serveur configuré",
                ),
            ],
        });
    }

    if (commandName === "rate") {
        const sub = interaction.options.getSubcommand();
        if (sub === "voir") return reply(interaction, { embeds: [rateEmbed()] });
        if (!(await guardStaff(interaction))) return undefined;

        if (sub === "serveur") {
            const serverCode = interaction.options.getString("serveur", true);
            const multiplier = interaction.options.getNumber("multiplicateur", true);
            const applied = setServerMultiplier(serverCode, multiplier);
            const name = serverByCode(serverCode)?.name ?? serverCode;

            const preview = RATE_KINDS_PREVIEW.map((kind) => {
                const rate = effectiveRate("EUR", kind, serverCode);
                const label = kind === "buy" ? "achat" : kind === "sell" ? "vente" : "échange";
                return `${label} : **${formatMoney(rate, "EUR")}/M**`;
            });

            return reply(interaction, {
                embeds: [
                    successEmbed(
                        [
                            `Multiplicateur de **${name}** : **×${applied}**`,
                            preview.join(" • "),
                            "",
                            "_1.0 = prix de base · 1.1 = +10 % · 0.9 = -10 %. Remets 1 pour revenir au prix de base._",
                        ].join("\n"),
                        "🖥️ Prix du serveur ajusté",
                    ),
                ],
            });
        }

        const currency = interaction.options.getString("devise", true);
        const kind = interaction.options.getString("sens", true);
        const price = interaction.options.getNumber("prix", true);
        setRate(currency, kind, price);

        return reply(interaction, {
            embeds: [successEmbed(`Taux **${kind}** ${currency} mis à jour : **${formatMoney(price, currency)}** / M\n\n_C'est le prix de base. Ajuste chaque serveur avec \`/rate serveur\`._`, "📈 Taux enregistré")],
        });
    }

    if (commandName === "stock") {
        const sub = interaction.options.getSubcommand();
        if (sub === "voir") return reply(interaction, { embeds: [stockEmbed()] });
        if (!(await guardStaff(interaction))) return undefined;

        const serverCode = interaction.options.getString("serveur", true);
        const millions = interaction.options.getNumber("millions", true);
        const statusOption = interaction.options.getString("statut");
        const status = statusOption ?? (millions > 100 ? "open" : millions > 0 ? "low" : "full");
        setStock(serverCode, millions, status);

        return reply(interaction, {
            embeds: [
                successEmbed(
                    `**${serverByCode(serverCode)?.name ?? serverCode}** → ${formatMillions(millions)} (${status})`,
                    "📦 Stock mis à jour",
                ),
            ],
        });
    }

    if (commandName === "ticket") {
        const sub = interaction.options.getSubcommand();

        if (sub === "stats") {
            if (!(await guardStaff(interaction))) return undefined;
            const stats = ticketStats(interaction.guildId);
            const detail = Object.entries(stats.byType)
                .map(([type, count]) => `• ${TICKET_TYPES[type]?.label ?? type} : **${count}**`)
                .join("\n");
            return reply(interaction, {
                embeds: [
                    infoEmbed(
                        `**Ouverts :** ${stats.openCount}\n**Fermés :** ${stats.closedCount}\n**Cumul :** ${stats.total}\n\n${detail || "_Aucun ticket pour le moment._"}`,
                        "📊 Statistiques tickets",
                    ),
                ],
            });
        }

        const ticket = await currentTicket(interaction);
        if (!ticket) return undefined;

        if (sub === "transcript") {
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

        if (sub === "claim") {
            if (!(await guardStaff(interaction))) return undefined;
            const { already } = await claimTicket({ channel: interaction.channel, ticket, member: interaction.member });
            return reply(interaction, {
                embeds: [
                    already
                        ? infoEmbed(`Déjà pris en charge par <@${already}>.`, "🎯 Ticket")
                        : successEmbed("Tu prends en charge ce ticket.", "🎯 Pris en charge"),
                ],
            });
        }

        if (sub === "add" || sub === "remove") {
            if (!(await guardStaff(interaction))) return undefined;
            const user = interaction.options.getUser("membre", true);
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!member) {
                return reply(interaction, { embeds: [errorEmbed("Membre introuvable sur ce serveur.")] });
            }
            if (sub === "add") await grantAccess({ channel: interaction.channel, member, actor: interaction.user });
            else await revokeAccess({ channel: interaction.channel, member, actor: interaction.user });
            return reply(interaction, {
                embeds: [
                    successEmbed(`${member} ${sub === "add" ? "ajouté au" : "retiré du"} ticket.`, "👥 Accès mis à jour"),
                ],
            });
        }

        if (sub === "rename") {
            if (!(await guardStaff(interaction))) return undefined;
            const name = interaction.options.getString("nom", true);
            const finalName = await renameTicket({ channel: interaction.channel, ticket, name });
            return reply(interaction, {
                embeds: [successEmbed(`Ticket renommé en \`${finalName}\`.`, "✏️ Renommé")],
            });
        }

        if (sub === "move") {
            if (!(await guardStaff(interaction))) return undefined;
            const stageId = interaction.options.getString("etape", true);
            await setTicketStage({ channel: interaction.channel, ticket, stageId });
            return reply(interaction, {
                embeds: [successEmbed(`Ticket déplacé vers **${stageId}**.`, "🗂️ Étape mise à jour")],
            });
        }

        if (sub === "close") {
            const custom = interaction.options.getString("motif");
            const canClose = isStaff(interaction.member) || interaction.user.id === ticket.userId;
            if (!canClose) {
                return reply(interaction, { embeds: [errorEmbed("Seul le client ou le staff peut fermer ce ticket.")] });
            }
            await interaction.deferReply({ ephemeral: true });
            const { transcriptCount } = await closeTicket({
                channel: interaction.channel,
                ticket,
                closedBy: interaction.user,
                reasonCode: "autre",
                reasonLabel: custom ?? null,
                client,
            });
            return interaction.editReply({
                embeds: [
                    successEmbed(
                        `Ticket fermé${transcriptCount ? ` • ${transcriptCount} message(s) transcrits` : ""}.`,
                        "🔒 Fermé",
                    ),
                ],
            });
        }
    }

    return undefined;
}
