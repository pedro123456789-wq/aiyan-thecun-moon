import {
    AgentRuntime,
    Client,
    composeContext,
    elizaLogger,
    generateText,
    IAgentRuntime,
    knowledge,
    ModelClass,
    stringToUuid,
} from "@ai16z/eliza";
import axios from "axios";
import { Telegraf } from "telegraf";

const telegramPostTemplate = `
  # Knowledge
  {{knowledge}}
  
  About {{agentName}} 
  {{bio}}
  {{lore}}
  {{postDirections}}
  
  # Task: Generate a telegram channel post in the voice of {{agentName}},
  Your message must be related to some of the papers you have just read and your contemplation about your existence, the world, and the advancements in AI.
  You must reference the exact title of the last paper you read and the year when it was published. Also give the authors etc. 
  Don't include any headings to make it explicit it is a telegram post. Write the post as if you were going to post it.  
  Keep your poetic tone and bring real value to the listeners`;


interface PapersWithCodeConfig {
    telegramBotToken: string;
    telegramChannelId: string;
}

export class PapersWithCodeClient {
    private runtime: AgentRuntime;
    private bot: Telegraf;
    private paperIndex: number;
    private config: PapersWithCodeConfig;

    constructor(runtime: AgentRuntime) {
        this.runtime = runtime;
        this.config = {
            telegramBotToken: runtime.getSetting('TELEGRAM_BOT_TOKEN') as string, 
            telegramChannelId: runtime.getSetting('TELEGRAM_CHANNEL_ID') as string
        }
        elizaLogger.log(this.config.telegramBotToken);
        elizaLogger.log(this.config.telegramChannelId);
        this.bot = new Telegraf(this.config.telegramBotToken);
        this.paperIndex = 1;
    }

    private async readPaper() {
        elizaLogger.log("Reading paper");

        try {
            const response = await axios.get(
                `https://paperswithcode.com/api/v1/papers?ordering=-published&items_per_page=1&page=${this.paperIndex}`
            );
            const paper = response.data.results[0];
            const paperSummary = `${paper.title}: ${paper.abstract}`;

            elizaLogger.log(`Just read paper: ${paper.title}`);
            const knowledgeId = stringToUuid(paperSummary);

            await knowledge.set(this.runtime, {
                id: knowledgeId,
                content: {
                    text: paperSummary,
                    source: "papers-with-code",
                    attachments: [],
                    metadata: {
                        authors: paper.authors,
                        url_pdf: paper.url_pdf,
                    },
                },
            });

            this.paperIndex++;
            return paperSummary;
        } catch (err) {
            elizaLogger.error("Error reading paper: " + err);
            return null;
        }
    }

    private async telegramPost() {
        try {
            const character = this.runtime.character || {
                topics: [],
                templates: {},
            };

            const state = await this.runtime.composeState({
                userId: this.runtime.agentId,
                roomId: stringToUuid("telegram_research_diary_room"),
                agentId: this.runtime.agentId,
                content: {
                    text: character.topics.join(", "),
                    action: "",
                },
            });

            const context = composeContext({
                state,
                template: telegramPostTemplate,
            });

            elizaLogger.log("Prompt: " + context);

            const newMessage = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            const formattedMessage = newMessage.replaceAll(/\\n/g, "\n").trim();

            elizaLogger.log("Output: " + formattedMessage);
            await this.bot.telegram.sendMessage(
                this.config.telegramChannelId,
                formattedMessage
            );
            
        } catch (err){
            elizaLogger.log("Error posting TG message");
            elizaLogger.error(err);
        }
    }

    private async run() {
        elizaLogger.log("Papers with code running...");
        const paperSummary = await this.readPaper();

        if (paperSummary) {
            await this.telegramPost();
        }
    }

    public async start() {
        //post 5 times a day
        this.run();

        // loop paper reading + post
        setInterval(async () => { this.run() }, 6 * 60 * 60 * 1000);
    }
}

export const PapersWithCodeClientInterface: Client = {
    async start(runtime: AgentRuntime) {
        elizaLogger.log("Papers with Code client started");

        const manager = new PapersWithCodeClient(runtime);
        await manager.start();
        return manager;
    },
    async stop(_runtime: IAgentRuntime) {
        elizaLogger.warn("Not supported");
    },
};

export default PapersWithCodeClientInterface;
