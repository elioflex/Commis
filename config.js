import "dotenv/config";

/**
 * Central brand + catalogue configuration.
 *
 * Everything that used to be hard-coded to the reference server's identity
 * lives here so you can rebrand the whole setup from `.env` / this one file.
 */

const str = (key, fallback) => {
    const value = process.env[key];
    return value === undefined || value.trim() === "" ? fallback : value.trim();
};

const snowflake = (key) => {
    const value = str(key, "");
    return /^\d{17,20}$/.test(value) ? value : null;
};

const int = (key, fallback) => {
    const value = Number.parseInt(str(key, ""), 10);
    return Number.isFinite(value) ? value : fallback;
};

export const BRAND = {
    /** Server name — shown on every panel, embed, transcript and in the footer. */
    name: str("BRAND_NAME", "Le Comptoir des Kamas"),
    /**
     * Shop icon. Keep it a merchant/shop emoji — it doubles as the friendly
     * mark in a few customer-facing messages, so avoid purely decorative ones.
     */
    emoji: str("BRAND_EMOJI", "🏪"),
    /** The bot's own display name (set in the Discord dev portal; echoed by the UI). */
    botName: str("BRAND_BOT_NAME", "Commis"),
    website: str("BRAND_WEBSITE", "https://example.com"),
    tagline: "Achat • Vente • Échange de kamas Dofus",
    colors: {
        brand: 0xf5b301,
        success: 0x57f287,
        danger: 0xed4245,
        info: 0x5865f2,
        neutral: 0x2b2d31,
    },
};

BRAND.footer = `${BRAND.name} • ${BRAND.tagline}`;

export const SETTINGS = {
    guildId: snowflake("GUILD_ID"),
    staffRoleId: snowflake("STAFF_ROLE_ID"),
    staffRoleName: str("STAFF_ROLE_NAME", "Staff"),
    managerRoleId: snowflake("MANAGER_ROLE_ID"),
    logChannelId: snowflake("LOG_CHANNEL_ID"),
    transcriptChannelId: snowflake("TRANSCRIPT_CHANNEL_ID"),
    closeAction: str("TICKET_CLOSE_ACTION", "delete") === "archive" ? "archive" : "delete",
    maxOpenPerUser: int("MAX_OPEN_TICKETS_PER_USER", 1),
    setupStepDelayMs: int("SETUP_STEP_DELAY_MS", 1500),

    /* ── state mirror (see src/persist.js) ── */
    // Channel that holds the state snapshot; /setup creates « ⚙️・gestion » for it.
    stateChannelId: snowflake("STATE_CHANNEL_ID"),
    stateMirror: str("STATE_MIRROR", "on") === "off" ? "off" : "on",
    // "when-empty" protects a rich local state, "always" is for throwaway hosts.
    stateImport: ["always", "when-empty", "off"].includes(str("STATE_IMPORT", "when-empty"))
        ? str("STATE_IMPORT", "when-empty")
        : "when-empty",
};

