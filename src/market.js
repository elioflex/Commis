import { COMPETITORS, CURRENCIES, currencyInfo, DOFUS_SERVERS, GAMES, serverByCode, serverByName, serverLabel } from "../config.js";
import { read, setPath, deletePath } from "./store.js";

export const STOCK_STATUS = {
    open: { label: "🟢 Disponible", color: 0x57f287 },
    low: { label: "🟡 Stock limité", color: 0xf5b301 },
    // No stock right now: we still take the order and deliver once it's in. Never "complet".
    full: { label: "🕐 Sur commande", color: 0x5865f2 },
};

/** "🟢 250 M" / "🟡 20 M" / "🕐 sur commande" — what customers see for a server's stock. */
export function stockBadge(stock) {
    if (stock.status === "full") return "🕐 sur commande";
    return `${stock.status === "open" ? "🟢" : "🟡"} ${formatMillions(stock.millions)}`;
}

/** `buy` = we sell kamas to the customer, `sell` = we buy from them, `exchange` = cross-server. */
export const RATE_KINDS = ["buy", "sell", "exchange"];

export const market = () => read("market.json");

export function rateFor(currency, kind) {
    const code = String(currency).toUpperCase();
    const value = read("market.json").rates?.[code]?.[kind];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Per-server price multiplier, stored in market.json as `serverRates[code]`.
 * A value of 1.1 means this server's kamas cost 10% more than the base rate;
 * 0.9 means 10% cheaper. Servers without an entry use 1.
 */
export function serverMultiplier(serverCode) {
    if (!serverCode) return 1;
    const raw = read("market.json").serverRates?.[serverCode];
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 1;
}

/** Staff-facing setter. Pass 1 (or null) to reset a server to the base price. */
export function setServerMultiplier(serverCode, value) {
    const parsed = typeof value === "number" ? value : Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        deletePath("market.json", `serverRates.${serverCode}`);
        setRatesUpdated();
        return 1;
    }
    setPath("market.json", `serverRates.${serverCode}`, Math.round(parsed * 1000) / 1000);
    setRatesUpdated();
    return parsed;
}

export function serverMultipliers() {
    return read("market.json").serverRates ?? {};
}

/**
 * Fixed EUR price per million set by staff for one server and one kind, stored
 * in market.json as `serverPrices[code][kind]`. `null` when not set.
 */
export function serverPrice(serverCode, kind) {
    const raw = read("market.json").serverPrices?.[serverCode]?.[kind];
    const value = typeof raw === "number" ? raw : Number(raw);
    return raw != null && Number.isFinite(value) && value > 0 ? value : null;
}

/** Staff-facing setter. Pass null (or 0) to go back to base rate × multiplier. */
export function setServerPrice(serverCode, kind, value) {
    const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
        deletePath("market.json", `serverPrices.${serverCode}.${kind}`);
        setRatesUpdated();
        return null;
    }
    const rounded = Math.round(parsed * 1000) / 1000;
    setPath("market.json", `serverPrices.${serverCode}.${kind}`, rounded);
    setRatesUpdated();
    return rounded;
}

/* ───────────── automatic prices (filled by src/price-feed.js) ───────────── */

/**
 * Our price as a share of the best competitor, per kind. Managers change it with
 * `/rate auto`. buy = what we charge (share of the cheapest shop: 0.97 = 3 %
 * cheaper), sell = what we pay (share of the best payout: 1.03 = 3 % more),
 * exchange = share of the market's median retail price.
 */
export const DEFAULT_FEED_FACTORS = { buy: 0.97, sell: 1.03, exchange: 0.45 };

/** Without a payout source for a server, shops typically pay ~70 % of their retail price. */
export const RETAIL_TO_PAYOUT = 0.7;

/**
 * What we pay a seller never goes above our own sale price minus this share,
 * so an automatic price or an adjustment can't make us lose money on a server.
 */
export const MIN_MARGIN = 0.05;

/** A single shop's price counts for "best competitor" only within this share of the median. */
const BEST_SPREAD = 0.15;

/** Competitor prices are shown publicly only while the last successful fetch is this recent. */
const COMPARISON_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Per-server manager adjustment, in %, is capped to keep a typo from wrecking prices. */
export const MAX_ADJUST = 50;

export const feedState = () => read("market.json").feed ?? {};

export const feedEnabled = () => feedState().enabled !== false;

