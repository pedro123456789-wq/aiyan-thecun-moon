import { AgentRuntime, Client } from '@ai16z/eliza';

declare class PapersWithCodeClient {
    private runtime;
    private bot;
    private paperIndex;
    private config;
    constructor(runtime: AgentRuntime);
    private readPaper;
    private telegramPost;
    private run;
    start(): Promise<void>;
}
declare const PapersWithCodeClientInterface: Client;

export { PapersWithCodeClient, PapersWithCodeClientInterface, PapersWithCodeClientInterface as default };
