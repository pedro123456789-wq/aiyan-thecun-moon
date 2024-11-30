// src/index.ts
import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import multer from "multer";
import { elizaLogger, generateCaption, generateImage } from "@ai16z/eliza";
import { composeContext } from "@ai16z/eliza";
import { generateMessageResponse } from "@ai16z/eliza";
import { messageCompletionFooter } from "@ai16z/eliza";
import {
  ModelClass
} from "@ai16z/eliza";
import { stringToUuid } from "@ai16z/eliza";
import { settings } from "@ai16z/eliza";
var upload = multer({ storage: multer.memoryStorage() });
var messageHandlerTemplate = (
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

{{providers}}

{{attachments}}

# Capabilities
Note that {{agentName}} is capable of reading/seeing/hearing various forms of media, including images, videos, audio, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section.

{{messageDirections}}

{{recentMessages}}

{{actions}}

# Instructions: Write the next message for {{agentName}}.
` + messageCompletionFooter
);
var DirectClient = class {
  app;
  agents;
  constructor() {
    elizaLogger.log("DirectClient constructor");
    this.app = express();
    this.app.use(cors());
    this.agents = /* @__PURE__ */ new Map();
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));
    this.app.post(
      "/:agentId/whisper",
      upload.single("file"),
      async (req, res) => {
        const audioFile = req.file;
        const agentId = req.params.agentId;
        if (!audioFile) {
          res.status(400).send("No audio file provided");
          return;
        }
        let runtime = this.agents.get(agentId);
        if (!runtime) {
          runtime = Array.from(this.agents.values()).find(
            (a) => a.character.name.toLowerCase() === agentId.toLowerCase()
          );
        }
        if (!runtime) {
          res.status(404).send("Agent not found");
          return;
        }
        const formData = new FormData();
        const audioBlob = new Blob([audioFile.buffer], {
          type: audioFile.mimetype
        });
        formData.append("file", audioBlob, audioFile.originalname);
        formData.append("model", "whisper-1");
        const response = await fetch(
          "https://api.openai.com/v1/audio/transcriptions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${runtime.token}`
            },
            body: formData
          }
        );
        const data = await response.json();
        res.json(data);
      }
    );
    this.app.post(
      "/:agentId/message",
      async (req, res) => {
        const agentId = req.params.agentId;
        const roomId = stringToUuid(
          req.body.roomId ?? "default-room-" + agentId
        );
        const userId = stringToUuid(req.body.userId ?? "user");
        let runtime = this.agents.get(agentId);
        if (!runtime) {
          runtime = Array.from(this.agents.values()).find(
            (a) => a.character.name.toLowerCase() === agentId.toLowerCase()
          );
        }
        if (!runtime) {
          res.status(404).send("Agent not found");
          return;
        }
        await runtime.ensureConnection(
          userId,
          roomId,
          req.body.userName,
          req.body.name,
          "direct"
        );
        const text = req.body.text;
        const messageId = stringToUuid(Date.now().toString());
        const content = {
          text,
          attachments: [],
          source: "direct",
          inReplyTo: void 0
        };
        const userMessage = {
          content,
          userId,
          roomId,
          agentId: runtime.agentId
        };
        const memory = {
          id: messageId,
          agentId: runtime.agentId,
          userId,
          roomId,
          content,
          createdAt: Date.now()
        };
        await runtime.messageManager.createMemory(memory);
        const state = await runtime.composeState(userMessage, {
          agentName: runtime.character.name
        });
        const context = composeContext({
          state,
          template: messageHandlerTemplate
        });
        const response = await generateMessageResponse({
          runtime,
          context,
          modelClass: ModelClass.SMALL
        });
        const responseMessage = {
          ...userMessage,
          userId: runtime.agentId,
          content: response
        };
        await runtime.messageManager.createMemory(responseMessage);
        if (!response) {
          res.status(500).send(
            "No response from generateMessageResponse"
          );
          return;
        }
        let message = null;
        await runtime.evaluate(memory, state);
        const result = await runtime.processActions(
          memory,
          [responseMessage],
          state,
          async (newMessages) => {
            message = newMessages;
            return [memory];
          }
        );
        if (message) {
          res.json([message, response]);
        } else {
          res.json([response]);
        }
      }
    );
    this.app.post(
      "/:agentId/image",
      async (req, res) => {
        const agentId = req.params.agentId;
        const agent = this.agents.get(agentId);
        if (!agent) {
          res.status(404).send("Agent not found");
          return;
        }
        const images = await generateImage({ ...req.body }, agent);
        const imagesRes = [];
        if (images.data && images.data.length > 0) {
          for (let i = 0; i < images.data.length; i++) {
            const caption = await generateCaption(
              { imageUrl: images.data[i] },
              agent
            );
            imagesRes.push({
              image: images.data[i],
              caption: caption.title
            });
          }
        }
        res.json({ images: imagesRes });
      }
    );
  }
  registerAgent(runtime) {
    this.agents.set(runtime.agentId, runtime);
  }
  unregisterAgent(runtime) {
    this.agents.delete(runtime.agentId);
  }
  start(port) {
    this.app.listen(port, () => {
      elizaLogger.success(`Server running at http://localhost:${port}/`);
    });
  }
};
var DirectClientInterface = {
  start: async (runtime) => {
    elizaLogger.log("DirectClientInterface start");
    const client = new DirectClient();
    const serverPort = parseInt(settings.SERVER_PORT || "3000");
    client.start(serverPort);
    return client;
  },
  stop: async (runtime) => {
    elizaLogger.warn("Direct client does not support stopping yet");
  }
};
var src_default = DirectClientInterface;
export {
  DirectClient,
  DirectClientInterface,
  src_default as default,
  messageHandlerTemplate
};
//# sourceMappingURL=index.js.map