// src/index.ts
import { elizaLogger } from "@ai16z/eliza";
import { generateImage } from "@ai16z/eliza";
import fs from "fs";
import path from "path";

// src/enviroment.ts
import { z } from "zod";
var imageGenEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  TOGETHER_API_KEY: z.string().optional(),
  HEURIST_API_KEY: z.string().optional()
}).refine(
  (data) => {
    return !!(data.ANTHROPIC_API_KEY || data.TOGETHER_API_KEY || data.HEURIST_API_KEY);
  },
  {
    message: "At least one of ANTHROPIC_API_KEY, TOGETHER_API_KEY, or HEURIST_API_KEY is required"
  }
);
async function validateImageGenConfig(runtime) {
  try {
    const config = {
      ANTHROPIC_API_KEY: runtime.getSetting("ANTHROPIC_API_KEY") || process.env.ANTHROPIC_API_KEY,
      TOGETHER_API_KEY: runtime.getSetting("TOGETHER_API_KEY") || process.env.TOGETHER_API_KEY,
      HEURIST_API_KEY: runtime.getSetting("HEURIST_API_KEY") || process.env.HEURIST_API_KEY
    };
    return imageGenEnvSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new Error(
        `Image generation configuration validation failed:
${errorMessages}`
      );
    }
    throw error;
  }
}

// src/index.ts
function saveBase64Image(base64Data, filename) {
  const imageDir = path.join(process.cwd(), "generatedImages");
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }
  const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const imageBuffer = Buffer.from(base64Image, "base64");
  const filepath = path.join(imageDir, `${filename}.png`);
  fs.writeFileSync(filepath, imageBuffer);
  return filepath;
}
async function saveHeuristImage(imageUrl, filename) {
  const imageDir = path.join(process.cwd(), "generatedImages");
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const imageBuffer = Buffer.from(arrayBuffer);
  const filepath = path.join(imageDir, `${filename}.png`);
  fs.writeFileSync(filepath, imageBuffer);
  return filepath;
}
var imageGeneration = {
  name: "GENERATE_IMAGE",
  similes: [
    "IMAGE_GENERATION",
    "IMAGE_GEN",
    "CREATE_IMAGE",
    "MAKE_PICTURE",
    "GENERATE_IMAGE",
    "GENERATE_A",
    "DRAW",
    "DRAW_A",
    "MAKE_A"
  ],
  description: "Generate an image to go along with the message.",
  validate: async (runtime, message) => {
    await validateImageGenConfig(runtime);
    const anthropicApiKeyOk = !!runtime.getSetting("ANTHROPIC_API_KEY");
    const togetherApiKeyOk = !!runtime.getSetting("TOGETHER_API_KEY");
    const heuristApiKeyOk = !!runtime.getSetting("HEURIST_API_KEY");
    return anthropicApiKeyOk || togetherApiKeyOk || heuristApiKeyOk;
  },
  handler: async (runtime, message, state, options, callback) => {
    elizaLogger.log("Composing state for message:", message);
    state = await runtime.composeState(message);
    const userId = runtime.agentId;
    elizaLogger.log("User ID:", userId);
    const imagePrompt = message.content.text;
    elizaLogger.log("Image prompt received:", imagePrompt);
    const res = [];
    elizaLogger.log("Generating image with prompt:", imagePrompt);
    const images = await generateImage(
      {
        prompt: imagePrompt,
        width: 1024,
        height: 1024,
        count: 1
      },
      runtime
    );
    if (images.success && images.data && images.data.length > 0) {
      elizaLogger.log(
        "Image generation successful, number of images:",
        images.data.length
      );
      for (let i = 0; i < images.data.length; i++) {
        const image = images.data[i];
        const filename = `generated_${Date.now()}_${i}`;
        const filepath = image.startsWith("http") ? await saveHeuristImage(image, filename) : saveBase64Image(image, filename);
        elizaLogger.log(`Processing image ${i + 1}:`, filename);
        const caption = "...";
        res.push({ image: filepath, caption: "..." });
        elizaLogger.log(
          `Generated caption for image ${i + 1}:`,
          "..."
          //caption.title
        );
        callback(
          {
            text: "...",
            //caption.description,
            attachments: [
              {
                id: crypto.randomUUID(),
                url: filepath,
                title: "Generated image",
                source: "imageGeneration",
                description: "...",
                //caption.title,
                text: "..."
                //caption.description,
              }
            ]
          },
          [
            {
              attachment: filepath,
              name: `${filename}.png`
            }
          ]
        );
      }
    } else {
      elizaLogger.error("Image generation failed or returned no data.");
    }
  },
  examples: [
    // TODO: We want to generate images in more abstract ways, not just when asked to generate an image
    [
      {
        user: "{{user1}}",
        content: { text: "Generate an image of a cat" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Here's an image of a cat",
          action: "GENERATE_IMAGE"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Generate an image of a dog" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Here's an image of a dog",
          action: "GENERATE_IMAGE"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Create an image of a cat with a hat" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Here's an image of a cat with a hat",
          action: "GENERATE_IMAGE"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Make an image of a dog with a hat" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Here's an image of a dog with a hat",
          action: "GENERATE_IMAGE"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Paint an image of a cat with a hat" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Here's an image of a cat with a hat",
          action: "GENERATE_IMAGE"
        }
      }
    ]
  ]
};
var imageGenerationPlugin = {
  name: "imageGeneration",
  description: "Generate images",
  actions: [imageGeneration],
  evaluators: [],
  providers: []
};
export {
  imageGenerationPlugin,
  saveBase64Image,
  saveHeuristImage
};
//# sourceMappingURL=index.js.map