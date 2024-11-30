// src/index.ts
import { TrustScoreManager } from "@ai16z/plugin-solana";
import { TokenProvider } from "@ai16z/plugin-solana";
import { WalletProvider } from "@ai16z/plugin-solana";
import { TrustScoreDatabase } from "@ai16z/plugin-trustdb";
import { Connection, PublicKey } from "@solana/web3.js";
var AutoClient = class {
  interval;
  runtime;
  trustScoreProvider;
  walletProvider;
  constructor(runtime) {
    this.runtime = runtime;
    const trustScoreDb = new TrustScoreDatabase(runtime.databaseAdapter.db);
    this.trustScoreProvider = new TrustScoreManager(
      runtime,
      null,
      trustScoreDb
    );
    this.walletProvider = new WalletProvider(
      new Connection(runtime.getSetting("RPC_URL")),
      new PublicKey(runtime.getSetting("WALLET_PUBLIC_KEY"))
    );
    this.interval = setInterval(
      async () => {
        await this.makeTrades();
      },
      60 * 60 * 1e3
    );
  }
  async makeTrades() {
    console.log("Running auto loop");
    const startDate = new Date((/* @__PURE__ */ new Date()).getTime() - 60 * 60 * 1e3);
    const endDate = /* @__PURE__ */ new Date();
    const recommendations = await this.trustScoreProvider.getRecommendations(
      startDate,
      endDate
    );
    const highTrustRecommendations = recommendations.filter(
      (r) => r.averageTrustScore > 0.7
    );
    const tokenInfos = highTrustRecommendations.map(
      async (highTrustRecommendation) => {
        const tokenProvider = new TokenProvider(
          highTrustRecommendation.tokenAddress,
          this.walletProvider,
          this.runtime.cacheManager
        );
        const tokenInfo = await tokenProvider.getProcessedTokenData();
        const shouldTrade = await tokenProvider.shouldTradeToken();
        return { tokenInfo, shouldTrade };
      }
    );
  }
};
var AutoClientInterface = {
  start: async (runtime) => {
    const client = new AutoClient(runtime);
    return client;
  },
  stop: async (runtime) => {
    console.warn("Direct client does not support stopping yet");
  }
};
var src_default = AutoClientInterface;
export {
  AutoClient,
  AutoClientInterface,
  src_default as default
};
//# sourceMappingURL=index.js.map