export function feedFactors() {
    return { ...DEFAULT_FEED_FACTORS, ...(feedState().factors ?? {}) };
}

export function setFeedEnabled(enabled) {
    setPath("market.json", "feed.enabled", Boolean(enabled));
    setRatesUpdated();
    return Boolean(enabled);
}

/** `factors` = { buy?, sell?, exchange? } as shares (0.97 = 97 % of the best competitor). */
export function setFeedFactors(factors) {
    for (const kind of RATE_KINDS) {
        const value = factors?.[kind];
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            setPath("market.json", `feed.factors.${kind}`, Math.round(value * 1000) / 1000);
        }
    }
    setRatesUpdated();
    return feedFactors();
}

const positive = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/** Market reference in EUR/M (median of the shops read by the feed), or null. */
export function marketReference(serverCode) {
    return positive(feedState().reference?.[serverCode]?.eur);
}

/** What shops pay players for this server, in EUR/M: leskamas.com, else estimated from retail. */
export function payoutReference(serverCode) {
    const value = positive(feedState().sellReference?.[serverCode]?.eur);
    if (value !== null) return value;
    const retail = marketReference(serverCode);
    return retail === null ? null : Math.round(retail * RETAIL_TO_PAYOUT * 10_000) / 10_000;
}

/**
 * Each competitor's price for this server, as last read by the feed:
 * `{ kamasv: 0.77, "1kamas": 0.8 }` for buy (what they charge), `{ leskamas: 0.52 }`
 * for sell (what they pay). Empty for exchange, which no shop publishes.
 */
export function competitorPrices(serverCode, kind) {
    const entry = kind === "buy" ? feedState().reference?.[serverCode] : kind === "sell" ? feedState().sellReference?.[serverCode] : null;
    const prices = {};
    for (const [site, value] of Object.entries(entry?.sources ?? {})) {
        if (positive(value) !== null) prices[site] = value;
    }
    return prices;
}

/**
 * The price to beat: the cheapest shop for buy, the best payout for sell. A shop
 * far from the others (bad listing, typo on their site) is pulled back to the
 * median ± 15 % so one outlier can't drag our price with it.
 */
export function bestCompetitorPrice(serverCode, kind) {
    const median = kind === "sell" ? payoutReference(serverCode) : marketReference(serverCode);
    if (median === null) return null;
    const values = Object.values(competitorPrices(serverCode, kind));
    if (!values.length) return median;
    if (kind === "sell") return Math.min(Math.max(...values), median * (1 + BEST_SPREAD));
    return Math.max(Math.min(...values), median * (1 - BEST_SPREAD));
}

/**
 * Round to the cent in the customer's favour, so a small edge never rounds back
 * to the competitor's price: down for what we charge, up for what we pay.
 */
function roundForCustomer(value, kind) {
    const cents = kind === "sell" ? Math.ceil(value * 100 - 1e-9) : Math.floor(value * 100 + 1e-9);
    return Math.max(0.01, cents / 100);
}

/** Automatic EUR price, before the manager's per-server adjustment. */
function webPrice(serverCode, kind) {
    if (!feedEnabled()) return null;
    const factor = feedFactors()[kind];
    const reference = kind === "exchange" ? marketReference(serverCode) : bestCompetitorPrice(serverCode, kind);
    if (reference === null || !(factor > 0)) return null;
    return reference * factor;
}

/** Manager's fine-tuning for one server and kind, in % (-2 = 2 % lower). 0 when not set. */
export function serverAdjustment(serverCode, kind) {
    const value = Number(read("market.json").adjustments?.[serverCode]?.[kind]);
    return Number.isFinite(value) ? value : 0;
}

/** Set (or clear with 0) the adjustment of several servers for several kinds at once. */
export function setServerAdjustments(serverCodes, kinds, percent) {
    const value = Math.round(Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, Number(percent) || 0)) * 100) / 100;
    for (const code of serverCodes) {
        for (const kind of kinds) {
            if (value === 0) deletePath("market.json", `adjustments.${code}.${kind}`);
            else setPath("market.json", `adjustments.${code}.${kind}`, value);
        }
    }
    setRatesUpdated();
    return value;
}

