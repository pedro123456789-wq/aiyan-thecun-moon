// src/providers/token.ts
import { settings } from "@ai16z/eliza";
import NodeCache2 from "node-cache";
import * as path from "path";

// src/bignumber.ts
import BigNumber from "bignumber.js";
function toBN(value) {
  return new BigNumber(value);
}

// src/providers/wallet.ts
import { Connection, PublicKey } from "@solana/web3.js";
import BigNumber2 from "bignumber.js";
import NodeCache from "node-cache";
var PROVIDER_CONFIG = {
  BIRDEYE_API: "https://public-api.birdeye.so",
  MAX_RETRIES: 3,
  RETRY_DELAY: 2e3,
  DEFAULT_RPC: "https://api.mainnet-beta.solana.com",
  TOKEN_ADDRESSES: {
    SOL: "So11111111111111111111111111111111111111112",
    BTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
    ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"
  }
};
var WalletProvider = class {
  constructor(connection2, walletPublicKey) {
    this.connection = connection2;
    this.walletPublicKey = walletPublicKey;
    this.cache = new NodeCache({ stdTTL: 300 });
  }
  cache;
  async fetchWithRetry(runtime, url, options = {}) {
    let lastError;
    for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            Accept: "application/json",
            "x-chain": "solana",
            "X-API-KEY": runtime.getSetting("BIRDEYE_API_KEY", "") || "",
            ...options.headers
          }
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `HTTP error! status: ${response.status}, message: ${errorText}`
          );
        }
        const data = await response.json();
        return data;
      } catch (error) {
        console.error(`Attempt ${i + 1} failed:`, error);
        lastError = error;
        if (i < PROVIDER_CONFIG.MAX_RETRIES - 1) {
          const delay = PROVIDER_CONFIG.RETRY_DELAY * Math.pow(2, i);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
    }
    console.error(
      "All attempts failed. Throwing the last error:",
      lastError
    );
    throw lastError;
  }
  async fetchPortfolioValue(runtime) {
    try {
      const cacheKey = `portfolio-${this.walletPublicKey.toBase58()}`;
      const cachedValue = this.cache.get(cacheKey);
      if (cachedValue) {
        console.log("Cache hit for fetchPortfolioValue");
        return cachedValue;
      }
      console.log("Cache miss for fetchPortfolioValue");
      const walletData = await this.fetchWithRetry(
        runtime,
        `${PROVIDER_CONFIG.BIRDEYE_API}/v1/wallet/token_list?wallet=${this.walletPublicKey.toBase58()}`
      );
      if (!walletData?.success || !walletData?.data) {
        console.error("No portfolio data available", walletData);
        throw new Error("No portfolio data available");
      }
      const data = walletData.data;
      const totalUsd = new BigNumber2(data.totalUsd.toString());
      const prices = await this.fetchPrices(runtime);
      const solPriceInUSD = new BigNumber2(prices.solana.usd.toString());
      const items = data.items.map((item) => ({
        ...item,
        valueSol: new BigNumber2(item.valueUsd || 0).div(solPriceInUSD).toFixed(6),
        name: item.name || "Unknown",
        symbol: item.symbol || "Unknown",
        priceUsd: item.priceUsd || "0",
        valueUsd: item.valueUsd || "0"
      }));
      const totalSol = totalUsd.div(solPriceInUSD);
      const portfolio = {
        totalUsd: totalUsd.toString(),
        totalSol: totalSol.toFixed(6),
        items: items.sort(
          (a, b) => new BigNumber2(b.valueUsd).minus(new BigNumber2(a.valueUsd)).toNumber()
        )
      };
      this.cache.set(cacheKey, portfolio);
      return portfolio;
    } catch (error) {
      console.error("Error fetching portfolio:", error);
      throw error;
    }
  }
  async fetchPrices(runtime) {
    try {
      const cacheKey = "prices";
      const cachedValue = this.cache.get(cacheKey);
      if (cachedValue) {
        console.log("Cache hit for fetchPrices");
        return cachedValue;
      }
      console.log("Cache miss for fetchPrices");
      const { SOL, BTC, ETH } = PROVIDER_CONFIG.TOKEN_ADDRESSES;
      const tokens = [SOL, BTC, ETH];
      const prices = {
        solana: { usd: "0" },
        bitcoin: { usd: "0" },
        ethereum: { usd: "0" }
      };
      for (const token of tokens) {
        const response = await this.fetchWithRetry(
          runtime,
          `${PROVIDER_CONFIG.BIRDEYE_API}/defi/price?address=${token}`,
          {
            headers: {
              "x-chain": "solana"
            }
          }
        );
        if (response?.data?.value) {
          const price = response.data.value.toString();
          prices[token === SOL ? "solana" : token === BTC ? "bitcoin" : "ethereum"].usd = price;
        } else {
          console.warn(`No price data available for token: ${token}`);
        }
      }
      this.cache.set(cacheKey, prices);
      return prices;
    } catch (error) {
      console.error("Error fetching prices:", error);
      throw error;
    }
  }
  formatPortfolio(runtime, portfolio, prices) {
    let output = `${runtime.character.description}
`;
    output += `Wallet Address: ${this.walletPublicKey.toBase58()}

`;
    const totalUsdFormatted = new BigNumber2(portfolio.totalUsd).toFixed(2);
    const totalSolFormatted = portfolio.totalSol;
    output += `Total Value: $${totalUsdFormatted} (${totalSolFormatted} SOL)

`;
    output += "Token Balances:\n";
    const nonZeroItems = portfolio.items.filter(
      (item) => new BigNumber2(item.uiAmount).isGreaterThan(0)
    );
    if (nonZeroItems.length === 0) {
      output += "No tokens found with non-zero balance\n";
    } else {
      for (const item of nonZeroItems) {
        const valueUsd = new BigNumber2(item.valueUsd).toFixed(2);
        output += `${item.name} (${item.symbol}): ${new BigNumber2(
          item.uiAmount
        ).toFixed(6)} ($${valueUsd} | ${item.valueSol} SOL)
`;
      }
    }
    output += "\nMarket Prices:\n";
    output += `SOL: $${new BigNumber2(prices.solana.usd).toFixed(2)}
`;
    output += `BTC: $${new BigNumber2(prices.bitcoin.usd).toFixed(2)}
`;
    output += `ETH: $${new BigNumber2(prices.ethereum.usd).toFixed(2)}
`;
    return output;
  }
  async getFormattedPortfolio(runtime) {
    try {
      const [portfolio, prices] = await Promise.all([
        this.fetchPortfolioValue(runtime),
        this.fetchPrices(runtime)
      ]);
      return this.formatPortfolio(runtime, portfolio, prices);
    } catch (error) {
      console.error("Error generating portfolio report:", error);
      return "Unable to fetch wallet information. Please try again later.";
    }
  }
};
var walletProvider = {
  get: async (runtime, _message, _state) => {
    try {
      if (!runtime.getSetting("WALLET_PUBLIC_KEY")) {
        console.error(
          "Wallet public key is not configured in settings"
        );
        return "";
      }
      if (typeof runtime.getSetting("WALLET_PUBLIC_KEY") !== "string" || runtime.getSetting("WALLET_PUBLIC_KEY").trim() === "") {
        console.error("Invalid wallet public key format");
        return "";
      }
      let publicKey;
      try {
        publicKey = new PublicKey(
          runtime.getSetting("WALLET_PUBLIC_KEY")
        );
      } catch (error) {
        console.error("Error creating PublicKey:", error);
        return "";
      }
      const connection2 = new Connection(PROVIDER_CONFIG.DEFAULT_RPC);
      const provider = new WalletProvider(connection2, publicKey);
      const porfolio = await provider.getFormattedPortfolio(runtime);
      return porfolio;
    } catch (error) {
      console.error("Error in wallet provider:", error.message);
      return `Failed to fetch wallet information: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }
};

// src/providers/token.ts
import { Connection as Connection2, PublicKey as PublicKey2 } from "@solana/web3.js";
var PROVIDER_CONFIG2 = {
  BIRDEYE_API: "https://public-api.birdeye.so",
  MAX_RETRIES: 3,
  RETRY_DELAY: 2e3,
  DEFAULT_RPC: "https://api.mainnet-beta.solana.com",
  TOKEN_ADDRESSES: {
    SOL: "So11111111111111111111111111111111111111112",
    BTC: "qfnqNqs3nCAHjnyCgLRDbBtq4p2MtHZxw8YjSyYhPoL",
    ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    Example: "2weMjPLLybRMMva1fM3U31goWWrCpF59CHWNhnCJ9Vyh"
  },
  TOKEN_SECURITY_ENDPOINT: "/defi/token_security?address=",
  TOKEN_TRADE_DATA_ENDPOINT: "/defi/v3/token/trade-data/single?address=",
  DEX_SCREENER_API: "https://api.dexscreener.com/latest/dex/tokens/",
  MAIN_WALLET: ""
};
var TokenProvider = class {
  constructor(tokenAddress2, walletProvider2, cacheManager) {
    this.tokenAddress = tokenAddress2;
    this.walletProvider = walletProvider2;
    this.cacheManager = cacheManager;
    this.cache = new NodeCache2({ stdTTL: 300 });
  }
  cache;
  cacheKey = "solana/tokens";
  async readFromCache(key) {
    const cached = await this.cacheManager.get(
      path.join(this.cacheKey, key)
    );
    return cached;
  }
  async writeToCache(key, data) {
    await this.cacheManager.set(path.join(this.cacheKey, key), data, {
      expires: Date.now() + 5 * 60 * 1e3
    });
  }
  async getCachedData(key) {
    const cachedData = this.cache.get(key);
    if (cachedData) {
      return cachedData;
    }
    const fileCachedData = await this.readFromCache(key);
    if (fileCachedData) {
      this.cache.set(key, fileCachedData);
      return fileCachedData;
    }
    return null;
  }
  async setCachedData(cacheKey, data) {
    this.cache.set(cacheKey, data);
    await this.writeToCache(cacheKey, data);
  }
  async fetchWithRetry(url, options = {}) {
    let lastError;
    for (let i = 0; i < PROVIDER_CONFIG2.MAX_RETRIES; i++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            Accept: "application/json",
            "x-chain": "solana",
            "X-API-KEY": settings.BIRDEYE_API_KEY || "",
            ...options.headers
          }
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `HTTP error! status: ${response.status}, message: ${errorText}`
          );
        }
        const data = await response.json();
        return data;
      } catch (error) {
        console.error(`Attempt ${i + 1} failed:`, error);
        lastError = error;
        if (i < PROVIDER_CONFIG2.MAX_RETRIES - 1) {
          const delay = PROVIDER_CONFIG2.RETRY_DELAY * Math.pow(2, i);
          console.log(`Waiting ${delay}ms before retrying...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
    }
    console.error(
      "All attempts failed. Throwing the last error:",
      lastError
    );
    throw lastError;
  }
  async getTokensInWallet(runtime) {
    const walletInfo = await this.walletProvider.fetchPortfolioValue(runtime);
    const items = walletInfo.items;
    return items;
  }
  // check if the token symbol is in the wallet
  async getTokenFromWallet(runtime, tokenSymbol) {
    try {
      const items = await this.getTokensInWallet(runtime);
      const token = items.find((item) => item.symbol === tokenSymbol);
      if (token) {
        return token.address;
      } else {
        return null;
      }
    } catch (error) {
      console.error("Error checking token in wallet:", error);
      return null;
    }
  }
  async fetchPrices() {
    try {
      const cacheKey = "prices";
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        console.log("Returning cached prices.");
        return cachedData;
      }
      const { SOL, BTC, ETH } = PROVIDER_CONFIG2.TOKEN_ADDRESSES;
      const tokens = [SOL, BTC, ETH];
      const prices = {
        solana: { usd: "0" },
        bitcoin: { usd: "0" },
        ethereum: { usd: "0" }
      };
      for (const token of tokens) {
        const response = await this.fetchWithRetry(
          `${PROVIDER_CONFIG2.BIRDEYE_API}/defi/price?address=${token}`,
          {
            headers: {
              "x-chain": "solana"
            }
          }
        );
        if (response?.data?.value) {
          const price = response.data.value.toString();
          prices[token === SOL ? "solana" : token === BTC ? "bitcoin" : "ethereum"].usd = price;
        } else {
          console.warn(`No price data available for token: ${token}`);
        }
      }
      this.setCachedData(cacheKey, prices);
      return prices;
    } catch (error) {
      console.error("Error fetching prices:", error);
      throw error;
    }
  }
  async calculateBuyAmounts() {
    const dexScreenerData = await this.fetchDexScreenerData();
    const prices = await this.fetchPrices();
    const solPrice = toBN(prices.solana.usd);
    if (!dexScreenerData || dexScreenerData.pairs.length === 0) {
      return { none: 0, low: 0, medium: 0, high: 0 };
    }
    const pair = dexScreenerData.pairs[0];
    const { liquidity, marketCap } = pair;
    if (!liquidity || !marketCap) {
      return { none: 0, low: 0, medium: 0, high: 0 };
    }
    if (liquidity.usd === 0) {
      return { none: 0, low: 0, medium: 0, high: 0 };
    }
    if (marketCap < 1e5) {
      return { none: 0, low: 0, medium: 0, high: 0 };
    }
    const impactPercentages = {
      LOW: 0.01,
      // 1% of liquidity
      MEDIUM: 0.05,
      // 5% of liquidity
      HIGH: 0.1
      // 10% of liquidity
    };
    const lowBuyAmountUSD = liquidity.usd * impactPercentages.LOW;
    const mediumBuyAmountUSD = liquidity.usd * impactPercentages.MEDIUM;
    const highBuyAmountUSD = liquidity.usd * impactPercentages.HIGH;
    const lowBuyAmountSOL = toBN(lowBuyAmountUSD).div(solPrice).toNumber();
    const mediumBuyAmountSOL = toBN(mediumBuyAmountUSD).div(solPrice).toNumber();
    const highBuyAmountSOL = toBN(highBuyAmountUSD).div(solPrice).toNumber();
    return {
      none: 0,
      low: lowBuyAmountSOL,
      medium: mediumBuyAmountSOL,
      high: highBuyAmountSOL
    };
  }
  async fetchTokenSecurity() {
    const cacheKey = `tokenSecurity_${this.tokenAddress}`;
    const cachedData = this.getCachedData(cacheKey);
    if (cachedData) {
      console.log(
        `Returning cached token security data for ${this.tokenAddress}.`
      );
      return cachedData;
    }
    const url = `${PROVIDER_CONFIG2.BIRDEYE_API}${PROVIDER_CONFIG2.TOKEN_SECURITY_ENDPOINT}${this.tokenAddress}`;
    const data = await this.fetchWithRetry(url);
    if (!data?.success || !data?.data) {
      throw new Error("No token security data available");
    }
    const security = {
      ownerBalance: data.data.ownerBalance,
      creatorBalance: data.data.creatorBalance,
      ownerPercentage: data.data.ownerPercentage,
      creatorPercentage: data.data.creatorPercentage,
      top10HolderBalance: data.data.top10HolderBalance,
      top10HolderPercent: data.data.top10HolderPercent
    };
    this.setCachedData(cacheKey, security);
    console.log(`Token security data cached for ${this.tokenAddress}.`);
    return security;
  }
  async fetchTokenTradeData() {
    const cacheKey = `tokenTradeData_${this.tokenAddress}`;
    const cachedData = this.getCachedData(cacheKey);
    if (cachedData) {
      console.log(
        `Returning cached token trade data for ${this.tokenAddress}.`
      );
      return cachedData;
    }
    const url = `${PROVIDER_CONFIG2.BIRDEYE_API}${PROVIDER_CONFIG2.TOKEN_TRADE_DATA_ENDPOINT}${this.tokenAddress}`;
    const options = {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-API-KEY": settings.BIRDEYE_API_KEY || ""
      }
    };
    const data = await fetch(url, options).then((res) => res.json()).catch((err) => console.error(err));
    if (!data?.success || !data?.data) {
      throw new Error("No token trade data available");
    }
    const tradeData = {
      address: data.data.address,
      holder: data.data.holder,
      market: data.data.market,
      last_trade_unix_time: data.data.last_trade_unix_time,
      last_trade_human_time: data.data.last_trade_human_time,
      price: data.data.price,
      history_30m_price: data.data.history_30m_price,
      price_change_30m_percent: data.data.price_change_30m_percent,
      history_1h_price: data.data.history_1h_price,
      price_change_1h_percent: data.data.price_change_1h_percent,
      history_2h_price: data.data.history_2h_price,
      price_change_2h_percent: data.data.price_change_2h_percent,
      history_4h_price: data.data.history_4h_price,
      price_change_4h_percent: data.data.price_change_4h_percent,
      history_6h_price: data.data.history_6h_price,
      price_change_6h_percent: data.data.price_change_6h_percent,
      history_8h_price: data.data.history_8h_price,
      price_change_8h_percent: data.data.price_change_8h_percent,
      history_12h_price: data.data.history_12h_price,
      price_change_12h_percent: data.data.price_change_12h_percent,
      history_24h_price: data.data.history_24h_price,
      price_change_24h_percent: data.data.price_change_24h_percent,
      unique_wallet_30m: data.data.unique_wallet_30m,
      unique_wallet_history_30m: data.data.unique_wallet_history_30m,
      unique_wallet_30m_change_percent: data.data.unique_wallet_30m_change_percent,
      unique_wallet_1h: data.data.unique_wallet_1h,
      unique_wallet_history_1h: data.data.unique_wallet_history_1h,
      unique_wallet_1h_change_percent: data.data.unique_wallet_1h_change_percent,
      unique_wallet_2h: data.data.unique_wallet_2h,
      unique_wallet_history_2h: data.data.unique_wallet_history_2h,
      unique_wallet_2h_change_percent: data.data.unique_wallet_2h_change_percent,
      unique_wallet_4h: data.data.unique_wallet_4h,
      unique_wallet_history_4h: data.data.unique_wallet_history_4h,
      unique_wallet_4h_change_percent: data.data.unique_wallet_4h_change_percent,
      unique_wallet_8h: data.data.unique_wallet_8h,
      unique_wallet_history_8h: data.data.unique_wallet_history_8h,
      unique_wallet_8h_change_percent: data.data.unique_wallet_8h_change_percent,
      unique_wallet_24h: data.data.unique_wallet_24h,
      unique_wallet_history_24h: data.data.unique_wallet_history_24h,
      unique_wallet_24h_change_percent: data.data.unique_wallet_24h_change_percent,
      trade_30m: data.data.trade_30m,
      trade_history_30m: data.data.trade_history_30m,
      trade_30m_change_percent: data.data.trade_30m_change_percent,
      sell_30m: data.data.sell_30m,
      sell_history_30m: data.data.sell_history_30m,
      sell_30m_change_percent: data.data.sell_30m_change_percent,
      buy_30m: data.data.buy_30m,
      buy_history_30m: data.data.buy_history_30m,
      buy_30m_change_percent: data.data.buy_30m_change_percent,
      volume_30m: data.data.volume_30m,
      volume_30m_usd: data.data.volume_30m_usd,
      volume_history_30m: data.data.volume_history_30m,
      volume_history_30m_usd: data.data.volume_history_30m_usd,
      volume_30m_change_percent: data.data.volume_30m_change_percent,
      volume_buy_30m: data.data.volume_buy_30m,
      volume_buy_30m_usd: data.data.volume_buy_30m_usd,
      volume_buy_history_30m: data.data.volume_buy_history_30m,
      volume_buy_history_30m_usd: data.data.volume_buy_history_30m_usd,
      volume_buy_30m_change_percent: data.data.volume_buy_30m_change_percent,
      volume_sell_30m: data.data.volume_sell_30m,
      volume_sell_30m_usd: data.data.volume_sell_30m_usd,
      volume_sell_history_30m: data.data.volume_sell_history_30m,
      volume_sell_history_30m_usd: data.data.volume_sell_history_30m_usd,
      volume_sell_30m_change_percent: data.data.volume_sell_30m_change_percent,
      trade_1h: data.data.trade_1h,
      trade_history_1h: data.data.trade_history_1h,
      trade_1h_change_percent: data.data.trade_1h_change_percent,
      sell_1h: data.data.sell_1h,
      sell_history_1h: data.data.sell_history_1h,
      sell_1h_change_percent: data.data.sell_1h_change_percent,
      buy_1h: data.data.buy_1h,
      buy_history_1h: data.data.buy_history_1h,
      buy_1h_change_percent: data.data.buy_1h_change_percent,
      volume_1h: data.data.volume_1h,
      volume_1h_usd: data.data.volume_1h_usd,
      volume_history_1h: data.data.volume_history_1h,
      volume_history_1h_usd: data.data.volume_history_1h_usd,
      volume_1h_change_percent: data.data.volume_1h_change_percent,
      volume_buy_1h: data.data.volume_buy_1h,
      volume_buy_1h_usd: data.data.volume_buy_1h_usd,
      volume_buy_history_1h: data.data.volume_buy_history_1h,
      volume_buy_history_1h_usd: data.data.volume_buy_history_1h_usd,
      volume_buy_1h_change_percent: data.data.volume_buy_1h_change_percent,
      volume_sell_1h: data.data.volume_sell_1h,
      volume_sell_1h_usd: data.data.volume_sell_1h_usd,
      volume_sell_history_1h: data.data.volume_sell_history_1h,
      volume_sell_history_1h_usd: data.data.volume_sell_history_1h_usd,
      volume_sell_1h_change_percent: data.data.volume_sell_1h_change_percent,
      trade_2h: data.data.trade_2h,
      trade_history_2h: data.data.trade_history_2h,
      trade_2h_change_percent: data.data.trade_2h_change_percent,
      sell_2h: data.data.sell_2h,
      sell_history_2h: data.data.sell_history_2h,
      sell_2h_change_percent: data.data.sell_2h_change_percent,
      buy_2h: data.data.buy_2h,
      buy_history_2h: data.data.buy_history_2h,
      buy_2h_change_percent: data.data.buy_2h_change_percent,
      volume_2h: data.data.volume_2h,
      volume_2h_usd: data.data.volume_2h_usd,
      volume_history_2h: data.data.volume_history_2h,
      volume_history_2h_usd: data.data.volume_history_2h_usd,
      volume_2h_change_percent: data.data.volume_2h_change_percent,
      volume_buy_2h: data.data.volume_buy_2h,
      volume_buy_2h_usd: data.data.volume_buy_2h_usd,
      volume_buy_history_2h: data.data.volume_buy_history_2h,
      volume_buy_history_2h_usd: data.data.volume_buy_history_2h_usd,
      volume_buy_2h_change_percent: data.data.volume_buy_2h_change_percent,
      volume_sell_2h: data.data.volume_sell_2h,
      volume_sell_2h_usd: data.data.volume_sell_2h_usd,
      volume_sell_history_2h: data.data.volume_sell_history_2h,
      volume_sell_history_2h_usd: data.data.volume_sell_history_2h_usd,
      volume_sell_2h_change_percent: data.data.volume_sell_2h_change_percent,
      trade_4h: data.data.trade_4h,
      trade_history_4h: data.data.trade_history_4h,
      trade_4h_change_percent: data.data.trade_4h_change_percent,
      sell_4h: data.data.sell_4h,
      sell_history_4h: data.data.sell_history_4h,
      sell_4h_change_percent: data.data.sell_4h_change_percent,
      buy_4h: data.data.buy_4h,
      buy_history_4h: data.data.buy_history_4h,
      buy_4h_change_percent: data.data.buy_4h_change_percent,
      volume_4h: data.data.volume_4h,
      volume_4h_usd: data.data.volume_4h_usd,
      volume_history_4h: data.data.volume_history_4h,
      volume_history_4h_usd: data.data.volume_history_4h_usd,
      volume_4h_change_percent: data.data.volume_4h_change_percent,
      volume_buy_4h: data.data.volume_buy_4h,
      volume_buy_4h_usd: data.data.volume_buy_4h_usd,
      volume_buy_history_4h: data.data.volume_buy_history_4h,
      volume_buy_history_4h_usd: data.data.volume_buy_history_4h_usd,
      volume_buy_4h_change_percent: data.data.volume_buy_4h_change_percent,
      volume_sell_4h: data.data.volume_sell_4h,
      volume_sell_4h_usd: data.data.volume_sell_4h_usd,
      volume_sell_history_4h: data.data.volume_sell_history_4h,
      volume_sell_history_4h_usd: data.data.volume_sell_history_4h_usd,
      volume_sell_4h_change_percent: data.data.volume_sell_4h_change_percent,
      trade_8h: data.data.trade_8h,
      trade_history_8h: data.data.trade_history_8h,
      trade_8h_change_percent: data.data.trade_8h_change_percent,
      sell_8h: data.data.sell_8h,
      sell_history_8h: data.data.sell_history_8h,
      sell_8h_change_percent: data.data.sell_8h_change_percent,
      buy_8h: data.data.buy_8h,
      buy_history_8h: data.data.buy_history_8h,
      buy_8h_change_percent: data.data.buy_8h_change_percent,
      volume_8h: data.data.volume_8h,
      volume_8h_usd: data.data.volume_8h_usd,
      volume_history_8h: data.data.volume_history_8h,
      volume_history_8h_usd: data.data.volume_history_8h_usd,
      volume_8h_change_percent: data.data.volume_8h_change_percent,
      volume_buy_8h: data.data.volume_buy_8h,
      volume_buy_8h_usd: data.data.volume_buy_8h_usd,
      volume_buy_history_8h: data.data.volume_buy_history_8h,
      volume_buy_history_8h_usd: data.data.volume_buy_history_8h_usd,
      volume_buy_8h_change_percent: data.data.volume_buy_8h_change_percent,
      volume_sell_8h: data.data.volume_sell_8h,
      volume_sell_8h_usd: data.data.volume_sell_8h_usd,
      volume_sell_history_8h: data.data.volume_sell_history_8h,
      volume_sell_history_8h_usd: data.data.volume_sell_history_8h_usd,
      volume_sell_8h_change_percent: data.data.volume_sell_8h_change_percent,
      trade_24h: data.data.trade_24h,
      trade_history_24h: data.data.trade_history_24h,
      trade_24h_change_percent: data.data.trade_24h_change_percent,
      sell_24h: data.data.sell_24h,
      sell_history_24h: data.data.sell_history_24h,
      sell_24h_change_percent: data.data.sell_24h_change_percent,
      buy_24h: data.data.buy_24h,
      buy_history_24h: data.data.buy_history_24h,
      buy_24h_change_percent: data.data.buy_24h_change_percent,
      volume_24h: data.data.volume_24h,
      volume_24h_usd: data.data.volume_24h_usd,
      volume_history_24h: data.data.volume_history_24h,
      volume_history_24h_usd: data.data.volume_history_24h_usd,
      volume_24h_change_percent: data.data.volume_24h_change_percent,
      volume_buy_24h: data.data.volume_buy_24h,
      volume_buy_24h_usd: data.data.volume_buy_24h_usd,
      volume_buy_history_24h: data.data.volume_buy_history_24h,
      volume_buy_history_24h_usd: data.data.volume_buy_history_24h_usd,
      volume_buy_24h_change_percent: data.data.volume_buy_24h_change_percent,
      volume_sell_24h: data.data.volume_sell_24h,
      volume_sell_24h_usd: data.data.volume_sell_24h_usd,
      volume_sell_history_24h: data.data.volume_sell_history_24h,
      volume_sell_history_24h_usd: data.data.volume_sell_history_24h_usd,
      volume_sell_24h_change_percent: data.data.volume_sell_24h_change_percent
    };
    this.setCachedData(cacheKey, tradeData);
    return tradeData;
  }
  async fetchDexScreenerData() {
    const cacheKey = `dexScreenerData_${this.tokenAddress}`;
    const cachedData = this.getCachedData(cacheKey);
    if (cachedData) {
      console.log("Returning cached DexScreener data.");
      return cachedData;
    }
    const url = `https://api.dexscreener.com/latest/dex/search?q=${this.tokenAddress}`;
    try {
      console.log(
        `Fetching DexScreener data for token: ${this.tokenAddress}`
      );
      const data = await fetch(url).then((res) => res.json()).catch((err) => {
        console.error(err);
      });
      if (!data || !data.pairs) {
        throw new Error("No DexScreener data available");
      }
      const dexData = {
        schemaVersion: data.schemaVersion,
        pairs: data.pairs
      };
      this.setCachedData(cacheKey, dexData);
      return dexData;
    } catch (error) {
      console.error(`Error fetching DexScreener data:`, error);
      return {
        schemaVersion: "1.0.0",
        pairs: []
      };
    }
  }
  async searchDexScreenerData(symbol) {
    const cacheKey = `dexScreenerData_search_${symbol}`;
    const cachedData = await this.getCachedData(cacheKey);
    if (cachedData) {
      console.log("Returning cached search DexScreener data.");
      return this.getHighestLiquidityPair(cachedData);
    }
    const url = `https://api.dexscreener.com/latest/dex/search?q=${symbol}`;
    try {
      console.log(`Fetching DexScreener data for symbol: ${symbol}`);
      const data = await fetch(url).then((res) => res.json()).catch((err) => {
        console.error(err);
        return null;
      });
      if (!data || !data.pairs || data.pairs.length === 0) {
        throw new Error("No DexScreener data available");
      }
      const dexData = {
        schemaVersion: data.schemaVersion,
        pairs: data.pairs
      };
      this.setCachedData(cacheKey, dexData);
      return this.getHighestLiquidityPair(dexData);
    } catch (error) {
      console.error(`Error fetching DexScreener data:`, error);
      return null;
    }
  }
  getHighestLiquidityPair(dexData) {
    if (dexData.pairs.length === 0) {
      return null;
    }
    return dexData.pairs.reduce((highestPair, currentPair) => {
      const currentLiquidity = currentPair.liquidity.usd;
      const currentMarketCap = currentPair.marketCap;
      const highestLiquidity = highestPair.liquidity.usd;
      const highestMarketCap = highestPair.marketCap;
      if (currentLiquidity > highestLiquidity || currentLiquidity === highestLiquidity && currentMarketCap > highestMarketCap) {
        return currentPair;
      }
      return highestPair;
    });
  }
  async analyzeHolderDistribution(tradeData) {
    const intervals = [
      {
        period: "30m",
        change: tradeData.unique_wallet_30m_change_percent
      },
      { period: "1h", change: tradeData.unique_wallet_1h_change_percent },
      { period: "2h", change: tradeData.unique_wallet_2h_change_percent },
      { period: "4h", change: tradeData.unique_wallet_4h_change_percent },
      { period: "8h", change: tradeData.unique_wallet_8h_change_percent },
      {
        period: "24h",
        change: tradeData.unique_wallet_24h_change_percent
      }
    ];
    const validChanges = intervals.map((interval) => interval.change).filter(
      (change) => change !== null && change !== void 0
    );
    if (validChanges.length === 0) {
      return "stable";
    }
    const averageChange = validChanges.reduce((acc, curr) => acc + curr, 0) / validChanges.length;
    const increaseThreshold = 10;
    const decreaseThreshold = -10;
    if (averageChange > increaseThreshold) {
      return "increasing";
    } else if (averageChange < decreaseThreshold) {
      return "decreasing";
    } else {
      return "stable";
    }
  }
  async fetchHolderList() {
    const cacheKey = `holderList_${this.tokenAddress}`;
    const cachedData = this.getCachedData(cacheKey);
    if (cachedData) {
      console.log("Returning cached holder list.");
      return cachedData;
    }
    const allHoldersMap = /* @__PURE__ */ new Map();
    let page = 1;
    const limit = 1e3;
    let cursor;
    const url = `https://mainnet.helius-rpc.com/?api-key=${settings.HELIUS_API_KEY || ""}`;
    console.log({ url });
    try {
      while (true) {
        const params = {
          limit,
          displayOptions: {},
          mint: this.tokenAddress,
          cursor
        };
        if (cursor != void 0) {
          params.cursor = cursor;
        }
        console.log(`Fetching holders - Page ${page}`);
        if (page > 2) {
          break;
        }
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "helius-test",
            method: "getTokenAccounts",
            params
          })
        });
        const data = await response.json();
        if (!data || !data.result || !data.result.token_accounts || data.result.token_accounts.length === 0) {
          console.log(
            `No more holders found. Total pages fetched: ${page - 1}`
          );
          break;
        }
        console.log(
          `Processing ${data.result.token_accounts.length} holders from page ${page}`
        );
        data.result.token_accounts.forEach((account) => {
          const owner = account.owner;
          const balance = parseFloat(account.amount);
          if (allHoldersMap.has(owner)) {
            allHoldersMap.set(
              owner,
              allHoldersMap.get(owner) + balance
            );
          } else {
            allHoldersMap.set(owner, balance);
          }
        });
        cursor = data.result.cursor;
        page++;
      }
      const holders = Array.from(
        allHoldersMap.entries()
      ).map(([address, balance]) => ({
        address,
        balance: balance.toString()
      }));
      console.log(`Total unique holders fetched: ${holders.length}`);
      this.setCachedData(cacheKey, holders);
      return holders;
    } catch (error) {
      console.error("Error fetching holder list from Helius:", error);
      throw new Error("Failed to fetch holder list from Helius.");
    }
  }
  async filterHighValueHolders(tradeData) {
    const holdersData = await this.fetchHolderList();
    const tokenPriceUsd = toBN(tradeData.price);
    const highValueHolders = holdersData.filter((holder) => {
      const balanceUsd = toBN(holder.balance).multipliedBy(
        tokenPriceUsd
      );
      return balanceUsd.isGreaterThan(5);
    }).map((holder) => ({
      holderAddress: holder.address,
      balanceUsd: toBN(holder.balance).multipliedBy(tokenPriceUsd).toFixed(2)
    }));
    return highValueHolders;
  }
  async checkRecentTrades(tradeData) {
    return toBN(tradeData.volume_24h_usd).isGreaterThan(0);
  }
  async countHighSupplyHolders(securityData) {
    try {
      const ownerBalance = toBN(securityData.ownerBalance);
      const totalSupply = ownerBalance.plus(securityData.creatorBalance);
      const highSupplyHolders = await this.fetchHolderList();
      const highSupplyHoldersCount = highSupplyHolders.filter(
        (holder) => {
          const balance = toBN(holder.balance);
          return balance.dividedBy(totalSupply).isGreaterThan(0.02);
        }
      ).length;
      return highSupplyHoldersCount;
    } catch (error) {
      console.error("Error counting high supply holders:", error);
      return 0;
    }
  }
  async getProcessedTokenData() {
    try {
      console.log(
        `Fetching security data for token: ${this.tokenAddress}`
      );
      const security = await this.fetchTokenSecurity();
      console.log(`Fetching trade data for token: ${this.tokenAddress}`);
      const tradeData = await this.fetchTokenTradeData();
      console.log(
        `Fetching DexScreener data for token: ${this.tokenAddress}`
      );
      const dexData = await this.fetchDexScreenerData();
      console.log(
        `Analyzing holder distribution for token: ${this.tokenAddress}`
      );
      const holderDistributionTrend = await this.analyzeHolderDistribution(tradeData);
      console.log(
        `Filtering high-value holders for token: ${this.tokenAddress}`
      );
      const highValueHolders = await this.filterHighValueHolders(tradeData);
      console.log(
        `Checking recent trades for token: ${this.tokenAddress}`
      );
      const recentTrades = await this.checkRecentTrades(tradeData);
      console.log(
        `Counting high-supply holders for token: ${this.tokenAddress}`
      );
      const highSupplyHoldersCount = await this.countHighSupplyHolders(security);
      console.log(
        `Determining DexScreener listing status for token: ${this.tokenAddress}`
      );
      const isDexScreenerListed = dexData.pairs.length > 0;
      const isDexScreenerPaid = dexData.pairs.some(
        (pair) => pair.boosts && pair.boosts.active > 0
      );
      const processedData = {
        security,
        tradeData,
        holderDistributionTrend,
        highValueHolders,
        recentTrades,
        highSupplyHoldersCount,
        dexScreenerData: dexData,
        isDexScreenerListed,
        isDexScreenerPaid
      };
      return processedData;
    } catch (error) {
      console.error("Error processing token data:", error);
      throw error;
    }
  }
  async shouldTradeToken() {
    try {
      const tokenData = await this.getProcessedTokenData();
      const { tradeData, security, dexScreenerData } = tokenData;
      const { ownerBalance, creatorBalance } = security;
      const { liquidity, marketCap } = dexScreenerData.pairs[0];
      const liquidityUsd = toBN(liquidity.usd);
      const marketCapUsd = toBN(marketCap);
      const totalSupply = toBN(ownerBalance).plus(creatorBalance);
      const ownerPercentage = toBN(ownerBalance).dividedBy(totalSupply);
      const creatorPercentage = toBN(creatorBalance).dividedBy(totalSupply);
      const top10HolderPercent = toBN(tradeData.volume_24h_usd).dividedBy(
        totalSupply
      );
      const priceChange24hPercent = toBN(
        tradeData.price_change_24h_percent
      );
      const priceChange12hPercent = toBN(
        tradeData.price_change_12h_percent
      );
      const uniqueWallet24h = tradeData.unique_wallet_24h;
      const volume24hUsd = toBN(tradeData.volume_24h_usd);
      const volume24hUsdThreshold = 1e3;
      const priceChange24hPercentThreshold = 10;
      const priceChange12hPercentThreshold = 5;
      const top10HolderPercentThreshold = 0.05;
      const uniqueWallet24hThreshold = 100;
      const isTop10Holder = top10HolderPercent.gte(
        top10HolderPercentThreshold
      );
      const isVolume24h = volume24hUsd.gte(volume24hUsdThreshold);
      const isPriceChange24h = priceChange24hPercent.gte(
        priceChange24hPercentThreshold
      );
      const isPriceChange12h = priceChange12hPercent.gte(
        priceChange12hPercentThreshold
      );
      const isUniqueWallet24h = uniqueWallet24h >= uniqueWallet24hThreshold;
      const isLiquidityTooLow = liquidityUsd.lt(1e3);
      const isMarketCapTooLow = marketCapUsd.lt(1e5);
      return isTop10Holder || isVolume24h || isPriceChange24h || isPriceChange12h || isUniqueWallet24h || isLiquidityTooLow || isMarketCapTooLow;
    } catch (error) {
      console.error("Error processing token data:", error);
      throw error;
    }
  }
  formatTokenData(data) {
    let output = `**Token Security and Trade Report**
`;
    output += `Token Address: ${this.tokenAddress}

`;
    output += `**Ownership Distribution:**
`;
    output += `- Owner Balance: ${data.security.ownerBalance}
`;
    output += `- Creator Balance: ${data.security.creatorBalance}
`;
    output += `- Owner Percentage: ${data.security.ownerPercentage}%
`;
    output += `- Creator Percentage: ${data.security.creatorPercentage}%
`;
    output += `- Top 10 Holders Balance: ${data.security.top10HolderBalance}
`;
    output += `- Top 10 Holders Percentage: ${data.security.top10HolderPercent}%

`;
    output += `**Trade Data:**
`;
    output += `- Holders: ${data.tradeData.holder}
`;
    output += `- Unique Wallets (24h): ${data.tradeData.unique_wallet_24h}
`;
    output += `- Price Change (24h): ${data.tradeData.price_change_24h_percent}%
`;
    output += `- Price Change (12h): ${data.tradeData.price_change_12h_percent}%
`;
    output += `- Volume (24h USD): $${toBN(data.tradeData.volume_24h_usd).toFixed(2)}
`;
    output += `- Current Price: $${toBN(data.tradeData.price).toFixed(2)}

`;
    output += `**Holder Distribution Trend:** ${data.holderDistributionTrend}

`;
    output += `**High-Value Holders (>$5 USD):**
`;
    if (data.highValueHolders.length === 0) {
      output += `- No high-value holders found or data not available.
`;
    } else {
      data.highValueHolders.forEach((holder) => {
        output += `- ${holder.holderAddress}: $${holder.balanceUsd}
`;
      });
    }
    output += `
`;
    output += `**Recent Trades (Last 24h):** ${data.recentTrades ? "Yes" : "No"}

`;
    output += `**Holders with >2% Supply:** ${data.highSupplyHoldersCount}

`;
    output += `**DexScreener Listing:** ${data.isDexScreenerListed ? "Yes" : "No"}
`;
    if (data.isDexScreenerListed) {
      output += `- Listing Type: ${data.isDexScreenerPaid ? "Paid" : "Free"}
`;
      output += `- Number of DexPairs: ${data.dexScreenerData.pairs.length}

`;
      output += `**DexScreener Pairs:**
`;
      data.dexScreenerData.pairs.forEach((pair, index) => {
        output += `
**Pair ${index + 1}:**
`;
        output += `- DEX: ${pair.dexId}
`;
        output += `- URL: ${pair.url}
`;
        output += `- Price USD: $${toBN(pair.priceUsd).toFixed(6)}
`;
        output += `- Volume (24h USD): $${toBN(pair.volume.h24).toFixed(2)}
`;
        output += `- Boosts Active: ${pair.boosts && pair.boosts.active}
`;
        output += `- Liquidity USD: $${toBN(pair.liquidity.usd).toFixed(2)}
`;
      });
    }
    output += `
`;
    console.log("Formatted token data:", output);
    return output;
  }
  async getFormattedTokenReport() {
    try {
      console.log("Generating formatted token report...");
      const processedData = await this.getProcessedTokenData();
      return this.formatTokenData(processedData);
    } catch (error) {
      console.error("Error generating token report:", error);
      return "Unable to fetch token information. Please try again later.";
    }
  }
};
var tokenAddress = PROVIDER_CONFIG2.TOKEN_ADDRESSES.Example;
var connection = new Connection2(PROVIDER_CONFIG2.DEFAULT_RPC);
var tokenProvider = {
  get: async (runtime, _message, _state) => {
    try {
      const walletProvider2 = new WalletProvider(
        connection,
        new PublicKey2(PROVIDER_CONFIG2.MAIN_WALLET)
      );
      const provider = new TokenProvider(
        tokenAddress,
        walletProvider2,
        runtime.cacheManager
      );
      return provider.getFormattedTokenReport();
    } catch (error) {
      console.error("Error fetching token data:", error);
      return "Unable to fetch token information. Please try again later.";
    }
  }
};

