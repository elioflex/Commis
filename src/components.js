import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
} from "discord.js";

import { CURRENCIES, DOFUS_SERVERS, PAYMENT_METHODS, TICKET_STAGES, TICKET_TYPES, serverLabel } from "../config.js";

export const CLOSE_REASONS = [
    { code: "livre", label: "✅ Commande livrée", emoji: "✅" },
    { code: "annule", label: "❌ Annulé", emoji: "❌" },
    { code: "inactif", label: "😴 Client inactif", emoji: "😴" },
    { code: "doublon", label: "♻️ Doublon", emoji: "♻️" },
    { code: "autre", label: "🤷 Autre", emoji: "🤷" },
];

export const closeReason = (code) => CLOSE_REASONS.find((r) => r.code === code) ?? null;

/* ───────────────────────── Panels ───────────────────────── */

const MARKET_PANELS = ["achat", "vente", "echange"];

const infoButton = (customId, label, emoji) =>
    new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Secondary);

/** Main action, then the trust buttons (5 max per row). */
export function panelRow(typeId) {
    const type = TICKET_TYPES[typeId];
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`panel:${typeId}`)
            .setLabel(type.label)
            .setEmoji(type.emoji)
            .setStyle(ButtonStyle.Success),
    );
    if (typeId === "echange") {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId("xchg:sim")
                .setLabel("Simuler mon échange")
                .setEmoji("🧮")
                .setStyle(ButtonStyle.Primary),
        );
    }
    if (!MARKET_PANELS.includes(typeId)) return row;

    if (typeId !== "vente") row.addComponents(infoButton("alert:start", "Alerte stock", "🔔"));
    row.addComponents(infoButton(`info:proc:${typeId}`, "Procédure", "📦"), infoButton("info:guarantee", "Garantie", "🛡️"));
    if (typeId !== "echange") row.addComponents(infoButton("info:pay", "Méthodes", "💳"));
    return row;
}

/* ───────────────────────── Stock alerts ───────────────────────── */

export function alertSelectRow(selected = []) {
    const options = DOFUS_SERVERS.slice(0, 25).map((server) => ({
        label: serverLabel(server),
        value: server.code,
        default: selected.includes(server.code),
    }));
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("alert:set")
            .setPlaceholder("🔔 Serveurs à surveiller")
            .setMinValues(0)
            .setMaxValues(options.length)
            .addOptions(options),
    );
}

export function alertClearRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("alert:clear")
            .setLabel("Supprimer mes alertes")
            .setEmoji("🔕")
            .setStyle(ButtonStyle.Secondary),
    );
}

/* ───────────────────────── Ticket header ───────────────────────── */

export function ticketActionRow({ claimed = false, channelId } = {}) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("ticket:claim")
            .setLabel(claimed ? "Pris en charge" : "Prendre en charge")
            .setEmoji("🎯")
            .setStyle(ButtonStyle.Success)
            .setDisabled(Boolean(claimed)),
        new ButtonBuilder().setCustomId("ticket:close").setLabel("Fermer").setEmoji("🔒").setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId("ticket:members")
            .setLabel("Accès")
            .setEmoji("👥")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("ticket:move")
            .setLabel("Étape")
            .setEmoji("🗂️")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("ticket:transcript")
            .setLabel("Transcript")
            .setEmoji("📄")
            .setStyle(ButtonStyle.Secondary),
    );
}

export function moveStageRow() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("ticket:move:stage")
            .setPlaceholder("🗂️ Déplacer le ticket vers…")
            .addOptions(
                TICKET_STAGES.map((stage) => ({ label: stage.label, value: stage.id, emoji: stage.emoji })),
            ),
    );
}

export function closeReasonRow() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("ticket:close:reason")
            .setPlaceholder("🔒 Motif de fermeture")
            .addOptions(CLOSE_REASONS.map((r) => ({ label: r.label, value: r.code, emoji: r.emoji }))),
    );
}