/** Currencies the bot quotes prices in. */
export const CURRENCIES = [
    { code: "EUR", label: "Euro", symbol: "€" },
    { code: "USD", label: "Dollar US", symbol: "$" },
    { code: "GBP", label: "Livre sterling", symbol: "£" },
    { code: "MAD", label: "Dirham marocain", symbol: "DH" },
    { code: "USDT", label: "Tether (USDT)", symbol: "₮" },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export const currencyInfo = (code) =>
    CURRENCIES.find((c) => c.code === code.toUpperCase()) ?? { code, label: code, symbol: "" };

/** Dofus servers you trade on. `code` is used in custom ids, so keep it short. */
export const DOFUS_SERVERS = [
    { code: "drac", name: "Draconiros" },
    { code: "tylezia", name: "Tylezia" },
    { code: "orukam", name: "Orukam" },
    { code: "imagiro", name: "Imagiro" },
    { code: "talkasha", name: "Talkasha" },
    { code: "ombre", name: "Ombre" },
    { code: "dakal", name: "Dakal" },
    { code: "mikhal", name: "Mikhal" },
    { code: "kourial", name: "Kourial" },
    { code: "rafal", name: "Rafal" },
    { code: "brial", name: "Brial" },
    { code: "salar", name: "Salar" },
    { code: "boune", name: "Boune" },
    { code: "fallanster", name: "Fallanster" },
    { code: "tiliwan", name: "Tiliwan" },
    { code: "kelerog", name: "Kelerog" },
    { code: "blair", name: "Blair" },
    { code: "talok", name: "Talok" },
    { code: "hellmina", name: "Hellmina" },
    { code: "allisteria", name: "Allisteria" },
    { code: "rubilax", name: "Rubilax" },
    { code: "pandora", name: "Pandora" },
    { code: "ogrest", name: "Ogrest" },
    { code: "autre", name: "Autre / mono-compte" },
];

export const serverByCode = (code) => DOFUS_SERVERS.find((s) => s.code === code) ?? null;
export const serverByName = (name) =>
    DOFUS_SERVERS.find((s) => s.name.toLowerCase() === String(name).toLowerCase()) ?? null;

/** Payment methods offered in the ticket modal. */
export const PAYMENT_METHODS = [
    { code: "paypal", label: "PayPal", emoji: "🅿️" },
    { code: "revolut", label: "Revolut", emoji: "🔷" },
    { code: "wise", label: "WISE", emoji: "🟩" },
    { code: "skrill", label: "Skrill", emoji: "🟪" },
    { code: "n26", label: "N26", emoji: "⬛" },
    { code: "vivid", label: "Vivid", emoji: "🟦" },
    { code: "sepa", label: "Virement SEPA", emoji: "🏦" },
    { code: "paysafecard", label: "PaySafeCard", emoji: "🟨" },
    { code: "bizum", label: "Bizum", emoji: "📲" },
    { code: "lydia", label: "Lydia", emoji: "🌀" },
    { code: "wafacash", label: "Wafacash", emoji: "💠" },
    { code: "cashplus", label: "CashPlus", emoji: "🎫" },
    { code: "poste_maroc", label: "Poste Maroc", emoji: "📮" },
    { code: "virement_ma", label: "Virement bancaire MA (CIH / BMCE / Attijari)", emoji: "🏛️" },
    { code: "usdt_trc20", label: "USDT (TRC20)", emoji: "💵" },
    { code: "usdc", label: "USDC (SOL / ERC20)", emoji: "💵" },
    { code: "btc", label: "Bitcoin", emoji: "🟠" },
    { code: "eth", label: "Ethereum", emoji: "🔹" },
    { code: "ltc", label: "Litecoin", emoji: "⚪" },
    { code: "sol", label: "Solana", emoji: "🟣" },
    { code: "autre", label: "Autre (préciser)", emoji: "➕" },
];

export const paymentByCode = (code) =>
    PAYMENT_METHODS.find((p) => p.code === code) ?? { code, label: code, emoji: "➕" };

/** The ticket kinds the bot understands. */
export const TICKET_TYPES = {
    achat: {
        id: "achat",
        label: "Achat de kamas",
        emoji: "💎",
        color: BRAND.colors.success,
        needsDofus: true,
        needsPayment: true,
        needsQuantity: true,
        blurb: "Tu achètes des kamas — le staff te livre en jeu.",
    },
    vente: {
        id: "vente",
        label: "Vente de kamas",
        emoji: "💸",
        color: BRAND.colors.brand,
        needsDofus: true,
        needsPayment: true,
        needsQuantity: true,
        blurb: "Tu vends tes kamas — le staff te paie au taux du jour.",
    },
    echange: {
        id: "echange",
        label: "Échange de kamas",
        emoji: "♻️",
        color: BRAND.colors.info,
        needsDofus: true,
        needsPayment: false,
        needsQuantity: true,
        blurb: "Transfert de kamas entre deux serveurs Dofus.",
    },
    support: {
        id: "support",
        label: "Support",
        emoji: "🎟️",
        color: BRAND.colors.info,
        needsDofus: false,
        needsPayment: false,
        needsQuantity: false,
        blurb: "Une question ou un souci ? Le staff arrive.",
    },
    remboursement: {
        id: "remboursement",
        label: "Remboursement",
        emoji: "↩️",
        color: BRAND.colors.danger,
        needsDofus: false,
        needsPayment: false,
        needsQuantity: false,
        blurb: "Ouvre un litige — le staff traite ton remboursement.",
    },
};

export const TICKET_TYPE_IDS = Object.keys(TICKET_TYPES);

/** Columns (categories) a ticket can be moved through. */
export const TICKET_STAGES = [
    { id: "nouveau", name: "🎟️ | Nouveaux tickets", emoji: "🎟️", label: "Nouveaux tickets" },
    { id: "preparation", name: "⏳ | En préparation", emoji: "⏳", label: "En préparation" },
    { id: "paiement", name: "💳 | En cours de paiement", emoji: "💳", label: "En cours de paiement" },
    { id: "termine", name: "✅ | Terminé", emoji: "✅", label: "Terminé" },
    { id: "archive", name: "🗄️ | Archivés", emoji: "🗄️", label: "Archivés" },
];

export const stageByName = (name) =>
    TICKET_STAGES.find((s) => s.name.toLowerCase() === String(name).toLowerCase()) ?? null;

/** Channels the panel buttons are posted into. `panel` links a channel to a ticket type. */
export const LAYOUT = [
    {
        name: "🏪 | Le Comptoir",
        channels: [
            { name: "📜・règles", topic: "📜 Règles du serveur — respect, sécurité, transactions." },
            { name: "🔔・annonces", topic: "📢 Annonces officielles du staff." },
            { name: "🔧・updates", topic: "🧩 Mises à jour et nouveautés." },
            { name: "❓・faq", topic: "❔ Questions fréquentes — à lire avant d'ouvrir un ticket." },
            { name: "🌟・points-vip", topic: "💰 Cumule des points VIP à chaque commande." },
            { name: "📊・sondage", topic: "🗳️ Sondages de la communauté." },
            { name: "🤝・partenaires", topic: "🤝 Partenaires officiels." },
        ],
    },
    {
        name: "🛒 | Marché",
        channels: [
            {
                name: "💎・acheter-kamas",
                panel: "achat",
                topic: "🛒 Clique sur le bouton ci-dessous pour acheter des kamas.\nLe bot t'affiche le taux du moment et le stock de ton serveur.",
            },
            {
                name: "💸・vendre-kamas",
                panel: "vente",
                topic: "🎟️ Clique sur le bouton ci-dessous pour vendre tes kamas.\nLe staff t'achète au taux affiché.",
            },
            {
                name: "♻️・échanger-kamas",
                panel: "echange",
                topic: "♻️ Échange tes kamas entre serveurs Dofus.\nLe bot affiche les taux et les stocks disponibles.",
            },
            { name: "📈・taux-du-jour", topic: "📈 Taux et stocks actuels, mis à jour par le staff." },
            { name: "⭐・avis-clients", topic: "⭐ Avis clients vérifiés." },
        ],
    },
    {
        name: "🧰 | Aide & Support",
        channels: [
            {
                name: "🎟️・ticket-support",
                panel: "support",
                topic: "🎟️ Appuie sur le bouton ci-dessous pour ouvrir un ticket — réponse rapide.",
            },
            { name: "📞・contact-support", topic: "📞 Notre équipe est à ton écoute 24/7." },
            {
                name: "↩️・remboursements",
                panel: "remboursement",
                topic: "↩️ Ouvre un ticket remboursement, le staff traite ton litige.",
            },
        ],
    },
    {
        name: "🌍 | Communauté",
        channels: [
            { name: "💬・français", topic: "🇫🇷 Espace francophone." },
            { name: "💬・english", topic: "🇬🇧 English speaking space." },
            { name: "💬・español", topic: "🇪🇸 Espacio hispanohablante." },
            { name: "💬・العربية", topic: "🇲🇦 فضاء الناطقين بالعربية." },
        ],
    },
    {
        name: "🎉 | Événements & Cadeaux",
        channels: [
            { name: "💸・promotions", topic: "💸 Promotions et offres du moment." },
            { name: "🤝・parrainage", topic: "🤝 Gagne des récompenses en parrainant tes amis." },
            { name: "🔥・hot-offres", topic: "🔥 Offres limitées dans le temps." },
            { name: "🎁・daily-gifts", topic: "🎁 Cadeau quotidien — connecte-toi chaque jour." },
            { name: "🏆・daily-winners", topic: "🏆 Gagnants du cadeau quotidien." },
            { name: "🎉・big-win", topic: "🎉 Tirages au sort et gros lots." },
        ],
    },
    {
        name: "🔊 | Salons Vocaux",
        channels: [
            { name: "🔊・discussion-générale", type: "voice" },
            { name: "🎮・gaming-room", type: "voice" },
            { name: "💰・business-talk", type: "voice" },
            { name: "🗣️・support-vocal", type: "voice" },
            { name: "VOC 1", type: "voice" },
            { name: "VOC 2", type: "voice" },
        ],
    },
    {
        name: "🔒 | Staff",
        staffOnly: true,
        channels: [
            { name: "📦・commandes", topic: "Suivi des commandes en cours." },
            { name: "💳・paiements", topic: "Preuves de paiement." },
            { name: "📝・détails-ventes", topic: "Détails des ventes." },
            { name: "⚙️・gestion", topic: "Gestion interne." },
            { name: "🤖・logs", topic: "Logs du bot." },
            { name: "📄・transcripts", topic: "Transcriptions des tickets fermés." },
        ],
    },
];

/** Roles created by `/setup`. */
export const ROLES = [
    { name: "Manager", color: 0xf1c40f, hoist: true },
    { name: "Staff", color: 0x19a0ff, hoist: true },
    { name: "Vérifié", color: 0x2ecc71, hoist: false },
    { name: "Français", color: 0x5865f2, hoist: false },
    { name: "English", color: 0x5865f2, hoist: false },
    { name: "Español", color: 0x5865f2, hoist: false },
    { name: "Arabe", color: 0x5865f2, hoist: false },
    { name: "VIP 1 ⭐", color: 0x74b9ff, hoist: false },
    { name: "VIP 2 ⭐⭐", color: 0x55efc4, hoist: false },
    { name: "VIP 3 ⭐⭐⭐", color: 0xffeaa7, hoist: false },
    { name: "VIP 4 ⭐⭐⭐⭐", color: 0xfab1a0, hoist: false },
    { name: "VIP 5 ⭐⭐⭐⭐⭐", color: 0xfd79a8, hoist: false },
    { name: "Daily Gifts", color: 0xff7675, hoist: true },
    ...DOFUS_SERVERS.filter((s) => s.code !== "autre").map((s) => ({
        name: s.name,
        color: 0x000000,
        hoist: false,
    })),
];
