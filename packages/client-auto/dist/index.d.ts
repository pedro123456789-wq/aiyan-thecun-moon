import { IAgentRuntime, Client } from '@ai16z/eliza';
import { TrustScoreManager, WalletProvider } from '@ai16z/plugin-solana';

declare class AutoClient {
    interval: NodeJS.Timeout;
    runtime: IAgentRuntime;
    trustScoreProvider: TrustScoreManager;
    walletProvider: WalletProvider;
    constructor(runtime: IAgentRuntime);
    makeTrades(): Promise<void>;
}
declare const AutoClientInterface: Client;

export { AutoClient, AutoClientInterface, AutoClientInterface as default };