const simplify = (text) =>
    String(text ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

/**
 * Turn what a manager types into server codes: "tous" (or "dofus") or names
 * separated by commas ("drac, ombre, mikhal").
 */
export function resolveServers(text) {
    const priced = DOFUS_SERVERS.filter((server) => server.game);
    const codes = new Set();
    const unknown = [];
    for (const part of String(text ?? "").split(/[,;+\n]/)) {
        const key = simplify(part);
        if (!key) continue;
        if (["tous", "tout", "all", "touslesserveurs"].includes(key)) {
            for (const server of priced) codes.add(server.code);
            continue;
        }
        const game = Object.entries(GAMES).find(([id, info]) => key === id || key === simplify(info.label) || key === simplify(info.short));
        if (game) {
            for (const server of priced.filter((s) => s.game === game[0])) codes.add(server.code);
            continue;
        }
        const server = priced.find((s) => [s.code, s.name, ...(s.aliases ?? [])].some((name) => simplify(name) === key));
        if (server) codes.add(server.code);
        else unknown.push(part.trim());
    }
    return { codes: [...codes], unknown };
}

/** Automatic EUR price: best competitor × our factor × the server's adjustment, rounded for the customer. */
export function autoPrice(serverCode, kind) {
    const web = webPrice(serverCode, kind);
    if (web === null) return null;
    return roundForCustomer(web * (1 + serverAdjustment(serverCode, kind) / 100), kind);
}

/** Where a server's price comes from: "manuel" (pinned by staff), "auto" (web) or "base". */
export function priceSource(serverCode, kind) {
    if (serverPrice(serverCode, kind) !== null) return "manuel";
    if (autoPrice(serverCode, kind) !== null) return "auto";
    return "base";
}

/**
 * How many units of `currency` one euro is worth for this kind, taken from the
 * base rate table (so the owner's own spread per currency is kept).
 */
function currencyRatio(currency, kind) {
    const code = String(currency).toUpperCase();
    if (code === "EUR") return 1;
    const eur = rateFor("EUR", kind);
    const other = rateFor(code, kind);
    return eur && other ? other / eur : null;
}

/** EUR price before the margin guard: manual, else web, else base × multiplier × adjustment. */
function rawEurPrice(serverCode, kind) {
    const manual = serverCode ? serverPrice(serverCode, kind) : null;
    if (manual !== null) return { eur: manual, manual: true };
    const auto = serverCode ? autoPrice(serverCode, kind) : null;
    if (auto !== null) return { eur: auto, manual: false };
    const base = rateFor("EUR", kind);
    if (base === null) return null;
    const adjusted = base * serverMultiplier(serverCode) * (1 + serverAdjustment(serverCode, kind) / 100);
    return { eur: Math.round(adjusted * 1000) / 1000, manual: false };
}

/**
 * The EUR price actually used. What we pay (sell) is capped at our own sale price
 * minus MIN_MARGIN, unless staff pinned the sell price by hand. `capped` tells
 * the staff views that the guard kicked in.
 */
export function eurPrice(serverCode, kind) {
    const raw = rawEurPrice(serverCode, kind);
    if (!raw || kind !== "sell" || raw.manual || !serverCode) return raw && { ...raw, capped: false };
    const buy = rawEurPrice(serverCode, "buy");
    if (!buy) return { ...raw, capped: false };
    const ceiling = Math.floor(buy.eur * (1 - MIN_MARGIN) * 100 + 1e-9) / 100;
    return raw.eur > ceiling ? { eur: ceiling, manual: false, capped: true } : { ...raw, capped: false };
}

/**
 * The price actually charged, in order: a price pinned by staff, the automatic
 * web price, then base rate × multiplier. EUR prices are converted to other
 * currencies with the base-rate ratio, so the owner's spread per currency holds.
 */
export function effectiveRate(currency, kind, serverCode) {
    if (!serverCode) {
        const base = rateFor(currency, kind);
        return base === null ? null : Math.round(base * 1000) / 1000;
    }
    const price = eurPrice(serverCode, kind);
    if (!price) return null;
    const ratio = currencyRatio(currency, kind);
    return ratio === null ? null : Math.round(price.eur * ratio * 1000) / 1000;
}

/**
 * How we compare with each competitor, only where we are better and only while
 * the competitors' prices are fresh: `[{ site, price, gap }]`, gap in % (always
 * positive: how much cheaper we sell, or how much more we pay).
 */
export function competitorEdge(serverCode, kind) {
    if (kind === "exchange" || !feedEnabled()) return [];
    const fetchedAt = Date.parse(feedState().fetchedAt ?? "");
    if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > COMPARISON_MAX_AGE_MS) return [];
    const ours = eurPrice(serverCode, kind)?.eur;
    if (!positive(ours)) return [];

    return Object.entries(competitorPrices(serverCode, kind))
        .map(([site, price]) => ({ site, price, gap: kind === "sell" ? (ours - price) / price : (price - ours) / price }))
        .filter(({ gap }) => gap > 0)
        .map((entry) => ({ ...entry, gap: Math.round(entry.gap * 1000) / 10 }))
        .sort((a, b) => b.gap - a.gap);
}

