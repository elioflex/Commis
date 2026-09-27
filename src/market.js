import { CURRENCIES, currencyInfo, DOFUS_SERVERS, serverByCode } from "../config.js";
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
        return 1;
    }
    setPath("market.json", `serverRates.${serverCode}`, Math.round(parsed * 1000) / 1000);
    return parsed;
}

export function serverMultipliers() {
    return read("market.json").serverRates ?? {};
}

/** The price actually charged: base rate × server multiplier. */
export function effectiveRate(currency, kind, serverCode) {
    const base = rateFor(currency, kind);
    if (base === null) return null;
    return Math.round(base * serverMultiplier(serverCode) * 1000) / 1000;
}

export function setRate(currency, kind, value) {
    const code = String(currency).toUpperCase();
    setPath("market.json", `rates.${code}.${kind}`, value);
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
 * One line per Dofus server: its price for this kind, computed from the base
 * rate and its own multiplier. Sorted by price, cheapest first.
 */
export function serverRateLines(currency, kind) {
    const base = rateFor(currency, kind);
    if (base === null) return ["_Aucun taux de base configuré. Staff : `/rate set`._"];

    const { code, symbol } = currencyInfo(currency);
    const rows = DOFUS_SERVERS.map((server) => {
        const multiplier = serverMultiplier(server.code);
        const price = Math.round(base * multiplier * 1000) / 1000;
        return { name: server.name, multiplier, price, stock: stockFor(server.code) };
    }).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));

    const lines = rows.map(({ name, price, stock }) => {
        const marker = stock.status === "open" ? "🟢" : stock.status === "low" ? "🟡" : "🔴";
        const priceText = symbol ? `${price.toLocaleString("fr-FR")} ${symbol}` : `${price.toLocaleString("fr-FR")} ${code}`;
        return `${marker} **${name}** — ${priceText}/M`;
    });

    return lines.length ? lines : ["_Aucun serveur configuré._"];
}

/**
 * Discord embeds cap descriptions at 4096 characters; 24 servers × ~60 chars
 * fits comfortably, but guard anyway by splitting into two fields.
 */
export function serverRateFields(currency, kind) {
    const lines = serverRateLines(currency, kind);
    const mid = Math.ceil(lines.length / 2);
    return [
        { name: "🖥️ Serveurs (1/2)", value: lines.slice(0, mid).join("\n"), inline: false },
        { name: "🖥️ Serveurs (2/2)", value: lines.slice(mid).join("\n") || "—", inline: false },
    ];
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
            `${STOCK_STATUS[status].label} • **${info?.name ?? code}** — ${formatMillions(millions)}`,
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