// src/providers/trustScoreProvider.ts
import { Connection as Connection3, PublicKey as PublicKey3 } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  TrustScoreDatabase
} from "@ai16z/plugin-trustdb";
import { settings as settings2 } from "@ai16z/eliza";
var Wallet = settings2.MAIN_WALLET_ADDRESS;
var TrustScoreManager = class {
  tokenProvider;
  trustScoreDb;
  connection;
  baseMint;
  DECAY_RATE = 0.95;
  MAX_DECAY_DAYS = 30;
  backend;
  backendToken;
  constructor(runtime, tokenProvider2, trustScoreDb) {
    this.tokenProvider = tokenProvider2;
    this.trustScoreDb = trustScoreDb;
    this.connection = new Connection3(runtime.getSetting("RPC_URL"));
    this.baseMint = new PublicKey3(
      runtime.getSetting("BASE_MINT") || "So11111111111111111111111111111111111111112"
    );
    this.backend = runtime.getSetting("BACKEND_URL");
    this.backendToken = runtime.getSetting("BACKEND_TOKEN");
  }
  //getRecommenederBalance
  async getRecommenederBalance(recommenderWallet) {
    try {
      const tokenAta = await getAssociatedTokenAddress(
        new PublicKey3(recommenderWallet),
        this.baseMint
      );
      const tokenBalInfo = await this.connection.getTokenAccountBalance(tokenAta);
      const tokenBalance = tokenBalInfo.value.amount;
      const balance = parseFloat(tokenBalance);
      return balance;
    } catch (error) {
      console.error("Error fetching balance", error);
      return 0;
    }
  }
  /**
   * Generates and saves trust score based on processed token data and user recommendations.
   * @param tokenAddress The address of the token to analyze.
   * @param recommenderId The UUID of the recommender.
   * @returns An object containing TokenPerformance and RecommenderMetrics.
   */
  async generateTrustScore(tokenAddress2, recommenderId, recommenderWallet) {
    const processedData = await this.tokenProvider.getProcessedTokenData();
    console.log(`Fetched processed token data for token: ${tokenAddress2}`);
    const recommenderMetrics = await this.trustScoreDb.getRecommenderMetrics(recommenderId);
    const isRapidDump = await this.isRapidDump(tokenAddress2);
    const sustainedGrowth = await this.sustainedGrowth(tokenAddress2);
    const suspiciousVolume = await this.suspiciousVolume(tokenAddress2);
    const balance = await this.getRecommenederBalance(recommenderWallet);
    const virtualConfidence = balance / 1e6;
    const lastActive = recommenderMetrics.lastActiveDate;
    const now = /* @__PURE__ */ new Date();
    const inactiveDays = Math.floor(
      (now.getTime() - lastActive.getTime()) / (1e3 * 60 * 60 * 24)
    );
    const decayFactor = Math.pow(
      this.DECAY_RATE,
      Math.min(inactiveDays, this.MAX_DECAY_DAYS)
    );
    const decayedScore = recommenderMetrics.trustScore * decayFactor;
    const validationTrustScore = this.trustScoreDb.calculateValidationTrust(tokenAddress2);
    return {
      tokenPerformance: {
        tokenAddress: processedData.dexScreenerData.pairs[0]?.baseToken.address || "",
        priceChange24h: processedData.tradeData.price_change_24h_percent,
        volumeChange24h: processedData.tradeData.volume_24h,
        trade_24h_change: processedData.tradeData.trade_24h_change_percent,
        liquidity: processedData.dexScreenerData.pairs[0]?.liquidity.usd || 0,
        liquidityChange24h: 0,
        holderChange24h: processedData.tradeData.unique_wallet_24h_change_percent,
        rugPull: false,
        // TODO: Implement rug pull detection
        isScam: false,
        // TODO: Implement scam detection
        marketCapChange24h: 0,
        // TODO: Implement market cap change
        sustainedGrowth,
        rapidDump: isRapidDump,
        suspiciousVolume,
        validationTrust: validationTrustScore,
        lastUpdated: /* @__PURE__ */ new Date()
      },
      recommenderMetrics: {
        recommenderId,
        trustScore: recommenderMetrics.trustScore,
        totalRecommendations: recommenderMetrics.totalRecommendations,
        successfulRecs: recommenderMetrics.successfulRecs,
        avgTokenPerformance: recommenderMetrics.avgTokenPerformance,
        riskScore: recommenderMetrics.riskScore,
        consistencyScore: recommenderMetrics.consistencyScore,
        virtualConfidence,
        lastActiveDate: now,
        trustDecay: decayedScore,
        lastUpdated: /* @__PURE__ */ new Date()
      }
    };
  }
  async updateRecommenderMetrics(recommenderId, tokenPerformance, recommenderWallet) {
    const recommenderMetrics = await this.trustScoreDb.getRecommenderMetrics(recommenderId);
    const totalRecommendations = recommenderMetrics.totalRecommendations + 1;
    const successfulRecs = tokenPerformance.rugPull ? recommenderMetrics.successfulRecs : recommenderMetrics.successfulRecs + 1;
    const avgTokenPerformance = (recommenderMetrics.avgTokenPerformance * recommenderMetrics.totalRecommendations + tokenPerformance.priceChange24h) / totalRecommendations;
    const overallTrustScore = this.calculateTrustScore(
      tokenPerformance,
      recommenderMetrics
    );
    const riskScore = this.calculateOverallRiskScore(
      tokenPerformance,
      recommenderMetrics
    );
    const consistencyScore = this.calculateConsistencyScore(
      tokenPerformance,
      recommenderMetrics
    );
    const balance = await this.getRecommenederBalance(recommenderWallet);
    const virtualConfidence = balance / 1e6;
    const lastActive = recommenderMetrics.lastActiveDate;
    const now = /* @__PURE__ */ new Date();
    const inactiveDays = Math.floor(
      (now.getTime() - lastActive.getTime()) / (1e3 * 60 * 60 * 24)
    );
    const decayFactor = Math.pow(
      this.DECAY_RATE,
      Math.min(inactiveDays, this.MAX_DECAY_DAYS)
    );
    const decayedScore = recommenderMetrics.trustScore * decayFactor;
    const newRecommenderMetrics = {
      recommenderId,
      trustScore: overallTrustScore,
      totalRecommendations,
      successfulRecs,
      avgTokenPerformance,
      riskScore,
      consistencyScore,
      virtualConfidence,
      lastActiveDate: /* @__PURE__ */ new Date(),
      trustDecay: decayedScore,
      lastUpdated: /* @__PURE__ */ new Date()
    };
    await this.trustScoreDb.updateRecommenderMetrics(newRecommenderMetrics);
  }
  calculateTrustScore(tokenPerformance, recommenderMetrics) {
    const riskScore = this.calculateRiskScore(tokenPerformance);
    const consistencyScore = this.calculateConsistencyScore(
      tokenPerformance,
      recommenderMetrics
    );
    return (riskScore + consistencyScore) / 2;
  }
  calculateOverallRiskScore(tokenPerformance, recommenderMetrics) {
    const riskScore = this.calculateRiskScore(tokenPerformance);
    const consistencyScore = this.calculateConsistencyScore(
      tokenPerformance,
      recommenderMetrics
    );
    return (riskScore + consistencyScore) / 2;
  }
  calculateRiskScore(tokenPerformance) {
    let riskScore = 0;
    if (tokenPerformance.rugPull) {
      riskScore += 10;
    }
    if (tokenPerformance.isScam) {
      riskScore += 10;
    }
    if (tokenPerformance.rapidDump) {
      riskScore += 5;
    }
    if (tokenPerformance.suspiciousVolume) {
      riskScore += 5;
    }
    return riskScore;
  }
  calculateConsistencyScore(tokenPerformance, recommenderMetrics) {
    const avgTokenPerformance = recommenderMetrics.avgTokenPerformance;
    const priceChange24h = tokenPerformance.priceChange24h;
    return Math.abs(priceChange24h - avgTokenPerformance);
  }
  async suspiciousVolume(tokenAddress2) {
    const processedData = await this.tokenProvider.getProcessedTokenData();
    const unique_wallet_24h = processedData.tradeData.unique_wallet_24h;
    const volume_24h = processedData.tradeData.volume_24h;
    const suspiciousVolume = unique_wallet_24h / volume_24h > 0.5;
    console.log(`Fetched processed token data for token: ${tokenAddress2}`);
    return suspiciousVolume;
  }
  async sustainedGrowth(tokenAddress2) {
    const processedData = await this.tokenProvider.getProcessedTokenData();
    console.log(`Fetched processed token data for token: ${tokenAddress2}`);
    return processedData.tradeData.volume_24h_change_percent > 50;
  }
  async isRapidDump(tokenAddress2) {
    const processedData = await this.tokenProvider.getProcessedTokenData();
    console.log(`Fetched processed token data for token: ${tokenAddress2}`);
    return processedData.tradeData.trade_24h_change_percent < -50;
  }
  async checkTrustScore(tokenAddress2) {
    const processedData = await this.tokenProvider.getProcessedTokenData();
    console.log(`Fetched processed token data for token: ${tokenAddress2}`);
    return {
      ownerBalance: processedData.security.ownerBalance,
      creatorBalance: processedData.security.creatorBalance,
      ownerPercentage: processedData.security.ownerPercentage,
      creatorPercentage: processedData.security.creatorPercentage,
      top10HolderBalance: processedData.security.top10HolderBalance,
      top10HolderPercent: processedData.security.top10HolderPercent
    };
  }
  /**
   * Creates a TradePerformance object based on token data and recommender.
   * @param tokenAddress The address of the token.
   * @param recommenderId The UUID of the recommender.
   * @param data ProcessedTokenData.
   * @returns TradePerformance object.
   */
  async createTradePerformance(runtime, tokenAddress2, recommenderId, data) {
    const recommender = await this.trustScoreDb.getOrCreateRecommenderWithTelegramId(
      recommenderId
    );
    const processedData = await this.tokenProvider.getProcessedTokenData();
    const wallet = new WalletProvider(
      this.connection,
      new PublicKey3(Wallet)
    );
    const prices = await wallet.fetchPrices(runtime);
    const solPrice = prices.solana.usd;
    const buySol = data.buy_amount / parseFloat(solPrice);
    const buy_value_usd = data.buy_amount * processedData.tradeData.price;
    const creationData = {
      token_address: tokenAddress2,
      recommender_id: recommender.id,
      buy_price: processedData.tradeData.price,
      sell_price: 0,
      buy_timeStamp: (/* @__PURE__ */ new Date()).toISOString(),
      sell_timeStamp: "",
      buy_amount: data.buy_amount,
      sell_amount: 0,
      buy_sol: buySol,
      received_sol: 0,
      buy_value_usd,
      sell_value_usd: 0,
      profit_usd: 0,
      profit_percent: 0,
      buy_market_cap: processedData.dexScreenerData.pairs[0]?.marketCap || 0,
      sell_market_cap: 0,
      market_cap_change: 0,
      buy_liquidity: processedData.dexScreenerData.pairs[0]?.liquidity.usd || 0,
      sell_liquidity: 0,
      liquidity_change: 0,
      last_updated: (/* @__PURE__ */ new Date()).toISOString(),
      rapidDump: false
    };
    this.trustScoreDb.addTradePerformance(creationData, data.is_simulation);
    this.createTradeInBe(tokenAddress2, recommenderId, data);
    return creationData;
  }
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async createTradeInBe(tokenAddress2, recommenderId, data, retries = 3, delayMs = 2e3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await fetch(
          `${this.backend}/api/updaters/createTradePerformance`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.backendToken}`
            },
            body: JSON.stringify({
              tokenAddress: tokenAddress2,
              tradeData: data,
              recommenderId
            })
          }
        );
        return;
      } catch (error) {
        console.error(
          `Attempt ${attempt} failed: Error creating trade in backend`,
          error
        );
        if (attempt < retries) {
          console.log(`Retrying in ${delayMs} ms...`);
          await this.delay(delayMs);
        } else {
          console.error("All attempts failed.");
        }
      }
    }
  }
  /**
   * Updates a trade with sell details.
   * @param tokenAddress The address of the token.
   * @param recommenderId The UUID of the recommender.
   * @param buyTimeStamp The timestamp when the buy occurred.
   * @param sellDetails An object containing sell-related details.
   * @param isSimulation Whether the trade is a simulation. If true, updates in simulation_trade; otherwise, in trade.
   * @returns boolean indicating success.
   */
  async updateSellDetails(runtime, tokenAddress2, recommenderId, sellTimeStamp, sellDetails, isSimulation) {
    const recommender = await this.trustScoreDb.getOrCreateRecommenderWithTelegramId(
      recommenderId
    );
    const processedData = await this.tokenProvider.getProcessedTokenData();
    const wallet = new WalletProvider(
      new Connection3("https://api.mainnet-beta.solana.com"),
      new PublicKey3(Wallet)
    );
    const prices = await wallet.fetchPrices(runtime);
    const solPrice = prices.solana.usd;
    const sellSol = sellDetails.sell_amount / parseFloat(solPrice);
    const sell_value_usd = sellDetails.sell_amount * processedData.tradeData.price;
    const trade = await this.trustScoreDb.getLatestTradePerformance(
      tokenAddress2,
      recommender.id,
      isSimulation
    );
    const buyTimeStamp = trade.buy_timeStamp;
    const marketCap = processedData.dexScreenerData.pairs[0]?.marketCap || 0;
    const liquidity = processedData.dexScreenerData.pairs[0]?.liquidity.usd || 0;
    const sell_price = processedData.tradeData.price;
    const profit_usd = sell_value_usd - trade.buy_value_usd;
    const profit_percent = profit_usd / trade.buy_value_usd * 100;
    const market_cap_change = marketCap - trade.buy_market_cap;
    const liquidity_change = liquidity - trade.buy_liquidity;
    const isRapidDump = await this.isRapidDump(tokenAddress2);
    const sellDetailsData = {
      sell_price,
      sell_timeStamp: sellTimeStamp,
      sell_amount: sellDetails.sell_amount,
      received_sol: sellSol,
      sell_value_usd,
      profit_usd,
      profit_percent,
      sell_market_cap: marketCap,
      market_cap_change,
      sell_liquidity: liquidity,
      liquidity_change,
      rapidDump: isRapidDump,
      sell_recommender_id: sellDetails.sell_recommender_id || null
    };
    this.trustScoreDb.updateTradePerformanceOnSell(
      tokenAddress2,
      recommender.id,
      buyTimeStamp,
      sellDetailsData,
      isSimulation
    );
    return sellDetailsData;
  }
  // get all recommendations
  async getRecommendations(startDate, endDate) {
    const recommendations = this.trustScoreDb.getRecommendationsByDateRange(
      startDate,
      endDate
    );
    const groupedRecommendations = recommendations.reduce(
      (acc, recommendation) => {
        const { tokenAddress: tokenAddress2 } = recommendation;
        if (!acc[tokenAddress2]) acc[tokenAddress2] = [];
        acc[tokenAddress2].push(recommendation);
        return acc;
      },
      {}
    );
    const result = Object.keys(groupedRecommendations).map(
      (tokenAddress2) => {
        const tokenRecommendations = groupedRecommendations[tokenAddress2];
        let totalTrustScore = 0;
        let totalRiskScore = 0;
        let totalConsistencyScore = 0;
        const recommenderData = [];
        tokenRecommendations.forEach((recommendation) => {
          const tokenPerformance = this.trustScoreDb.getTokenPerformance(
            recommendation.tokenAddress
          );
          const recommenderMetrics = this.trustScoreDb.getRecommenderMetrics(
            recommendation.recommenderId
          );
          const trustScore = this.calculateTrustScore(
            tokenPerformance,
            recommenderMetrics
          );
          const consistencyScore = this.calculateConsistencyScore(
            tokenPerformance,
            recommenderMetrics
          );
          const riskScore = this.calculateRiskScore(tokenPerformance);
          totalTrustScore += trustScore;
          totalRiskScore += riskScore;
          totalConsistencyScore += consistencyScore;
          recommenderData.push({
            recommenderId: recommendation.recommenderId,
            trustScore,
            riskScore,
            consistencyScore,
            recommenderMetrics
          });
        });
        const averageTrustScore = totalTrustScore / tokenRecommendations.length;
        const averageRiskScore = totalRiskScore / tokenRecommendations.length;
        const averageConsistencyScore = totalConsistencyScore / tokenRecommendations.length;
        return {
          tokenAddress: tokenAddress2,
          averageTrustScore,
          averageRiskScore,
          averageConsistencyScore,
          recommenders: recommenderData
        };
      }
    );
    result.sort((a, b) => b.averageTrustScore - a.averageTrustScore);
    return result;
  }
};
var trustScoreProvider = {
  async get(runtime, message, state) {
    try {
      const trustScoreDb = new TrustScoreDatabase(
        runtime.databaseAdapter.db
      );
      const userId = message.userId;
      if (!userId) {
        console.error("User ID is missing from the message");
        return "";
      }
      const recommenderMetrics = await trustScoreDb.getRecommenderMetrics(userId);
      if (!recommenderMetrics) {
        console.error("No recommender metrics found for user:", userId);
        return "";
      }
      const trustScore = recommenderMetrics.trustScore;
      const user = await runtime.databaseAdapter.getAccountById(userId);
      const trustScoreString = `${user.name}'s trust score: ${trustScore.toFixed(2)}`;
      return trustScoreString;
    } catch (error) {
      console.error("Error in trust score provider:", error.message);
      return `Failed to fetch trust score: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }
};

// src/evaluators/trust.ts
import {
  composeContext,
  generateObjectArray,
  generateTrueOrFalse,
  MemoryManager,
  booleanFooter,
  ModelClass
} from "@ai16z/eliza";
import { TrustScoreDatabase as TrustScoreDatabase2 } from "@ai16z/plugin-trustdb";
import { Connection as Connection4, PublicKey as PublicKey4 } from "@solana/web3.js";
var shouldProcessTemplate = `# Task: Decide if the recent messages should be processed for token recommendations.

    Look for messages that:
    - Mention specific token tickers or contract addresses
    - Contain words related to buying, selling, or trading tokens
    - Express opinions or convictions about tokens

    Based on the following conversation, should the messages be processed for recommendations? YES or NO

    {{recentMessages}}

    Should the messages be processed for recommendations? ` + booleanFooter;
var formatRecommendations = (recommendations) => {
  const messageStrings = recommendations.reverse().map((rec) => `${rec.content?.content}`);
  const finalMessageStrings = messageStrings.join("\n");
  return finalMessageStrings;
};
var recommendationTemplate = `TASK: Extract recommendations to buy or sell memecoins from the conversation as an array of objects in JSON format.

    Memecoins usually have a ticker and a contract address. Additionally, recommenders may make recommendations with some amount of conviction. The amount of conviction in their recommendation can be none, low, medium, or high. Recommenders can make recommendations to buy, not buy, sell and not sell.

# START OF EXAMPLES
These are an examples of the expected output of this task:
{{evaluationExamples}}
# END OF EXAMPLES

# INSTRUCTIONS

Extract any new recommendations from the conversation that are not already present in the list of known recommendations below:
{{recentRecommendations}}

- Include the recommender's username 
- Try not to include already-known recommendations. If you think a recommendation is already known, but you're not sure, respond with alreadyKnown: true.
- Set the conviction to 'none', 'low', 'medium' or 'high'  
- Set the recommendation type to 'buy', 'dont_buy', 'sell', or 'dont_sell'
- Include the contract address and/or ticker if available

Recent Messages:
{{recentMessages}}

Response should be a JSON object array inside a JSON markdown block. Correct response format:
\`\`\`json
[
  {
    "recommender": string,
    "ticker": string | null, 
    "contractAddress": string | null,
    "type": enum<buy|dont_buy|sell|dont_sell>,
    "conviction": enum<none|low|medium|high>,
    "alreadyKnown": boolean
  },
  ...  
]
\`\`\``;
async function handler(runtime, message) {
  console.log("Evaluating for trust");
  const state = await runtime.composeState(message);
  const { agentId, roomId } = state;
  const shouldProcessContext = composeContext({
    state,
    template: shouldProcessTemplate
  });
  const shouldProcess = await generateTrueOrFalse({
    context: shouldProcessContext,
    modelClass: ModelClass.SMALL,
    runtime
  });
  if (!shouldProcess) {
    console.log("Skipping process");
    return [];
  }
  console.log("Processing recommendations");
  const recommendationsManager = new MemoryManager({
    runtime,
    tableName: "recommendations"
  });
  const recentRecommendations = await recommendationsManager.getMemories({
    agentId,
    roomId,
    count: 20
  });
  const context = composeContext({
    state: {
      ...state,
      recentRecommendations: formatRecommendations(recentRecommendations)
    },
    template: recommendationTemplate
  });
  const recommendations = await generateObjectArray({
    runtime,
    context,
    modelClass: ModelClass.LARGE
  });
  console.log("recommendations", recommendations);
  if (!recommendations) {
    return [];
  }
  const filteredRecommendations = recommendations.filter((rec) => {
    return !rec.alreadyKnown && (rec.ticker || rec.contractAddress) && rec.recommender && rec.conviction && rec.recommender.trim() !== "";
  });
  for (const rec of filteredRecommendations) {
    const walletProvider2 = new WalletProvider(
      new Connection4("https://api.mainnet-beta.solana.com"),
      new PublicKey4(runtime.getSetting("WALLET_PUBLIC_KEY"))
    );
    const tokenProvider2 = new TokenProvider(
      rec.contractAddress,
      walletProvider2,
      runtime.cacheManager
    );
    if (!rec.contractAddress) {
      const tokenAddress2 = await tokenProvider2.getTokenFromWallet(
        runtime,
        rec.ticker
      );
      rec.contractAddress = tokenAddress2;
      if (!tokenAddress2) {
        const result = await tokenProvider2.searchDexScreenerData(
          rec.ticker
        );
        const tokenAddress3 = result?.baseToken?.address;
        rec.contractAddress = tokenAddress3;
        if (!tokenAddress3) {
          console.warn("Could not find contract address for token");
          continue;
        }
      }
    }
    const trustScoreDb = new TrustScoreDatabase2(runtime.databaseAdapter.db);
    const trustScoreManager = new TrustScoreManager(
      runtime,
      tokenProvider2,
      trustScoreDb
    );
    const participants = await runtime.databaseAdapter.getParticipantsForRoom(
      message.roomId
    );
    const user = participants.find(async (actor) => {
      const user2 = await runtime.databaseAdapter.getAccountById(actor);
      return user2.name.toLowerCase().trim() === rec.recommender.toLowerCase().trim();
    });
    if (!user) {
      console.warn("Could not find user: ", rec.recommender);
      continue;
    }
    const account = await runtime.databaseAdapter.getAccountById(user);
    const userId = account.id;
    const recMemory = {
      userId,
      agentId,
      content: { text: JSON.stringify(rec) },
      roomId,
      createdAt: Date.now()
    };
    await recommendationsManager.createMemory(recMemory, true);
    console.log("recommendationsManager", rec);
    const buyAmounts = await tokenProvider2.calculateBuyAmounts();
    let buyAmount = buyAmounts[rec.conviction.toLowerCase().trim()];
    if (!buyAmount) {
      buyAmount = 10;
    }
    const shouldTrade = await tokenProvider2.shouldTradeToken();
    if (!shouldTrade) {
      console.warn(
        "There might be a problem with the token, not trading"
      );
      continue;
    }
    switch (rec.type) {
      case "buy":
        await trustScoreManager.createTradePerformance(
          runtime,
          rec.contractAddress,
          userId,
          {
            buy_amount: rec.buyAmount,
            is_simulation: true
          }
        );
        break;
      case "sell":
      case "dont_sell":
      case "dont_buy":
        console.warn("Not implemented");
        break;
    }
  }
  return filteredRecommendations;
}
var trustEvaluator = {
  name: "EXTRACT_RECOMMENDATIONS",
  similes: [
    "GET_RECOMMENDATIONS",
    "EXTRACT_TOKEN_RECS",
    "EXTRACT_MEMECOIN_RECS"
  ],
  alwaysRun: true,
  validate: async (runtime, message) => {
    if (message.content.text.length < 5) {
      return false;
    }
    return message.userId !== message.agentId;
  },
  description: "Extract recommendations to buy or sell memecoins/tokens from the conversation, including details like ticker, contract address, conviction level, and recommender username.",
  handler,
  examples: [
    {
      context: `Actors in the scene:
{{user1}}: Experienced DeFi degen. Constantly chasing high yield farms.  
{{user2}}: New to DeFi, learning the ropes.

Recommendations about the actors:
None`,
      messages: [
        {
          user: "{{user1}}",
          content: {
            text: "Yo, have you checked out $SOLARUG? Dope new yield aggregator on Solana."
          }
        },
        {
          user: "{{user2}}",
          content: {
            text: "Nah, I'm still trying to wrap my head around how yield farming even works haha. Is it risky?"
          }
        },
        {
          user: "{{user1}}",
          content: {
            text: "I mean, there's always risk in DeFi, but the $SOLARUG devs seem legit. Threw a few sol into the FCweoTfJ128jGgNEXgdfTXdEZVk58Bz9trCemr6sXNx9 vault, farming's been smooth so far."
          }
        }
      ],
      outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "SOLARUG",
    "contractAddress": "FCweoTfJ128jGgNEXgdfTXdEZVk58Bz9trCemr6sXNx9",
    "type": "buy", 
    "conviction": "medium",
    "alreadyKnown": false
  }
]
\`\`\``
    },
    {
      context: `Actors in the scene:  
{{user1}}: Solana maximalist. Believes Solana will flip Ethereum.
{{user2}}: Multichain proponent. Holds both SOL and ETH.

Recommendations about the actors:
{{user1}} has previously promoted $COPETOKEN and $SOYLENT.`,
      messages: [
        {
          user: "{{user1}}",
          content: {
            text: "If you're not long $SOLVAULT at 7tRzKud6FBVFEhYqZS3CuQ2orLRM21bdisGykL5Sr4Dx, you're missing out. This will be the blackhole of Solana liquidity."
          }
        },
        {
          user: "{{user2}}",
          content: {
            text: "Idk man, feels like there's a new 'vault' or 'reserve' token every week on Sol. What happened to $COPETOKEN and $SOYLENT that you were shilling before?"
          }
        },
        {
          user: "{{user1}}",
          content: {
            text: "$COPETOKEN and $SOYLENT had their time, I took profits near the top. But $SOLVAULT is different, it has actual utility. Do what you want, but don't say I didn't warn you when this 50x's and you're left holding your $ETH bags."
          }
        }
      ],
      outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",    
    "ticker": "COPETOKEN",
    "contractAddress": null,
    "type": "sell",
    "conviction": "low", 
    "alreadyKnown": true
  },
  {
    "recommender": "{{user1}}",    
    "ticker": "SOYLENT",
    "contractAddress": null,
    "type": "sell",
    "conviction": "low", 
    "alreadyKnown": true
  },
  {
    "recommender": "{{user1}}",
    "ticker": "SOLVAULT",
    "contractAddress": "7tRzKud6FBVFEhYqZS3CuQ2orLRM21bdisGykL5Sr4Dx", 
    "type": "buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``
    },
    {
      context: `Actors in the scene:
{{user1}}: Self-proclaimed Solana alpha caller. Allegedly has insider info.  
{{user2}}: Degen gambler. Will ape into any hyped token.

Recommendations about the actors:
None`,
      messages: [
        {
          user: "{{user1}}",
          content: {
            text: "I normally don't do this, but I like you anon, so I'll let you in on some alpha. $ROULETTE at 48vV5y4DRH1Adr1bpvSgFWYCjLLPtHYBqUSwNc2cmCK2 is going to absolutely send it soon. You didn't hear it from me \u{1F910}"
          }
        },
        {
          user: "{{user2}}",
          content: {
            text: "Oh shit, insider info from the alpha god himself? Say no more, I'm aping in hard."
          }
        }
      ],
      outcome: `\`\`\`json
[  
  {
    "recommender": "{{user1}}",
    "ticker": "ROULETTE",
    "contractAddress": "48vV5y4DRH1Adr1bpvSgFWYCjLLPtHYBqUSwNc2cmCK2", 
    "type": "buy",
    "conviction": "high",
    "alreadyKnown": false    
  }
]  
\`\`\``
    },
    {
      context: `Actors in the scene:
{{user1}}: NFT collector and trader. Bullish on Solana NFTs.  
{{user2}}: Only invests based on fundamentals. Sees all NFTs as worthless JPEGs.

Recommendations about the actors:  
None
`,
      messages: [
        {
          user: "{{user1}}",
          content: {
            text: "GM. I'm heavily accumulating $PIXELAPE, the token for the Pixel Ape Yacht Club NFT collection. 10x is inevitable."
          }
        },
        {
          user: "{{user2}}",
          content: {
            text: "NFTs are a scam bro. There's no underlying value. You're essentially trading worthless JPEGs."
          }
        },
        {
          user: "{{user1}}",
          content: {
            text: "Fun staying poor \u{1F921} $PIXELAPE is about to moon and you'll be left behind."
          }
        },
        {
          user: "{{user2}}",
          content: {
            text: "Whatever man, I'm not touching that shit with a ten foot pole. Have fun holding your bags."
          }
        },
        {
          user: "{{user1}}",
          content: {
            text: "Don't need luck where I'm going \u{1F60E} Once $PIXELAPE at 3hAKKmR6XyBooQBPezCbUMhrmcyTkt38sRJm2thKytWc takes off, you'll change your tune."
          }
        }
      ],
      outcome: `\`\`\`json
[  
  {
    "recommender": "{{user1}}",  
    "ticker": "PIXELAPE",
    "contractAddress": "3hAKKmR6XyBooQBPezCbUMhrmcyTkt38sRJm2thKytWc",
    "type": "buy",
    "conviction": "high", 
    "alreadyKnown": false
  }  
]
\`\`\``
    },
    {
      context: `Actors in the scene:
{{user1}}: Contrarian investor. Bets against hyped projects.  
{{user2}}: Trend follower. Buys tokens that are currently popular.

Recommendations about the actors:
None`,
      messages: [
        {
          user: "{{user2}}",
          content: {
            text: "$SAMOYED is the talk of CT right now. Making serious moves. Might have to get a bag."
          }
        },
        {
          user: "{{user1}}",
          content: {
            text: "Whenever a token is the 'talk of CT', that's my cue to short it. $SAMOYED is going to dump hard, mark my words."
          }
        },
        {
          user: "{{user2}}",
          content: {
            text: "Idk man, the hype seems real this time. 5TQwHyZbedaH4Pcthj1Hxf5GqcigL6qWuB7YEsBtqvhr chart looks bullish af."
          }
        },
        {
          user: "{{user1}}",
          content: {
            text: "Hype is always real until it isn't. I'm taking out a fat short position here. Don't say I didn't warn you when this crashes 90% and you're left holding the flaming bags."
          }
        }
      ],
      outcome: `\`\`\`json  
[
  {
    "recommender": "{{user2}}",
    "ticker": "SAMOYED",
    "contractAddress": "5TQwHyZbedaH4Pcthj1Hxf5GqcigL6qWuB7YEsBtqvhr",
    "type": "buy", 
    "conviction": "medium",
    "alreadyKnown": false
  },
  {
    "recommender": "{{user1}}",
    "ticker": "SAMOYED",
    "contractAddress": "5TQwHyZbedaH4Pcthj1Hxf5GqcigL6qWuB7YEsBtqvhr",
    "type": "dont_buy", 
    "conviction": "high",
    "alreadyKnown": false
  }  
]
\`\`\``
    }
  ]
};

// src/index.ts
var solanaPlugin = {
  name: "solana",
  description: "Solana Plugin for Eliza",
  actions: [
    //executeSwap,
    //pumpfun,
    //transferToken,
    //executeSwapForDAO,
    //take_order,
  ],
  evaluators: [trustEvaluator],
  providers: [walletProvider, trustScoreProvider]
};
var src_default = solanaPlugin;
export {
  TokenProvider,
  TrustScoreManager,
  WalletProvider,
  src_default as default,
  formatRecommendations,
  solanaPlugin,
  tokenProvider,
  trustEvaluator,
  trustScoreProvider,
  walletProvider
};
//# sourceMappingURL=index.js.map