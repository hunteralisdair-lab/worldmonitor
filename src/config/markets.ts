import type { Sector, Commodity, MarketSymbol } from '@/types';
import { SITE_VARIANT } from '@/config/variant';
import cryptoConfig from '../../shared/crypto.json';
import sectorConfig from '../../shared/sectors.json';
import commodityConfig from '../../shared/commodities.json';
import stocksConfig from '../../shared/stocks.json';

export const SECTORS: Sector[] = sectorConfig.sectors as Sector[];

export const COMMODITIES: Commodity[] = commodityConfig.commodities as Commodity[];

export interface CatalogSymbol extends MarketSymbol {
  region: string;
}

export const STOCK_CATALOG: CatalogSymbol[] = stocksConfig.symbols as CatalogSymbol[];

export const REGION_LABELS: Record<string, string> = stocksConfig.regions;

const CATALOG_BY_SYMBOL = new Map(STOCK_CATALOG.map((symbol) => [symbol.symbol, symbol]));

// UK-first default watchlist for the politics variant. Literals rather than
// catalog references because most (FTSE 250, GBP pairs, Brent) are not in the
// shared catalog; users can still add any symbol as a custom entry.
const UK_POLITICS_MARKET_SYMBOLS: MarketSymbol[] = [
  { symbol: '^FTSE',     name: 'FTSE 100',       display: 'FTSE 100' },
  { symbol: '^FTMC',     name: 'FTSE 250',       display: 'FTSE 250' },
  { symbol: 'GBPUSD=X',  name: 'Pound / Dollar', display: 'GBP/USD' },
  { symbol: 'GBPEUR=X',  name: 'Pound / Euro',   display: 'GBP/EUR' },
  { symbol: 'BZ=F',      name: 'Brent Crude',    display: 'BRENT' },
  { symbol: 'GC=F',      name: 'Gold',           display: 'GOLD' },
  { symbol: '^GSPC',     name: 'S&P 500',        display: 'S&P 500' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50',  display: 'STOXX 50' },
];

// Preserve the canonical current-main default order independently of catalog
// grouping/order. A missing default is a configuration error, not a silent drop.
export const MARKET_SYMBOLS: MarketSymbol[] = SITE_VARIANT === 'politics'
  ? UK_POLITICS_MARKET_SYMBOLS
  : stocksConfig.defaultSymbols.map((symbol) => {
    const entry = CATALOG_BY_SYMBOL.get(symbol);
    if (!entry) throw new Error(`Default market symbol is missing from catalog: ${symbol}`);
    return entry;
  });

export const CRYPTO_IDS = cryptoConfig.ids as readonly string[];
export const CRYPTO_MAP: Record<string, { name: string; symbol: string }> = cryptoConfig.meta;
