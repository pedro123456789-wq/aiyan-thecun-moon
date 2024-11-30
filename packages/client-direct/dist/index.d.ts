import { AgentRuntime, Client } from '@ai16z/eliza';

declare const messageHandlerTemplate: string;
interface SimliClientConfig {
    apiKey: string;
    faceID: string;
    handleSilence: boolean;
    videoRef: any;
    audioRef: any;
}
declare class DirectClient {
    private app;
    private agents;
    constructor();
    registerAgent(runtime: AgentRuntime): void;
    unregisterAgent(runtime: AgentRuntime): void;
    start(port: number): void;
}
declare const DirectClientInterface: Client;

export { DirectClient, DirectClientInterface, type SimliClientConfig, DirectClientInterface as default, messageHandlerTemplate };