/** "1,55 € · 16,68 DH" for one server and kind. */
export function serverPriceSummary(kind, serverCode) {
    const cells = CURRENCIES.map((currency) => {
        const rate = effectiveRate(currency.code, kind, serverCode);
        return rate === null ? null : formatMoney(rate, currency.code);
    }).filter(Boolean);
    return cells.length ? cells.join(" · ") : "à confirmer";
}

export function setRate(currency, kind, value) {
    const code = String(currency).toUpperCase();
    setPath("market.json", `rates.${code}.${kind}`, value);
    setRatesUpdated();
    return value;
}

export function setRatesUpdated() {
    setPath("market.json", "updatedAt", new Date().toISOString());
}

export function stockFor(serverCode) {
    const entry = read("market.json").stock?.[serverCode];
    if (!entry) return { millions: 0, status: "full" };
    return {
        millions: Number(entry.millions) || 0,
        status: STOCK_STATUS[entry.status] ? entry.status : "full",
    };
}

export function setStock(serverCode, millions, status) {
    setPath("market.json", `stock.${serverCode}`, { millions, status });
    setRatesUpdated();
}

/** Total price in `currency` for `millions` kamas at `rate` per million. */
export function quote(kind, millions, rate) {
    if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
    if (typeof millions !== "number" || !Number.isFinite(millions) || millions <= 0) return null;
    return { kind, millions, rate, total: millions * rate };
}

/* ───────────── cross-server exchange ───────────── */

/** Our cut on an exchange, in %, stored in market.json as `exchangeFee`. */
export const DEFAULT_EXCHANGE_FEE = 10;
export const MAX_EXCHANGE_FEE = 50;

export function exchangeFee() {
    const value = Number(read("market.json").exchangeFee);
    return Number.isFinite(value) && value >= 0 && value <= MAX_EXCHANGE_FEE ? value : DEFAULT_EXCHANGE_FEE;
}

/** Manager-facing setter, in % (10 = 10 %). Returns the value stored. */
export function setExchangeFee(percent) {
    const clamped = Math.min(MAX_EXCHANGE_FEE, Math.max(0, Math.round(Number(percent) * 10) / 10));
    setPath("market.json", "exchangeFee", Number.isFinite(clamped) ? clamped : DEFAULT_EXCHANGE_FEE);
    setRatesUpdated();
    return exchangeFee();
}

/**
 * Exchange value: kamas are worth our sale price on each server, minus our fee.
 * received = given × (price on source ÷ price on destination) × (1 − fee).
 * Brial 0,38 € → Dakal 0,40 € at 10 %: 1000 M given = 855 M received.
 * Null when a server has no price or both servers are the same.
 */
export function exchangeQuote(fromCode, toCode, given) {
    if (!serverByCode(fromCode) || !serverByCode(toCode) || fromCode === toCode) return null;
    if (typeof given !== "number" || !Number.isFinite(given) || given <= 0) return null;
    const from = eurPrice(fromCode, "buy")?.eur;
    const to = eurPrice(toCode, "buy")?.eur;
    if (!positive(from) || !positive(to)) return null;

    const fee = exchangeFee();
    const ratio = (from / to) * (1 - fee / 100);
    // Round down to 10 000 kamas: we never promise more than the rate gives.
    const received = Math.floor(given * ratio * 100 + 1e-9) / 100;
    return { from: fromCode, to: toCode, given, fee, fromPrice: from, toPrice: to, ratio, received };
}

