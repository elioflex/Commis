import { CURRENCIES, currencyInfo, serverByCode } from "../config.js";
import { read, setPath } from "./store.js";

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
