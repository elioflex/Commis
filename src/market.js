import { CURRENCIES, currencyInfo, DOFUS_SERVERS, serverByCode, serverByName, serverLabel } from "../config.js";
import { read, setPath, deletePath } from "./store.js";

export const STOCK_STATUS = {
    open: { label: "🟢 Disponible", color: 0x57f287 },
    low: { label: "🟡 Stock limité", color: 0xf5b301 },
    full: { label: "🔴 Complet", color: 0xed4245 },
};

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

/** Our price as a share of the market price, per kind. Staff change it with `/rate auto`. */
export const DEFAULT_FEED_FACTORS = { buy: 1, sell: 0.7, exchange: 0.45 };

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

/** `factors` = { buy?, sell?, exchange? } as shares (0.7 = 70 % of the market price). */
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

/** Market reference in EUR/M (median of the shops read by the feed), or null. */
export function marketReference(serverCode) {
    const value = feedState().reference?.[serverCode]?.eur;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Automatic EUR price: market reference × our factor for this kind, rounded to the cent. */
export function autoPrice(serverCode, kind) {
    if (!feedEnabled()) return null;
    const reference = marketReference(serverCode);
    const factor = feedFactors()[kind];
    if (reference === null || !(factor > 0)) return null;
    return Math.max(0.01, Math.round(reference * factor * 100) / 100);
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

/**
 * The price actually charged, in order: a price pinned by staff, the automatic
 * web price, then base rate × multiplier. EUR prices are converted to other
 * currencies with the base-rate ratio, so the owner's spread per currency holds.
 */
export function effectiveRate(currency, kind, serverCode) {
    const fixed = serverCode ? serverPrice(serverCode, kind) ?? autoPrice(serverCode, kind) : null;
    if (fixed !== null) {
        const ratio = currencyRatio(currency, kind);
        return ratio === null ? null : Math.round(fixed * ratio * 1000) / 1000;
    }
    const base = rateFor(currency, kind);
    if (base === null) return null;
    return Math.round(base * serverMultiplier(serverCode) * 1000) / 1000;
}

/** "1,55 € · 1,67 $ · 1,32 £ · 16,68 DH · 1,73 ₮" for one server and kind. */
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
    const total = millions * rate;
    // Discount scale used by most marketplaces: bigger lots get a small rebate.
    const discount = kind === "echange" && millions >= 100 ? 0.1 : 0;
    return {
        kind,
        millions,
        rate,
        discount,
        total: total * (1 - discount),
    };
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

/**
 * Two lines per Dofus server: name (+ stock for buy/exchange), then its price
 * in every currency. Buy/exchange: in-stock servers first, cheapest first.
 * Sell: best payout first.
 */
export function serverRateLines(kind) {
    if (rateFor("EUR", kind) === null && !DOFUS_SERVERS.some((s) => effectiveRate("EUR", kind, s.code) !== null)) {
        return ["_Aucun prix configuré. Staff : `/rate tableau`._"];
    }

    const showStock = kind !== "sell";
    const rows = DOFUS_SERVERS.map((server) => ({
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

    return rows.map(({ name, summary, stock }) => {
        if (!showStock) return `**${name}**\n└ ${summary}`;
        const marker = stock.status === "open" ? "🟢" : stock.status === "low" ? "🟡" : "🔴";
        const stockText = stock.status === "full" ? "complet" : formatMillions(stock.millions);
        return `${marker} **${name}** · ${stockText}\n└ ${summary}`;
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

    return chunks.map((lines, index) => ({
        name: chunks.length > 1 ? `🖥️ Prix par serveur (${index + 1}/${chunks.length})` : "🖥️ Prix par serveur",
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
export function stockLines({ onlyAvailable = false } = {}) {
    const stock = read("market.json").stock ?? {};
    const lines = [];
    for (const code of Object.keys(stock)) {
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
    const stock = read("market.json").stock ?? {};
    const codes = Object.keys(stock);
    const open = codes.filter((c) => stockFor(c).status === "open").length;
    const low = codes.filter((c) => stockFor(c).status === "low").length;
    const total = codes.reduce((sum, c) => sum + stockFor(c).millions, 0);
    return { servers: codes.length, open, low, full: codes.length - open - low, totalMillions: total };
}

export const kindLabel = (kind) =>
    kind === "buy" ? "Achat client (nous vendons)" : kind === "sell" ? "Vente client (nous achetons)" : "Échange inter-serveurs";
