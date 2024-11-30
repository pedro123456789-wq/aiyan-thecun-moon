// src/index.ts
import { elizaLogger as elizaLogger2 } from "@ai16z/eliza";

// src/telegramClient.ts
import { Telegraf } from "telegraf";

// src/messageManager.ts
import { composeContext } from "@ai16z/eliza";
import { embeddingZeroVector } from "@ai16z/eliza";
import {
  ModelClass
} from "@ai16z/eliza";
import { stringToUuid } from "@ai16z/eliza";
import { generateMessageResponse, generateShouldRespond } from "@ai16z/eliza";
import { messageCompletionFooter, shouldRespondFooter } from "@ai16z/eliza";
import { ImageDescriptionService } from "@ai16z/plugin-node";
var MAX_MESSAGE_LENGTH = 4096;
var telegramShouldRespondTemplate = `# About {{agentName}}:
{{bio}}

# RESPONSE EXAMPLES
{{user1}}: I just saw a really great movie
{{user2}}: Oh? Which movie?
Result: [IGNORE]

{{agentName}}: Oh, this is my favorite scene
{{user1}}: sick
{{user2}}: wait, why is it your favorite scene
Result: [RESPOND]

{{user1}}: stfu bot
Result: [STOP]

{{user1}}: Hey {{agent}}, can you help me with something
Result: [RESPOND]

{{user1}}: {{agentName}} stfu plz
Result: [STOP]

{{user1}}: i need help
{{agentName}}: how can I help you?
{{user1}}: no. i need help from someone else
Result: [IGNORE]

{{user1}}: Hey {{agent}}, can I ask you a question
{{agentName}}: Sure, what is it
{{user1}}: can you ask claude to create a basic react module that demonstrates a counter
Result: [RESPOND]

{{user1}}: {{agentName}} can you tell me a story
{{agentName}}: uhhh...
{{user1}}: please do it
{{agentName}}: okay
{{agentName}}: once upon a time, in a quaint little village, there was a curious girl named elara
{{user1}}: I'm loving it, keep going
Result: [RESPOND]

{{user1}}: {{agentName}} stop responding plz
Result: [STOP]

{{user1}}: okay, i want to test something. {{agentName}}, can you say marco?
{{agentName}}: marco
{{user1}}: great. okay, now do it again
Result: [RESPOND]

Response options are [RESPOND], [IGNORE] and [STOP].

{{agentName}} is in a room with other users and should only respond when they are being addressed, and should not respond if they are continuing a conversation that is very long.

Respond with [RESPOND] to messages that are directed at {{agentName}}, or participate in conversations that are interesting or relevant to their background.
If a message is not interesting, relevant, or does not directly address {{agentName}}, respond with [IGNORE]

Also, respond with [IGNORE] to messages that are very short or do not contain much information.

If a user asks {{agentName}} to be quiet, respond with [STOP]
If {{agentName}} concludes a conversation and isn't part of the conversation anymore, respond with [STOP]

IMPORTANT: {{agentName}} is particularly sensitive about being annoying, so if there is any doubt, it is better to respond with [IGNORE].
If {{agentName}} is conversing with a user and they have not asked to stop, it is better to respond with [RESPOND].

The goal is to decide whether {{agentName}} should respond to the last message.

{{recentMessages}}

Thread of Tweets You Are Replying To:

{{formattedConversation}}

# INSTRUCTIONS: Choose the option that best describes {{agentName}}'s response to the last message. Ignore messages if they are addressed to someone else.
` + shouldRespondFooter;
var telegramMessageHandlerTemplate = (
  // {{goals}}
  `# Action Examples
{{actionExamples}}
(Action examples are for reference only. Do not use the information from them in your response.)

# Knowledge
{{knowledge}}

# Task: Generate dialog and actions for the character {{agentName}}.
About {{agentName}}:
{{bio}}
{{lore}}

Examples of {{agentName}}'s dialog and actions:
{{characterMessageExamples}}

{{providers}}

{{attachments}}

{{actions}}

# Capabilities
Note that {{agentName}} is capable of reading/seeing/hearing various forms of media, including images, videos, audio, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section.

{{messageDirections}}

{{recentMessages}}

# Task: Generate a post/reply in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}) while using the thread of tweets as additional context:
Current Post:
{{currentPost}}
Thread of Tweets You Are Replying To:

{{formattedConversation}}
` + messageCompletionFooter
);
var MessageManager = class {
  bot;
  runtime;
  imageService;
  constructor(bot, runtime) {
    this.bot = bot;
    this.runtime = runtime;
    this.imageService = ImageDescriptionService.getInstance();
  }
  // Process image messages and generate descriptions
  async processImage(message) {
    try {
      let imageUrl = null;
      if ("photo" in message && message.photo?.length > 0) {
        const photo = message.photo[message.photo.length - 1];
        const fileLink = await this.bot.telegram.getFileLink(
          photo.file_id
        );
        imageUrl = fileLink.toString();
      } else if ("document" in message && message.document?.mime_type?.startsWith("image/")) {
        const doc = message.document;
        const fileLink = await this.bot.telegram.getFileLink(
          doc.file_id
        );
        imageUrl = fileLink.toString();
      }
      if (imageUrl) {
        const { title, description } = await this.imageService.describeImage(imageUrl);
        const fullDescription = `[Image: ${title}
${description}]`;
        return { description: fullDescription };
      }
    } catch (error) {
      console.error("\u274C Error processing image:", error);
    }
    return null;
  }
  // Decide if the bot should respond to the message
  async _shouldRespond(message, state) {
    if ("text" in message && message.text?.includes(`@${this.bot.botInfo?.username}`)) {
      return true;
    }
    if (message.chat.type === "private") {
      return true;
    }
    if ("photo" in message || "document" in message && message.document?.mime_type?.startsWith("image/")) {
      return false;
    }
    if ("text" in message || "caption" in message && message.caption) {
      const shouldRespondContext = composeContext({
        state,
        template: this.runtime.character.templates?.telegramShouldRespondTemplate || this.runtime.character?.templates?.shouldRespondTemplate || telegramShouldRespondTemplate
      });
      const response = await generateShouldRespond({
        runtime: this.runtime,
        context: shouldRespondContext,
        modelClass: ModelClass.SMALL
      });
      return response === "RESPOND";
    }
    return false;
  }
  // Send long messages in chunks
  async sendMessageInChunks(ctx, content, replyToMessageId) {
    const chunks = this.splitMessage(content);
    const sentMessages = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const sentMessage = await ctx.telegram.sendMessage(
        ctx.chat.id,
        chunk,
        {
          reply_parameters: i === 0 && replyToMessageId ? { message_id: replyToMessageId } : void 0
        }
      );
      sentMessages.push(sentMessage);
    }
    return sentMessages;
  }
  // Split message into smaller parts
  splitMessage(text) {
    const chunks = [];
    let currentChunk = "";
    const lines = text.split("\n");
    for (const line of lines) {
      if (currentChunk.length + line.length + 1 <= MAX_MESSAGE_LENGTH) {
        currentChunk += (currentChunk ? "\n" : "") + line;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = line;
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }
  // Generate a response using AI
  async _generateResponse(message, state, context) {
    const { userId, roomId } = message;
    const response = await generateMessageResponse({
      runtime: this.runtime,
      context,
      modelClass: ModelClass.SMALL
    });
    if (!response) {
      console.error("\u274C No response from generateMessageResponse");
      return null;
    }
    await this.runtime.databaseAdapter.log({
      body: { message, context, response },
      userId,
      roomId,
      type: "response"
    });
    return response;
  }
  // Main handler for incoming messages
  async handleMessage(ctx) {
    if (!ctx.message || !ctx.from) {
      return;
    }
    if (this.runtime.character.clientConfig?.telegram?.shouldIgnoreBotMessages && ctx.from.is_bot) {
      return;
    }
    if (this.runtime.character.clientConfig?.telegram?.shouldIgnoreDirectMessages && ctx.chat?.type === "private") {
      return;
    }
    const message = ctx.message;
    try {
      const userId = stringToUuid(ctx.from.id.toString());
      const userName = ctx.from.username || ctx.from.first_name || "Unknown User";
      const chatId = stringToUuid(
        ctx.chat?.id.toString() + "-" + this.runtime.agentId
      );
      const agentId = this.runtime.agentId;
      const roomId = chatId;
      await this.runtime.ensureConnection(
        userId,
        roomId,
        userName,
        userName,
        "telegram"
      );
      const messageId = stringToUuid(
        message.message_id.toString() + "-" + this.runtime.agentId
      );
      const imageInfo = await this.processImage(message);
      let messageText = "";
      if ("text" in message) {
        messageText = message.text;
      } else if ("caption" in message && message.caption) {
        messageText = message.caption;
      }
      const fullText = imageInfo ? `${messageText} ${imageInfo.description}` : messageText;
      if (!fullText) {
        return;
      }
      const content = {
        text: fullText,
        source: "telegram"
        // inReplyTo:
        //     "reply_to_message" in message && message.reply_to_message
        //         ? stringToUuid(
        //               message.reply_to_message.message_id.toString() +
        //                   "-" +
        //                   this.runtime.agentId
        //           )
        //         : undefined,
      };
      const memory = {
        id: messageId,
        agentId,
        userId,
        roomId,
        content,
        createdAt: message.date * 1e3,
        embedding: embeddingZeroVector
      };
      await this.runtime.messageManager.createMemory(memory);
      let state = await this.runtime.composeState(memory);
      state = await this.runtime.updateRecentMessageState(state);
      const shouldRespond = await this._shouldRespond(message, state);
      if (shouldRespond) {
        const context = composeContext({
          state,
          template: this.runtime.character.templates?.telegramMessageHandlerTemplate || this.runtime.character?.templates?.messageHandlerTemplate || telegramMessageHandlerTemplate
        });
        const responseContent = await this._generateResponse(
          memory,
          state,
          context
        );
        if (!responseContent || !responseContent.text) return;
        const callback = async (content2) => {
          const sentMessages = await this.sendMessageInChunks(
            ctx,
            content2.text,
            message.message_id
          );
          const memories = [];
          for (let i = 0; i < sentMessages.length; i++) {
            const sentMessage = sentMessages[i];
            const isLastMessage = i === sentMessages.length - 1;
            const memory2 = {
              id: stringToUuid(
                sentMessage.message_id.toString() + "-" + this.runtime.agentId
              ),
              agentId,
              userId,
              roomId,
              content: {
                ...content2,
                text: sentMessage.text,
                inReplyTo: messageId
              },
              createdAt: sentMessage.date * 1e3,
              embedding: embeddingZeroVector
            };
            memory2.content.action = !isLastMessage ? "CONTINUE" : content2.action;
            await this.runtime.messageManager.createMemory(memory2);
            memories.push(memory2);
          }
          return memories;
        };
        const responseMessages = await callback(responseContent);
        state = await this.runtime.updateRecentMessageState(state);
        await this.runtime.processActions(
          memory,
          responseMessages,
          state,
          callback
        );
      }
      await this.runtime.evaluate(memory, state, shouldRespond);
    } catch (error) {
      console.error("\u274C Error handling message:", error);
      console.error("Error sending message:", error);
    }
  }
};

// src/telegramClient.ts
import { elizaLogger } from "@ai16z/eliza";
var TelegramClient = class {
  bot;
  runtime;
  messageManager;
  constructor(runtime, botToken) {
    elizaLogger.log("\u{1F4F1} Constructing new TelegramClient...");
    this.runtime = runtime;
    this.bot = new Telegraf(botToken);
    this.messageManager = new MessageManager(this.bot, this.runtime);
    elizaLogger.log("\u2705 TelegramClient constructor completed");
  }
  async start() {
    elizaLogger.log("\u{1F680} Starting Telegram bot...");
    try {
      this.bot.launch({
        dropPendingUpdates: true
      });
      elizaLogger.log(
        "\u2728 Telegram bot successfully launched and is running!"
      );
      await this.bot.telegram.getMe().then((botInfo) => {
        this.bot.botInfo = botInfo;
      });
      elizaLogger.success(`Bot username: @${this.bot.botInfo?.username}`);
      this.messageManager.bot = this.bot;
      elizaLogger.log("Setting up message handler...");
      this.bot.on("message", async (ctx) => {
        try {
          await this.messageManager.handleMessage(ctx);
        } catch (error) {
          elizaLogger.error("\u274C Error handling message:", error);
          await ctx.reply(
            "An error occurred while processing your message."
          );
        }
      });
      this.bot.on("photo", (ctx) => {
        elizaLogger.log(
          "\u{1F4F8} Received photo message with caption:",
          ctx.message.caption
        );
      });
      this.bot.on("document", (ctx) => {
        elizaLogger.log(
          "\u{1F4CE} Received document message:",
          ctx.message.document.file_name
        );
      });
      this.bot.catch((err, ctx) => {
        elizaLogger.error(
          `\u274C Telegram Error for ${ctx.updateType}:`,
          err
        );
        ctx.reply(
          "An unexpected error occurred. Please try again later."
        );
      });
      const shutdownHandler = async (signal) => {
        elizaLogger.log(
          `\u26A0\uFE0F Received ${signal}. Shutting down Telegram bot gracefully...`
        );
        try {
          await this.stop();
          elizaLogger.log("\u{1F6D1} Telegram bot stopped gracefully");
        } catch (error) {
          elizaLogger.error(
            "\u274C Error during Telegram bot shutdown:",
            error
          );
          throw error;
        }
      };
      process.once("SIGINT", () => shutdownHandler("SIGINT"));
      process.once("SIGTERM", () => shutdownHandler("SIGTERM"));
      process.once("SIGHUP", () => shutdownHandler("SIGHUP"));
    } catch (error) {
      elizaLogger.error("\u274C Failed to launch Telegram bot:", error);
      throw error;
    }
  }
  async stop() {
    elizaLogger.log("Stopping Telegram bot...");
    await this.bot.stop();
    elizaLogger.log("Telegram bot stopped");
  }
};

// src/enviroment.ts
import { z } from "zod";
var telegramEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "Telegram bot token is required")
});
async function validateTelegramConfig(runtime) {
  try {
    const config = {
      TELEGRAM_BOT_TOKEN: runtime.getSetting("TELEGRAM_BOT_TOKEN") || process.env.TELEGRAM_BOT_TOKEN
    };
    return telegramEnvSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new Error(
        `Telegram configuration validation failed:
${errorMessages}`
      );
    }
    throw error;
  }
}

// src/index.ts
var TelegramClientInterface = {
  start: async (runtime) => {
    await validateTelegramConfig(runtime);
    const tg = new TelegramClient(
      runtime,
      runtime.getSetting("TELEGRAM_BOT_TOKEN")
    );
    await tg.start();
    elizaLogger2.success(
      `\u2705 Telegram client successfully started for character ${runtime.character.name}`
    );
    return tg;
  },
  stop: async (runtime) => {
    console.warn("Telegram client does not support stopping yet");
  }
};
var src_default = TelegramClientInterface;
export {
  TelegramClientInterface,
  src_default as default
};
//# sourceMappingURL=index.js.map