export function formatMoney(amount, currency) {
    const { code, symbol } = currencyInfo(currency);
    if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
    const decimals = Math.abs(amount) >= 100 ? 0 : 2;
    const formatted = amount.toLocaleString("fr-FR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
    return symbol ? `${formatted} ${symbol}` : `${formatted} ${code}`;
}

export function formatMillions(millions) {
    if (typeof millions !== "number" || !Number.isFinite(millions)) return "—";
    return `${millions.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M`;
}

/** Parse user input such as "12", "12.5m", "1 200 000" into millions. */
export function parseMillions(input) {
    if (typeof input === "number") return Number.isFinite(input) ? input : null;
    const raw = String(input ?? "").trim().toLowerCase().replace(/[\s_']/g, "");
    if (!raw) return null;

    const match = raw.match(/^(\d+(?:[.,]\d+)?)\s*(m|k|kk|millions?|milliards?)?$/);
    if (!match) return null;

    const value = Number.parseFloat(match[1].replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return null;

    const unit = match[2] ?? "";
    if (unit === "k" || unit === "kk") return value / 1000;
    if (unit === "milliard" || unit === "milliards") return value * 1000;
    return value;
}

const formatGap = (gap) => gap.toLocaleString("fr-FR", { maximumFractionDigits: gap < 10 ? 1 : 0 });

/**
 * "🏆 -4 % vs KamasV (0,77 €) · -8 % vs 1Kamas (0,80 €)" under a server on the
 * buy side, "🏆 +6 % vs LesKamas (0,52 €)" on the sell side. Null when we don't
 * beat anyone there: we never show a comparison that makes us look worse.
 */
export function edgeLine(serverCode, kind) {
    const edges = competitorEdge(serverCode, kind);
    if (!edges.length) return null;
    const sign = kind === "sell" ? "+" : "-";
    const cells = edges.map(
        ({ site, price, gap }) => `${sign}${formatGap(gap)} % vs ${COMPETITORS[site] ?? site} (${formatMoney(price, "EUR")})`,
    );
    return `  🏆 ${cells.join(" · ")}`;
}

/**
 * Two lines per Dofus server: name (+ stock for buy/exchange), then its price
 * in every currency. Buy/exchange: in-stock servers first, cheapest first.
 * Sell: best payout first.
 */
export function serverRateLines(kind) {
    // An exchange is valued at our sale price on each server: list those, with stock.
    if (kind === "exchange") return exchangeValueLines();
    if (rateFor("EUR", kind) === null && !DOFUS_SERVERS.some((s) => effectiveRate("EUR", kind, s.code) !== null)) {
        return ["_Aucun prix configuré. Staff : `/rate tableau`._"];
    }

    const showStock = kind !== "sell";
    const rows = DOFUS_SERVERS.map((server) => ({
        code: server.code,
        name: serverLabel(server),
        price: effectiveRate("EUR", kind, server.code) ?? Number.POSITIVE_INFINITY,
        summary: serverPriceSummary(kind, server.code),
        stock: stockFor(server.code),
    }));

    rows.sort((a, b) => {
        if (showStock) {
            const aFull = a.stock.status === "full" ? 1 : 0;
            const bFull = b.stock.status === "full" ? 1 : 0;
            if (aFull !== bFull) return aFull - bFull;
            return a.price - b.price || a.name.localeCompare(b.name);
        }
        return b.price - a.price || a.name.localeCompare(b.name);
    });

    return rows.map(({ code, name, summary, stock }) => {
        const edge = edgeLine(code, kind);
        const tail = edge ? `\n${edge}` : "";
        if (!showStock) return `**${name}**\n└ ${summary}${tail}`;
        return `**${name}** · ${stockBadge(stock)}\n└ ${summary}${tail}`;
    });
}

/**
 * "🟢 **Draconiros** · 1 200 M" — the exchange displays show stock only, no
 * prices: customers get their exact amount from the 🧮 simulator. In-stock first.
 */
function exchangeValueLines() {
    const order = { open: 0, low: 1, full: 2 };
    const rows = DOFUS_SERVERS.map((server) => ({ name: serverLabel(server), stock: stockFor(server.code) }));
    rows.sort((a, b) => order[a.stock.status] - order[b.stock.status] || b.stock.millions - a.stock.millions || a.name.localeCompare(b.name));
    return rows.map(({ name, stock }) => {
        return `**${name}** · ${stockBadge(stock)}`;
    });
}

/** Discord caps a field value at 1024 characters: pack lines into as many fields as needed. */
export function serverRateFields(kind) {
    const chunks = [];
    let current = [];
    let length = 0;
    for (const line of serverRateLines(kind)) {
        if (current.length && length + line.length + 1 > 1024) {
            chunks.push(current);
            current = [];
            length = 0;
        }
        current.push(line);
        length += line.length + 1;
    }
    if (current.length) chunks.push(current);

    const title = kind === "exchange" ? "📦 Stock par serveur" : "🖥️ Prix par serveur";
    return chunks.map((lines, index) => ({
        name: chunks.length > 1 ? `${title} (${index + 1}/${chunks.length})` : title,
        value: lines.join("\n"),
        inline: false,
    }));
}

/** "Draconiros : 1,55 / 1,10 / 0,70" — the bulk editor shown in `/rate tableau`. */
export function formatPriceTable() {
    const cell = (code, kind) => {
        const value = effectiveRate("EUR", kind, code);
        return value === null ? "-" : value.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
    };
    return DOFUS_SERVERS.map(
        (server) => `${server.name} : ${cell(server.code, "buy")} / ${cell(server.code, "sell")} / ${cell(server.code, "exchange")}`,
    ).join("\n");
}

/**
 * Parse the bulk editor. One line per server: `Nom : achat / vente / échange`
 * (EUR per million). `-` leaves that price untouched.
 */
export function parsePriceTable(text) {
    const updates = [];
    const errors = [];
    const kinds = ["buy", "sell", "exchange"];

    for (const [index, rawLine] of String(text ?? "").split(/\r?\n/).entries()) {
        const line = rawLine.trim();
        if (!line) continue;

        const match = line.match(/^(.+?)\s*:\s*(.+)$/);
        const server = match && (serverByName(match[1].trim()) ?? serverByCode(match[1].trim().toLowerCase()));
        if (!server) {
            errors.push(`Ligne ${index + 1} : serveur inconnu (« ${line.slice(0, 40)} »)`);
            continue;
        }

        const cells = match[2].split("/").map((cell) => cell.trim());
        if (cells.length !== 3) {
            errors.push(`Ligne ${index + 1} : il faut 3 prix (achat / vente / échange) pour ${server.name}`);
            continue;
        }

        cells.forEach((cell, position) => {
            if (cell === "-" || cell === "") return;
            const value = Number.parseFloat(cell.replace(",", "."));
            if (!Number.isFinite(value) || value <= 0 || !/^\d+(?:[.,]\d+)?$/.test(cell)) {
                errors.push(`Ligne ${index + 1} : prix invalide « ${cell} » pour ${server.name}`);
                return;
            }
            updates.push({ serverCode: server.code, kind: kinds[position], price: value });
        });
    }

    return { updates, errors };
}

/** Lines describing the current rate table, per currency. */
export function rateLines({ kinds = RATE_KINDS } = {}) {
    const rates = read("market.json").rates ?? {};
    const lines = [];
    for (const currency of CURRENCIES) {
        const entry = rates[currency.code] ?? {};
        const cells = kinds
            .filter((kind) => typeof entry[kind] === "number")
            .map((kind) => {
                const label = kind === "buy" ? "Achat client" : kind === "sell" ? "Vente client" : "Échange";
                return `${label} : **${formatMoney(entry[kind], currency.code)}**/M`;
            });
        if (cells.length) lines.push(`**${currency.code}** — ${cells.join(" • ")}`);
    }
    return lines.length ? lines : ["_Aucun taux configuré. Staff : utilise `/rate set`._"];
}

/** Lines describing stock per Dofus server. */
/** Stocked server codes, skipping servers no longer sold (old Touch / Retro / Wakfu entries). */
const stockedCodes = () => Object.keys(read("market.json").stock ?? {}).filter((code) => serverByCode(code));

export function stockLines({ onlyAvailable = false } = {}) {
    const lines = [];
    for (const code of stockedCodes()) {
        const info = serverByCode(code);
        const { millions, status } = stockFor(code);
        if (onlyAvailable && status === "full") continue;
        lines.push(
            `${STOCK_STATUS[status].label} • **${serverLabel(info) || code}** — ${formatMillions(millions)}`,
        );
    }
    return lines.length ? lines : ["_Aucun stock configuré. Staff : utilise `/stock set`._"];
}

export function stockSummary() {
    const codes = stockedCodes();
    const open = codes.filter((c) => stockFor(c).status === "open").length;
    const low = codes.filter((c) => stockFor(c).status === "low").length;
    const total = codes.reduce((sum, c) => sum + stockFor(c).millions, 0);
    return { servers: codes.length, open, low, full: codes.length - open - low, totalMillions: total };
}

export const kindLabel = (kind) =>
    kind === "buy" ? "Achat client (nous vendons)" : kind === "sell" ? "Vente client (nous achetons)" : "Échange inter-serveurs";