export function confirmRow(action, reasonCode) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket:${action}:yes${reasonCode ? `:${reasonCode}` : ""}`)
            .setLabel("Confirmer")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`ticket:${action}:no`)
            .setLabel("Annuler")
            .setEmoji("↩️")
            .setStyle(ButtonStyle.Secondary),
    );
}

export function memberModeRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("ticket:member:add")
            .setLabel("Ajouter")
            .setEmoji("➕")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("ticket:member:remove")
            .setLabel("Retirer")
            .setEmoji("➖")
            .setStyle(ButtonStyle.Secondary),
    );
}

export function memberSelectRow(mode) {
    return new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId(`ticket:member:do:${mode}`)
            .setPlaceholder(mode === "add" ? "Qui ajouter au ticket ?" : "Qui retirer du ticket ?")
            .setMinValues(1)
            .setMaxValues(5),
    );
}

/* ───────────────────────── Ticket creation flow ───────────────────────── */

export function serverSelectRow(typeId) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`flow:srv:${typeId}`)
            .setPlaceholder("🌍 Sur quel serveur Dofus ?")
            .addOptions(
                DOFUS_SERVERS.slice(0, 25).map((server) => ({ label: serverLabel(server), value: server.code })),
            ),
    );
}

export function paymentSelectRow(typeId, serverCode) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`flow:pay:${typeId}:${serverCode}`)
            .setPlaceholder("💳 Moyen de paiement souhaité")
            .addOptions(
                PAYMENT_METHODS.slice(0, 25).map((method) => ({
                    label: method.label,
                    value: method.code,
                    emoji: method.emoji,
                })),
            ),
    );
}

export function continueRow(typeId, serverCode, paymentCode) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`flow:go:${typeId}:${serverCode}:${paymentCode}`)
            .setLabel("Remplir ma demande")
            .setEmoji("📝")
            .setStyle(ButtonStyle.Primary),
    );
}

const textRow = (input) => new ActionRowBuilder().addComponents(input);

/* ───────────────────────── Exchange flow ───────────────────────── */

const serverOptions = (except) =>
    DOFUS_SERVERS.filter((server) => server.code !== except)
        .slice(0, 25)
        .map((server) => ({ label: serverLabel(server), value: server.code }));

/**
 * Step 1: the server the customer gives kamas on. `mode` is "ticket" (open a
 * ticket) or "sim" (just compute the amount received).
 */
export function exchangeSourceRow(mode = "ticket") {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`xchg:from:${mode}`)
            .setPlaceholder("📤 Serveur source (tu donnes)")
            .addOptions(serverOptions(null)),
    );
}

/** Step 2: the server the customer receives kamas on. */
export function exchangeDestinationRow(fromCode, mode = "ticket") {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`xchg:to:${mode}:${fromCode}`)
            .setPlaceholder("📥 Serveur destination (tu reçois)")
            .addOptions(serverOptions(fromCode)),
    );
}

export function exchangeContinueRow(fromCode, toCode, given = null) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`xchg:go:${fromCode}:${toCode}${given ? `:${given}` : ""}`)
            .setLabel(given ? "Ouvrir un ticket avec ce montant" : "Remplir ma demande")
            .setEmoji("📝")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(given ? "xchg:sim" : "xchg:restart")
            .setLabel("Changer de serveurs")
            .setEmoji("↩️")
            .setStyle(ButtonStyle.Secondary),
    );
}

const givenInput = (given) => {
    const input = new TextInputBuilder()
        .setCustomId("millions")
        .setLabel("Quantité que tu donnes (en millions)")
        .setPlaceholder("ex : 1000  (pour 1000 M de kamas)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(12);
    return given ? input.setValue(String(given)) : input;
};

/** Simulator: only the quantity given, the answer comes back right away. */
export function exchangeSimModal(fromCode, toCode) {
    return new ModalBuilder()
        .setCustomId(`modal:xchgsim:${fromCode}:${toCode}`)
        .setTitle("🧮 Simuler mon échange")
        .addComponents(textRow(givenInput(null)));
}

/** Step 3: how much the customer gives on the source server (prefilled after a simulation). */
export function exchangeModal(fromCode, toCode, given = null) {
    return new ModalBuilder()
        .setCustomId(`modal:xchg:${fromCode}:${toCode}`)
        .setTitle("♻️ Échange — ta demande")
        .addComponents(
            textRow(givenInput(given)),
            textRow(
                new TextInputBuilder()
                    .setCustomId("personnage")
                    .setLabel("Pseudo de ton perso sur le serveur destination")
                    .setPlaceholder("ex : MyStique-Tylezia")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(60),
            ),
            textRow(
                new TextInputBuilder()
                    .setCustomId("notes")
                    .setLabel("Précisions (optionnel)")
                    .setPlaceholder("ex : dispo maintenant, pseudo du perso qui donne")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(400),
            ),
        );
}

export function marketModal(typeId, serverCode, paymentCode) {
    const type = TICKET_TYPES[typeId];
    const modal = new ModalBuilder()
        .setCustomId(`modal:market:${typeId}:${serverCode}:${paymentCode}`)
        .setTitle(`${type.label} — ta demande`.slice(0, 45));

    const rows = [
        textRow(
            new TextInputBuilder()
                .setCustomId("millions")
                .setLabel("Quantité en millions de kamas")
                .setPlaceholder("ex : 50  (pour 50 M de kamas)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(12),
        ),
        textRow(
            new TextInputBuilder()
                .setCustomId("currency")
                .setLabel(`Devise (${CURRENCIES.map((c) => c.code).join(" / ")})`)
                .setPlaceholder("EUR")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(6),
        ),
        textRow(
            new TextInputBuilder()
                .setCustomId("personnage")
                .setLabel("Pseudo de ton personnage Dofus")
                .setPlaceholder("ex : MyStique-Tylezia")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(60),
        ),
        textRow(
            new TextInputBuilder()
                .setCustomId("notes")
                .setLabel("Précisions (optionnel)")
                .setPlaceholder("ex : dispo maintenant, livraison en plusieurs fois")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(400),
        ),
    ];

    return modal.addComponents(...rows);
}

/** `/rate tableau`: every server's EUR prices in one editable text box. */
export function priceTableModal(table) {
    return new ModalBuilder()
        .setCustomId("modal:prices")
        .setTitle("Prix par serveur (EUR / M)")
        .addComponents(
            textRow(
                new TextInputBuilder()
                    .setCustomId("table")
                    .setLabel("Serveur : achat / vente / échange")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(4000)
                    .setValue(String(table).slice(0, 4000)),
            ),
        );
}

export function simpleModal(typeId) {
    const type = TICKET_TYPES[typeId];
    const modal = new ModalBuilder()
        .setCustomId(`modal:simple:${typeId}`)
        .setTitle(`${type.label} — ta demande`.slice(0, 45));

    return modal.addComponents(
        textRow(
            new TextInputBuilder()
                .setCustomId("subject")
                .setLabel("Sujet")
                .setPlaceholder("ex : paiement non reçu")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(80),
        ),
        textRow(
            new TextInputBuilder()
                .setCustomId("details")
                .setLabel("Détails")
                .setPlaceholder("Explique ta situation le plus précisément possible")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(900),
        ),
        textRow(
            new TextInputBuilder()
                .setCustomId("reference")
                .setLabel("Référence de commande (optionnel)")
                .setPlaceholder("ex : vente-00042")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(40),
        ),
    );
}

export function renameModal() {
    return new ModalBuilder()
        .setCustomId("modal:rename")
        .setTitle("Renommer le ticket")
        .addComponents(
            textRow(
                new TextInputBuilder()
                    .setCustomId("name")
                    .setLabel("Nouveau nom du salon")
                    .setPlaceholder("ex : vente-00042-draconiros")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(80),
            ),
        );
}

/** Sent to the customer when their ticket is closed as delivered: the only way to leave a review. */
export function reviewButtonRow(ticketId, { done = false } = {}) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`review:open:${ticketId}`)
            .setLabel(done ? "Avis envoyé, merci !" : "Laisser mon avis")
            .setEmoji("⭐")
            .setStyle(done ? ButtonStyle.Secondary : ButtonStyle.Success)
            .setDisabled(done),
    );
}

export function reviewModal(ticketId) {
    return new ModalBuilder()
        .setCustomId(`modal:review:${ticketId}`)
        .setTitle("Laisser un avis")
        .addComponents(
            textRow(
                new TextInputBuilder()
                    .setCustomId("rating")
                    .setLabel("Note sur 5")
                    .setPlaceholder("5")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(1),
            ),
            textRow(
                new TextInputBuilder()
                    .setCustomId("text")
                    .setLabel("Ton avis")
                    .setPlaceholder("Transaction rapide, staff au top !")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(600),
            ),
        );
}
