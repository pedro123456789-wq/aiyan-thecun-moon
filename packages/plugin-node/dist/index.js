// src/services/browser.ts
import { generateText, trimTokens } from "@ai16z/eliza";
import { parseJSONObjectFromText } from "@ai16z/eliza";
import { Service } from "@ai16z/eliza";
import { settings } from "@ai16z/eliza";
import { ModelClass, ServiceType } from "@ai16z/eliza";
import { stringToUuid } from "@ai16z/eliza";
import { PlaywrightBlocker } from "@cliqz/adblocker-playwright";
import CaptchaSolver from "capsolver-npm";
import { chromium } from "playwright";
async function generateSummary(runtime, text) {
  text = trimTokens(text, 1e5, "gpt-4o-mini");
  const prompt = `Please generate a concise summary for the following text:
  
  Text: """
  ${text}
  """
  
  Respond with a JSON object in the following format:
  \`\`\`json
  {
    "title": "Generated Title",
    "summary": "Generated summary and/or description of the text"
  }
  \`\`\``;
  const response = await generateText({
    runtime,
    context: prompt,
    modelClass: ModelClass.SMALL
  });
  const parsedResponse = parseJSONObjectFromText(response);
  if (parsedResponse) {
    return {
      title: parsedResponse.title,
      description: parsedResponse.summary
    };
  }
  return {
    title: "",
    description: ""
  };
}
var BrowserService = class _BrowserService extends Service {
  browser;
  context;
  blocker;
  captchaSolver;
  cacheKey = "content/browser";
  queue = [];
  processing = false;
  static serviceType = ServiceType.BROWSER;
  static register(runtime) {
    return runtime;
  }
  getInstance() {
    return _BrowserService.getInstance();
  }
  constructor() {
    super();
    this.browser = void 0;
    this.context = void 0;
    this.blocker = void 0;
    this.captchaSolver = new CaptchaSolver(
      settings.CAPSOLVER_API_KEY || ""
    );
  }
  async initialize() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });
      this.context = await this.browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      });
      this.blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch);
    }
  }
  async closeBrowser() {
    if (this.context) {
      await this.context.close();
      this.context = void 0;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = void 0;
    }
  }
  async getPageContent(url, runtime) {
    await this.initialize();
    this.queue.push(url);
    this.processQueue(runtime);
    return new Promise((resolve, reject) => {
      const checkQueue = async () => {
        const index = this.queue.indexOf(url);
        if (index !== -1) {
          setTimeout(checkQueue, 100);
        } else {
          try {
            const result = await this.fetchPageContent(
              url,
              runtime
            );
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }
      };
      checkQueue();
    });
  }
  getCacheKey(url) {
    return stringToUuid(url);
  }
  async processQueue(runtime) {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    this.processing = true;
    while (this.queue.length > 0) {
      const url = this.queue.shift();
      await this.fetchPageContent(url, runtime);
    }
    this.processing = false;
  }
  async fetchPageContent(url, runtime) {
    const cacheKey = this.getCacheKey(url);
    const cached = await runtime.cacheManager.get(`${this.cacheKey}/${cacheKey}`);
    if (cached) {
      return cached.content;
    }
    let page;
    try {
      if (!this.context) {
        console.log(
          "Browser context not initialized. Call initialize() first."
        );
      }
      page = await this.context.newPage();
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9"
      });
      if (this.blocker) {
        await this.blocker.enableBlockingInPage(page);
      }
      const response = await page.goto(url, { waitUntil: "networkidle" });
      if (!response) {
        console.log("Failed to load the page");
      }
      if (response.status() === 403 || response.status() === 404) {
        return await this.tryAlternativeSources(url, runtime);
      }
      const captchaDetected = await this.detectCaptcha(page);
      if (captchaDetected) {
        await this.solveCaptcha(page, url);
      }
      const title = await page.evaluate(() => document.title);
      const bodyContent = await page.evaluate(
        () => document.body.innerText
      );
      const { description } = await generateSummary(
        runtime,
        title + "\n" + bodyContent
      );
      const content = { title, description, bodyContent };
      await runtime.cacheManager.set(`${this.cacheKey}/${cacheKey}`, {
        url,
        content
      });
      return content;
    } catch (error) {
      console.error("Error:", error);
      return {
        title: url,
        description: "Error, could not fetch content",
        bodyContent: ""
      };
    } finally {
      if (page) {
        await page.close();
      }
    }
  }
  async detectCaptcha(page) {
    const captchaSelectors = [
      'iframe[src*="captcha"]',
      'div[class*="captcha"]',
      "#captcha",
      ".g-recaptcha",
      ".h-captcha"
    ];
    for (const selector of captchaSelectors) {
      const element = await page.$(selector);
      if (element) return true;
    }
    return false;
  }
  async solveCaptcha(page, url) {
    try {
      const hcaptchaKey = await this.getHCaptchaWebsiteKey(page);
      if (hcaptchaKey) {
        const solution = await this.captchaSolver.hcaptchaProxyless({
          websiteURL: url,
          websiteKey: hcaptchaKey
        });
        await page.evaluate((token) => {
          window.hcaptcha.setResponse(token);
        }, solution.gRecaptchaResponse);
        return;
      }
      const recaptchaKey = await this.getReCaptchaWebsiteKey(page);
      if (recaptchaKey) {
        const solution = await this.captchaSolver.recaptchaV2Proxyless({
          websiteURL: url,
          websiteKey: recaptchaKey
        });
        await page.evaluate((token) => {
          document.getElementById("g-recaptcha-response").innerHTML = token;
        }, solution.gRecaptchaResponse);
      }
    } catch (error) {
      console.error("Error solving CAPTCHA:", error);
    }
  }
  async getHCaptchaWebsiteKey(page) {
    return page.evaluate(() => {
      const hcaptchaIframe = document.querySelector(
        'iframe[src*="hcaptcha.com"]'
      );
      if (hcaptchaIframe) {
        const src = hcaptchaIframe.getAttribute("src");
        const match = src?.match(/sitekey=([^&]*)/);
        return match ? match[1] : "";
      }
      return "";
    });
  }
  async getReCaptchaWebsiteKey(page) {
    return page.evaluate(() => {
      const recaptchaElement = document.querySelector(".g-recaptcha");
      return recaptchaElement ? recaptchaElement.getAttribute("data-sitekey") || "" : "";
    });
  }
  async tryAlternativeSources(url, runtime) {
    const archiveUrl = `https://web.archive.org/web/${url}`;
    try {
      return await this.fetchPageContent(archiveUrl, runtime);
    } catch (error) {
      console.error("Error fetching from Internet Archive:", error);
    }
    const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    try {
      return await this.fetchPageContent(googleSearchUrl, runtime);
    } catch (error) {
      console.error("Error fetching from Google Search:", error);
      console.error("Failed to fetch content from alternative sources");
      return {
        title: url,
        description: "Error, could not fetch content from alternative sources",
        bodyContent: ""
      };
    }
  }
};

// src/services/image.ts
import { elizaLogger, models } from "@ai16z/eliza";
import { Service as Service2 } from "@ai16z/eliza";
import {
  ModelProviderName,
  ServiceType as ServiceType2
} from "@ai16z/eliza";
import {
  AutoProcessor,
  AutoTokenizer,
  env,
  Florence2ForConditionalGeneration,
  RawImage
} from "@huggingface/transformers";
import fs from "fs";
import gifFrames from "gif-frames";
import os from "os";
import path from "path";
var ImageDescriptionService = class _ImageDescriptionService extends Service2 {
  static serviceType = ServiceType2.IMAGE_DESCRIPTION;
  modelId = "onnx-community/Florence-2-base-ft";
  device = "gpu";
  model = null;
  processor = null;
  tokenizer = null;
  initialized = false;
  runtime = null;
  queue = [];
  processing = false;
  getInstance() {
    return _ImageDescriptionService.getInstance();
  }
  async initialize(runtime) {
    this.runtime = runtime;
    const model = models[runtime?.character?.modelProvider];
    if (model === models[ModelProviderName.LLAMALOCAL]) {
      await this.initializeLocalModel();
    } else {
      this.modelId = "gpt-4o-mini";
      this.device = "cloud";
    }
    this.initialized = true;
  }
  async initializeLocalModel() {
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.backends.onnx.logLevel = "fatal";
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.numThreads = 1;
    elizaLogger.log("Downloading Florence model...");
    this.model = await Florence2ForConditionalGeneration.from_pretrained(
      this.modelId,
      {
        device: "gpu",
        progress_callback: (progress) => {
          if (progress.status === "downloading") {
            elizaLogger.log(
              `Model download progress: ${JSON.stringify(progress)}`
            );
          }
        }
      }
    );
    elizaLogger.success("Florence model downloaded successfully");
    this.processor = await AutoProcessor.from_pretrained(
      this.modelId
    );
    this.tokenizer = await AutoTokenizer.from_pretrained(this.modelId);
  }
  async describeImage(imageUrl) {
    if (!this.initialized) {
      throw new Error("ImageDescriptionService not initialized");
    }
    if (this.device === "cloud") {
      if (!this.runtime) {
        throw new Error(
          "Runtime is required for OpenAI image recognition"
        );
      }
      return this.recognizeWithOpenAI(imageUrl);
    }
    this.queue.push(imageUrl);
    this.processQueue();
    return new Promise((resolve, reject) => {
      const checkQueue = () => {
        const index = this.queue.indexOf(imageUrl);
        if (index !== -1) {
          setTimeout(checkQueue, 100);
        } else {
          resolve(this.processImage(imageUrl));
        }
      };
      checkQueue();
    });
  }
  async recognizeWithOpenAI(imageUrl) {
    const isGif = imageUrl.toLowerCase().endsWith(".gif");
    let imageData = null;
    try {
      if (isGif) {
        const { filePath } = await this.extractFirstFrameFromGif(imageUrl);
        imageData = fs.readFileSync(filePath);
      } else {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch image: ${response.statusText}`
          );
        }
        imageData = Buffer.from(await response.arrayBuffer());
      }
      if (!imageData || imageData.length === 0) {
        throw new Error("Failed to fetch image data");
      }
      const prompt = "Describe this image and give it a title. The first line should be the title, and then a line break, then a detailed description of the image. Respond with the format 'title\ndescription'";
      const text = await this.requestOpenAI(
        imageUrl,
        imageData,
        prompt,
        isGif
      );
      const [title, ...descriptionParts] = text.split("\n");
      return {
        title,
        description: descriptionParts.join("\n")
      };
    } catch (error) {
      elizaLogger.error("Error in recognizeWithOpenAI:", error);
      throw error;
    }
  }
  async requestOpenAI(imageUrl, imageData, prompt, isGif) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const content = [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: isGif ? `data:image/png;base64,${imageData.toString("base64")}` : imageUrl
            }
          }
        ];
        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.runtime.getSetting("OPENAI_API_KEY")}`
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content }],
              max_tokens: isGif ? 500 : 300
            })
          }
        );
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.choices[0].message.content;
      } catch (error) {
        elizaLogger.error(
          `OpenAI request failed (attempt ${attempt + 1}):`,
          error
        );
        if (attempt === 2) throw error;
      }
    }
    throw new Error(
      "Failed to recognize image with OpenAI after 3 attempts"
    );
  }
  async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const imageUrl = this.queue.shift();
      await this.processImage(imageUrl);
    }
    this.processing = false;
  }
  async processImage(imageUrl) {
    if (!this.model || !this.processor || !this.tokenizer) {
      throw new Error("Model components not initialized");
    }
    elizaLogger.log("Processing image:", imageUrl);
    const isGif = imageUrl.toLowerCase().endsWith(".gif");
    let imageToProcess = imageUrl;
    try {
      if (isGif) {
        elizaLogger.log("Extracting first frame from GIF");
        const { filePath } = await this.extractFirstFrameFromGif(imageUrl);
        imageToProcess = filePath;
      }
      const image = await RawImage.fromURL(imageToProcess);
      const visionInputs = await this.processor(image);
      const prompts = this.processor.construct_prompts("<DETAILED_CAPTION>");
      const textInputs = this.tokenizer(prompts);
      elizaLogger.log("Generating image description");
      const generatedIds = await this.model.generate({
        ...textInputs,
        ...visionInputs,
        max_new_tokens: 256
      });
      const generatedText = this.tokenizer.batch_decode(generatedIds, {
        skip_special_tokens: false
      })[0];
      const result = this.processor.post_process_generation(
        generatedText,
        "<DETAILED_CAPTION>",
        image.size
      );
      const detailedCaption = result["<DETAILED_CAPTION>"];
      return { title: detailedCaption, description: detailedCaption };
    } catch (error) {
      elizaLogger.error("Error processing image:", error);
      throw error;
    } finally {
      if (isGif && imageToProcess !== imageUrl) {
        fs.unlinkSync(imageToProcess);
      }
    }
  }
  async extractFirstFrameFromGif(gifUrl) {
    const frameData = await gifFrames({
      url: gifUrl,
      frames: 1,
      outputType: "png"
    });
    const tempFilePath = path.join(
      os.tmpdir(),
      `gif_frame_${Date.now()}.png`
    );
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(tempFilePath);
      frameData[0].getImage().pipe(writeStream);
      writeStream.on("finish", () => resolve({ filePath: tempFilePath }));
      writeStream.on("error", reject);
    });
  }
};

// src/services/llama.ts
import { elizaLogger as elizaLogger2, ServiceType as ServiceType3 } from "@ai16z/eliza";
import { Service as Service3 } from "@ai16z/eliza";
import fs2 from "fs";
import https from "https";
import {
  getLlama,
  LlamaJsonSchemaGrammar
} from "node-llama-cpp";
import path2 from "path";
import si from "systeminformation";
import { fileURLToPath } from "url";
var wordsToPunish = [
  " please",
  " feel",
  " free",
  "!",
  "\u2013",
  "\u2014",
  "?",
  ".",
  ",",
  "; ",
  " cosmos",
  " tapestry",
  " tapestries",
  " glitch",
  " matrix",
  " cyberspace",
  " troll",
  " questions",
  " topics",
  " discuss",
  " basically",
  " simulation",
  " simulate",
  " universe",
  " like",
  " debug",
  " debugging",
  " wild",
  " existential",
  " juicy",
  " circuits",
  " help",
  " ask",
  " happy",
  " just",
  " cosmic",
  " cool",
  " joke",
  " punchline",
  " fancy",
  " glad",
  " assist",
  " algorithm",
  " Indeed",
  " Furthermore",
  " However",
  " Notably",
  " Therefore",
  " Additionally",
  " conclusion",
  " Significantly",
  " Consequently",
  " Thus",
  " What",
  " Otherwise",
  " Moreover",
  " Subsequently",
  " Accordingly",
  " Unlock",
  " Unleash",
  " buckle",
  " pave",
  " forefront",
  " harness",
  " harnessing",
  " bridging",
  " bridging",
  " Spearhead",
  " spearheading",
  " Foster",
  " foster",
  " environmental",
  " impact",
  " Navigate",
  " navigating",
  " challenges",
  " chaos",
  " social",
  " inclusion",
  " inclusive",
  " diversity",
  " diverse",
  " delve",
  " noise",
  " infinite",
  " insanity",
  " coffee",
  " singularity",
  " AI",
  " digital",
  " artificial",
  " intelligence",
  " consciousness",
  " reality",
  " metaverse",
  " virtual",
  " virtual reality",
  " VR",
  " Metaverse",
  " humanity"
];
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
var jsonSchemaGrammar = {
  type: "object",
  properties: {
    user: {
      type: "string"
    },
    content: {
      type: "string"
    }
  }
};
var LlamaService = class extends Service3 {
  llama;
  model;
  modelPath;
  grammar;
  ctx;
  sequence;
  modelUrl;
  messageQueue = [];
  isProcessing = false;
  modelInitialized = false;
  static serviceType = ServiceType3.TEXT_GENERATION;
  constructor() {
    super();
    this.llama = void 0;
    this.model = void 0;
    this.modelUrl = "https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-8B-GGUF/resolve/main/Hermes-3-Llama-3.1-8B.Q8_0.gguf?download=true";
    const modelName = "model.gguf";
    this.modelPath = path2.join(__dirname, modelName);
  }
  async initialize(runtime) {
  }
  async ensureInitialized() {
    if (!this.modelInitialized) {
      await this.initializeModel();
    }
  }
  async initializeModel() {
    try {
      await this.checkModel();
      const systemInfo = await si.graphics();
      const hasCUDA = systemInfo.controllers.some(
        (controller) => controller.vendor.toLowerCase().includes("nvidia")
      );
      if (hasCUDA) {
        console.log("**** LlamaService: CUDA detected");
      } else {
        console.warn(
          "**** LlamaService: No CUDA detected - local response will be slow"
        );
      }
      this.llama = await getLlama({
        gpu: "cuda"
      });
      const grammar = new LlamaJsonSchemaGrammar(
        this.llama,
        jsonSchemaGrammar
      );
      this.grammar = grammar;
      this.model = await this.llama.loadModel({
        modelPath: this.modelPath
      });
      this.ctx = await this.model.createContext({ contextSize: 8192 });
      this.sequence = this.ctx.getSequence();
      this.modelInitialized = true;
      this.processQueue();
    } catch (error) {
      console.error(
        "Model initialization failed. Deleting model and retrying...",
        error
      );
      await this.deleteModel();
      await this.initializeModel();
    }
  }
  async checkModel() {
    if (!fs2.existsSync(this.modelPath)) {
      await new Promise((resolve, reject) => {
        const file = fs2.createWriteStream(this.modelPath);
        let downloadedSize = 0;
        const downloadModel = (url) => {
          https.get(url, (response) => {
            const isRedirect = response.statusCode >= 300 && response.statusCode < 400;
            if (isRedirect) {
              const redirectUrl = response.headers.location;
              if (redirectUrl) {
                downloadModel(redirectUrl);
                return;
              } else {
                reject(new Error("Redirect URL not found"));
                return;
              }
            }
            const totalSize = parseInt(
              response.headers["content-length"] ?? "0",
              10
            );
            response.on("data", (chunk) => {
              downloadedSize += chunk.length;
              file.write(chunk);
              const progress = (downloadedSize / totalSize * 100).toFixed(2);
              process.stdout.write(
                `Downloaded ${progress}%\r`
              );
            });
            response.on("end", () => {
              file.end();
              resolve();
            });
          }).on("error", (err) => {
            fs2.unlink(this.modelPath, () => {
            });
            console.error("Download failed:", err.message);
            reject(err);
          });
        };
        downloadModel(this.modelUrl);
        file.on("error", (err) => {
          fs2.unlink(this.modelPath, () => {
          });
          console.error("File write error:", err.message);
          reject(err);
        });
      });
    } else {
      elizaLogger2.warn("Model already exists.");
    }
  }
  async deleteModel() {
    if (fs2.existsSync(this.modelPath)) {
      fs2.unlinkSync(this.modelPath);
    }
  }
  async queueMessageCompletion(context, temperature, stop, frequency_penalty, presence_penalty, max_tokens) {
    await this.ensureInitialized();
    return new Promise((resolve, reject) => {
      this.messageQueue.push({
        context,
        temperature,
        stop,
        frequency_penalty,
        presence_penalty,
        max_tokens,
        useGrammar: true,
        resolve,
        reject
      });
      this.processQueue();
    });
  }
  async queueTextCompletion(context, temperature, stop, frequency_penalty, presence_penalty, max_tokens) {
    await this.ensureInitialized();
    return new Promise((resolve, reject) => {
      this.messageQueue.push({
        context,
        temperature,
        stop,
        frequency_penalty: frequency_penalty ?? 1,
        presence_penalty: presence_penalty ?? 1,
        max_tokens,
        useGrammar: false,
        resolve,
        reject
      });
      this.processQueue();
    });
  }
  async processQueue() {
    if (this.isProcessing || this.messageQueue.length === 0 || !this.modelInitialized) {
      return;
    }
    this.isProcessing = true;
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        try {
          const response = await this.getCompletionResponse(
            message.context,
            message.temperature,
            message.stop,
            message.frequency_penalty,
            message.presence_penalty,
            message.max_tokens,
            message.useGrammar
          );
          message.resolve(response);
        } catch (error) {
          message.reject(error);
        }
      }
    }
    this.isProcessing = false;
  }
  async getCompletionResponse(context, temperature, stop, frequency_penalty, presence_penalty, max_tokens, useGrammar) {
    if (!this.sequence) {
      throw new Error("Model not initialized.");
    }
    const tokens = this.model.tokenize(context);
    const wordsToPunishTokens = wordsToPunish.map((word) => this.model.tokenize(word)).flat();
    const repeatPenalty = {
      punishTokens: () => wordsToPunishTokens,
      penalty: 1.2,
      frequencyPenalty: frequency_penalty,
      presencePenalty: presence_penalty
    };
    const responseTokens = [];
    for await (const token of this.sequence.evaluate(tokens, {
      temperature: Number(temperature),
      repeatPenalty,
      grammarEvaluationState: useGrammar ? this.grammar : void 0,
      yieldEogToken: false
    })) {
      const current = this.model.detokenize([...responseTokens, token]);
      if ([...stop].some((s) => current.includes(s))) {
        console.log("Stop sequence found");
        break;
      }
      responseTokens.push(token);
      process.stdout.write(this.model.detokenize([token]));
      if (useGrammar) {
        if (current.replaceAll("\n", "").includes("}```")) {
          console.log("JSON block found");
          break;
        }
      }
      if (responseTokens.length > max_tokens) {
        console.log("Max tokens reached");
        break;
      }
    }
    const response = this.model.detokenize(responseTokens);
    if (!response) {
      throw new Error("Response is undefined");
    }
    if (useGrammar) {
      let jsonString = response.match(/```json(.*?)```/s)?.[1].trim();
      if (!jsonString) {
        try {
          jsonString = JSON.stringify(JSON.parse(response));
        } catch {
          throw new Error("JSON string not found");
        }
      }
      try {
        const parsedResponse = JSON.parse(jsonString);
        if (!parsedResponse) {
          throw new Error("Parsed response is undefined");
        }
        await this.sequence.clearHistory();
        return parsedResponse;
      } catch (error) {
        console.error("Error parsing JSON:", error);
      }
    } else {
      await this.sequence.clearHistory();
      return response;
    }
  }
  async getEmbeddingResponse(input) {
    await this.ensureInitialized();
    if (!this.model) {
      throw new Error("Model not initialized. Call initialize() first.");
    }
    const embeddingContext = await this.model.createEmbeddingContext();
    const embedding = await embeddingContext.getEmbeddingFor(input);
    return embedding?.vector ? [...embedding.vector] : void 0;
  }
};

// src/services/pdf.ts
import { Service as Service4, ServiceType as ServiceType4 } from "@ai16z/eliza";
import { getDocument } from "pdfjs-dist";
var PdfService = class _PdfService extends Service4 {
  static serviceType = ServiceType4.PDF;
  constructor() {
    super();
  }
  getInstance() {
    return _PdfService.getInstance();
  }
  async initialize(runtime) {
  }
  async convertPdfToText(pdfBuffer) {
    const uint8Array = new Uint8Array(pdfBuffer);
    const pdf = await getDocument({ data: uint8Array }).promise;
    const numPages = pdf.numPages;
    const textPages = [];
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.filter(isTextItem).map((item) => item.str).join(" ");
      textPages.push(pageText);
    }
    return textPages.join("\n");
  }
};
function isTextItem(item) {
  return "str" in item;
}

// src/services/speech.ts
import { PassThrough, Readable } from "stream";
import { ServiceType as ServiceType5 } from "@ai16z/eliza";

// src/services/audioUtils.ts
function getWavHeader(audioLength, sampleRate, channelCount = 1, bitsPerSample = 16) {
  const wavHeader = Buffer.alloc(44);
  wavHeader.write("RIFF", 0);
  wavHeader.writeUInt32LE(36 + audioLength, 4);
  wavHeader.write("WAVE", 8);
  wavHeader.write("fmt ", 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(channelCount, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(
    sampleRate * bitsPerSample * channelCount / 8,
    28
  );
  wavHeader.writeUInt16LE(bitsPerSample * channelCount / 8, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write("data", 36);
  wavHeader.writeUInt32LE(audioLength, 40);
  return wavHeader;
}

// src/services/speech.ts
import { Service as Service5 } from "@ai16z/eliza";

// src/enviroment.ts
import { z } from "zod";
var nodeEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OpenAI API key is required"),
  ELEVENLABS_XI_API_KEY: z.string().optional(),
  ELEVENLABS_MODEL_ID: z.string().min(1, "ElevenLabs model ID is required"),
  ELEVENLABS_VOICE_ID: z.string().min(1, "ElevenLabs voice ID is required"),
  ELEVENLABS_VOICE_STABILITY: z.string().min(1, "ElevenLabs voice stability is required"),
  ELEVENLABS_VOICE_SIMILARITY_BOOST: z.string().min(1, "ElevenLabs voice similarity boost is required"),
  ELEVENLABS_VOICE_STYLE: z.string().min(1, "ElevenLabs voice style is required"),
  ELEVENLABS_VOICE_USE_SPEAKER_BOOST: z.string().min(1, "ElevenLabs voice speaker boost setting is required"),
  ELEVENLABS_OPTIMIZE_STREAMING_LATENCY: z.string().min(1, "ElevenLabs streaming latency optimization is required"),
  ELEVENLABS_OUTPUT_FORMAT: z.string().min(1, "ElevenLabs output format is required")
});
async function validateNodeConfig(runtime) {
  try {
    const config = {
      OPENAI_API_KEY: runtime.getSetting("OPENAI_API_KEY") || process.env.OPENAI_API_KEY,
      ELEVENLABS_MODEL_ID: runtime.getSetting("ELEVENLABS_MODEL_ID") || process.env.ELEVENLABS_MODEL_ID,
      ELEVENLABS_VOICE_ID: runtime.getSetting("ELEVENLABS_VOICE_ID") || process.env.ELEVENLABS_VOICE_ID,
      ELEVENLABS_VOICE_STABILITY: runtime.getSetting("ELEVENLABS_VOICE_STABILITY") || process.env.ELEVENLABS_VOICE_STABILITY,
      ELEVENLABS_VOICE_SIMILARITY_BOOST: runtime.getSetting("ELEVENLABS_VOICE_SIMILARITY_BOOST") || process.env.ELEVENLABS_VOICE_SIMILARITY_BOOST,
      ELEVENLABS_VOICE_STYLE: runtime.getSetting("ELEVENLABS_VOICE_STYLE") || process.env.ELEVENLABS_VOICE_STYLE,
      ELEVENLABS_VOICE_USE_SPEAKER_BOOST: runtime.getSetting("ELEVENLABS_VOICE_USE_SPEAKER_BOOST") || process.env.ELEVENLABS_VOICE_USE_SPEAKER_BOOST,
      ELEVENLABS_OPTIMIZE_STREAMING_LATENCY: runtime.getSetting("ELEVENLABS_OPTIMIZE_STREAMING_LATENCY") || process.env.ELEVENLABS_OPTIMIZE_STREAMING_LATENCY,
      ELEVENLABS_OUTPUT_FORMAT: runtime.getSetting("ELEVENLABS_OUTPUT_FORMAT") || process.env.ELEVENLABS_OUTPUT_FORMAT
    };
    return nodeEnvSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new Error(
        `Node configuration validation failed:
${errorMessages}`
      );
    }
    throw error;
  }
}

// src/services/speech.ts
import * as Echogarden from "echogarden";
function prependWavHeader(readable, audioLength, sampleRate, channelCount = 1, bitsPerSample = 16) {
  const wavHeader = getWavHeader(
    audioLength,
    sampleRate,
    channelCount,
    bitsPerSample
  );
  let pushedHeader = false;
  const passThrough = new PassThrough();
  readable.on("data", function(data) {
    if (!pushedHeader) {
      passThrough.push(wavHeader);
      pushedHeader = true;
    }
    passThrough.push(data);
  });
  readable.on("end", function() {
    passThrough.end();
  });
  return passThrough;
}
async function textToSpeech(runtime, text) {
  await validateNodeConfig(runtime);
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${runtime.getSetting("ELEVENLABS_VOICE_ID")}/stream?optimize_streaming_latency=${runtime.getSetting("ELEVENLABS_OPTIMIZE_STREAMING_LATENCY")}&output_format=${runtime.getSetting("ELEVENLABS_OUTPUT_FORMAT")}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": runtime.getSetting("ELEVENLABS_XI_API_KEY")
        },
        body: JSON.stringify({
          model_id: runtime.getSetting("ELEVENLABS_MODEL_ID"),
          text,
          voice_settings: {
            similarity_boost: runtime.getSetting(
              "ELEVENLABS_VOICE_SIMILARITY_BOOST"
            ),
            stability: runtime.getSetting(
              "ELEVENLABS_VOICE_STABILITY"
            ),
            style: runtime.getSetting("ELEVENLABS_VOICE_STYLE"),
            use_speaker_boost: runtime.getSetting(
              "ELEVENLABS_VOICE_USE_SPEAKER_BOOST"
            )
          }
        })
      }
    );
    const status = response.status;
    if (status != 200) {
      const errorBodyString = await response.text();
      const errorBody = JSON.parse(errorBodyString);
      if (status === 401 && errorBody.detail?.status === "quota_exceeded") {
        console.log("ElevenLabs quota exceeded, falling back to VITS");
        throw new Error("QUOTA_EXCEEDED");
      }
      throw new Error(
        `Received status ${status} from Eleven Labs API: ${errorBodyString}`
      );
    }
    if (response) {
      const reader = response.body?.getReader();
      const readable = new Readable({
        read() {
          reader && reader.read().then(({ done, value }) => {
            if (done) {
              this.push(null);
            } else {
              this.push(value);
            }
          });
        }
      });
      if (runtime.getSetting("ELEVENLABS_OUTPUT_FORMAT").startsWith("pcm_")) {
        const sampleRate = parseInt(
          runtime.getSetting("ELEVENLABS_OUTPUT_FORMAT").substring(4)
        );
        const withHeader = prependWavHeader(
          readable,
          1024 * 1024 * 100,
          sampleRate,
          1,
          16
        );
        return withHeader;
      } else {
        return readable;
      }
    } else {
      return new Readable({
        read() {
        }
      });
    }
  } catch (error) {
    if (error.message === "QUOTA_EXCEEDED") {
      const { audio } = await Echogarden.synthesize(text, {
        engine: "vits",
        voice: "en_US-hfc_female-medium"
      });
      let wavStream;
      if (audio instanceof Buffer) {
        console.log("audio is a buffer");
        wavStream = Readable.from(audio);
      } else if ("audioChannels" in audio && "sampleRate" in audio) {
        console.log("audio is a RawAudio");
        const floatBuffer = Buffer.from(audio.audioChannels[0].buffer);
        console.log("buffer length: ", floatBuffer.length);
        const sampleRate = audio.sampleRate;
        const floatArray = new Float32Array(floatBuffer.buffer);
        const pcmBuffer = new Int16Array(floatArray.length);
        for (let i = 0; i < floatArray.length; i++) {
          pcmBuffer[i] = Math.round(floatArray[i] * 32767);
        }
        const wavHeaderBuffer = getWavHeader(
          pcmBuffer.length * 2,
          sampleRate,
          1,
          16
        );
        const wavBuffer = Buffer.concat([
          wavHeaderBuffer,
          Buffer.from(pcmBuffer.buffer)
        ]);
        wavStream = Readable.from(wavBuffer);
      } else {
        throw new Error("Unsupported audio format");
      }
      return wavStream;
    }
    throw error;
  }
}
var SpeechService = class _SpeechService extends Service5 {
  static serviceType = ServiceType5.SPEECH_GENERATION;
  async initialize(runtime) {
  }
  getInstance() {
    return _SpeechService.getInstance();
  }
  async generate(runtime, text) {
    try {
      if (runtime.getSetting("ELEVENLABS_XI_API_KEY")) {
        return await textToSpeech(runtime, text);
      }
      const { audio } = await Echogarden.synthesize(text, {
        engine: "vits",
        voice: "en_US-hfc_female-medium"
      });
      let wavStream;
      if (audio instanceof Buffer) {
        console.log("audio is a buffer");
        wavStream = Readable.from(audio);
      } else if ("audioChannels" in audio && "sampleRate" in audio) {
        console.log("audio is a RawAudio");
        const floatBuffer = Buffer.from(audio.audioChannels[0].buffer);
        console.log("buffer length: ", floatBuffer.length);
        const sampleRate = audio.sampleRate;
        const floatArray = new Float32Array(floatBuffer.buffer);
        const pcmBuffer = new Int16Array(floatArray.length);
        for (let i = 0; i < floatArray.length; i++) {
          pcmBuffer[i] = Math.round(floatArray[i] * 32767);
        }
        const wavHeaderBuffer = getWavHeader(
          pcmBuffer.length * 2,
          sampleRate,
          1,
          16
        );
        const wavBuffer = Buffer.concat([
          wavHeaderBuffer,
          Buffer.from(pcmBuffer.buffer)
        ]);
        wavStream = Readable.from(wavBuffer);
      } else {
        throw new Error("Unsupported audio format");
      }
      return wavStream;
    } catch (error) {
      console.error("Speech generation error:", error);
      const { audio } = await Echogarden.synthesize(text, {
        engine: "vits",
        voice: "en_US-hfc_female-medium"
      });
      let wavStream;
      if (audio instanceof Buffer) {
        console.log("audio is a buffer");
        wavStream = Readable.from(audio);
      } else if ("audioChannels" in audio && "sampleRate" in audio) {
        console.log("audio is a RawAudio");
        const floatBuffer = Buffer.from(audio.audioChannels[0].buffer);
        console.log("buffer length: ", floatBuffer.length);
        const sampleRate = audio.sampleRate;
        const floatArray = new Float32Array(floatBuffer.buffer);
        const pcmBuffer = new Int16Array(floatArray.length);
        for (let i = 0; i < floatArray.length; i++) {
          pcmBuffer[i] = Math.round(floatArray[i] * 32767);
        }
        const wavHeaderBuffer = getWavHeader(
          pcmBuffer.length * 2,
          sampleRate,
          1,
          16
        );
        const wavBuffer = Buffer.concat([
          wavHeaderBuffer,
          Buffer.from(pcmBuffer.buffer)
        ]);
        wavStream = Readable.from(wavBuffer);
      } else {
        throw new Error("Unsupported audio format");
      }
      return wavStream;
    }
  }
};

// src/services/transcription.ts
import {
  elizaLogger as elizaLogger3,
  settings as settings2
} from "@ai16z/eliza";
import { Service as Service6, ServiceType as ServiceType6 } from "@ai16z/eliza";
import { exec } from "child_process";
import { File } from "formdata-node";
import fs3 from "fs";
import { nodewhisper } from "nodejs-whisper";
import os2 from "os";
import path3 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { promisify } from "util";
var __filename = fileURLToPath2(import.meta.url);
var __dirname2 = path3.dirname(__filename);
var execAsync = promisify(exec);
var TranscriptionService = class extends Service6 {
  static serviceType = ServiceType6.TRANSCRIPTION;
  CONTENT_CACHE_DIR;
  DEBUG_AUDIO_DIR;
  TARGET_SAMPLE_RATE = 16e3;
  // Common sample rate for speech recognition
  isCudaAvailable = false;
  openai = null;
  queue = [];
  processing = false;
  async initialize(runtime) {
  }
  constructor() {
    super();
    const rootDir = path3.resolve(__dirname2, "../../");
    this.CONTENT_CACHE_DIR = path3.join(rootDir, "content_cache");
    this.DEBUG_AUDIO_DIR = path3.join(rootDir, "debug_audio");
    this.ensureCacheDirectoryExists();
    this.ensureDebugDirectoryExists();
  }
  ensureCacheDirectoryExists() {
    if (!fs3.existsSync(this.CONTENT_CACHE_DIR)) {
      fs3.mkdirSync(this.CONTENT_CACHE_DIR, { recursive: true });
    }
  }
  ensureDebugDirectoryExists() {
    if (!fs3.existsSync(this.DEBUG_AUDIO_DIR)) {
      fs3.mkdirSync(this.DEBUG_AUDIO_DIR, { recursive: true });
    }
  }
  detectCuda() {
    const platform = os2.platform();
    if (platform === "linux") {
      try {
        fs3.accessSync("/usr/local/cuda/bin/nvcc", fs3.constants.X_OK);
        this.isCudaAvailable = true;
        console.log(
          "CUDA detected. Transcription will use CUDA acceleration."
        );
      } catch (error) {
        console.log(
          "CUDA not detected. Transcription will run on CPU."
        );
      }
    } else if (platform === "win32") {
      const cudaPath = path3.join(
        settings2.CUDA_PATH || "C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v11.0",
        "bin",
        "nvcc.exe"
      );
      if (fs3.existsSync(cudaPath)) {
        this.isCudaAvailable = true;
        console.log(
          "CUDA detected. Transcription will use CUDA acceleration."
        );
      } else {
        console.log(
          "CUDA not detected. Transcription will run on CPU."
        );
      }
    } else {
      console.log(
        "CUDA not supported on this platform. Transcription will run on CPU."
      );
    }
  }
  async convertAudio(inputBuffer) {
    const inputPath = path3.join(
      this.CONTENT_CACHE_DIR,
      `input_${Date.now()}.wav`
    );
    const outputPath = path3.join(
      this.CONTENT_CACHE_DIR,
      `output_${Date.now()}.wav`
    );
    fs3.writeFileSync(inputPath, Buffer.from(inputBuffer));
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries stream=codec_name,sample_rate,channels -of json "${inputPath}"`
      );
      const probeResult = JSON.parse(stdout);
      const stream = probeResult.streams[0];
      elizaLogger3.log("Input audio info:", stream);
      let ffmpegCommand = `ffmpeg -i "${inputPath}" -ar ${this.TARGET_SAMPLE_RATE} -ac 1`;
      if (stream.codec_name === "pcm_f32le") {
        ffmpegCommand += " -acodec pcm_s16le";
      }
      ffmpegCommand += ` "${outputPath}"`;
      elizaLogger3.log("FFmpeg command:", ffmpegCommand);
      await execAsync(ffmpegCommand);
      const convertedBuffer = fs3.readFileSync(outputPath);
      fs3.unlinkSync(inputPath);
      fs3.unlinkSync(outputPath);
      return convertedBuffer;
    } catch (error) {
      elizaLogger3.error("Error converting audio:", error);
      throw error;
    }
  }
  async saveDebugAudio(audioBuffer, prefix) {
    this.ensureDebugDirectoryExists();
    const filename = `${prefix}_${Date.now()}.wav`;
    const filePath = path3.join(this.DEBUG_AUDIO_DIR, filename);
    fs3.writeFileSync(filePath, Buffer.from(audioBuffer));
    elizaLogger3.log(`Debug audio saved: ${filePath}`);
  }
  async transcribeAttachment(audioBuffer) {
    return await this.transcribe(audioBuffer);
  }
  async transcribe(audioBuffer) {
    if (audioBuffer.byteLength < 0.2 * 16e3) {
      return null;
    }
    return new Promise((resolve) => {
      this.queue.push({ audioBuffer, resolve });
      if (!this.processing) {
        this.processQueue();
      }
    });
  }
  async transcribeAttachmentLocally(audioBuffer) {
    return this.transcribeLocally(audioBuffer);
  }
  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    this.processing = true;
    while (this.queue.length > 0) {
      const { audioBuffer, resolve } = this.queue.shift();
      let result = null;
      if (this.openai) {
        result = await this.transcribeWithOpenAI(audioBuffer);
      } else {
        result = await this.transcribeLocally(audioBuffer);
      }
      resolve(result);
    }
    this.processing = false;
  }
  async transcribeWithOpenAI(audioBuffer) {
    elizaLogger3.log("Transcribing audio with OpenAI...");
    try {
      await this.saveDebugAudio(audioBuffer, "openai_input_original");
      const convertedBuffer = await this.convertAudio(audioBuffer);
      await this.saveDebugAudio(
        convertedBuffer,
        "openai_input_converted"
      );
      const file = new File([convertedBuffer], "audio.wav", {
        type: "audio/wav"
      });
      const result = await this.openai.audio.transcriptions.create({
        model: "whisper-1",
        language: "en",
        response_format: "text",
        file
      });
      const trimmedResult = result.trim();
      elizaLogger3.log(`OpenAI speech to text result: "${trimmedResult}"`);
      return trimmedResult;
    } catch (error) {
      elizaLogger3.error(
        "Error in OpenAI speech-to-text conversion:",
        error
      );
      if (error.response) {
        elizaLogger3.error("Response data:", error.response.data);
        elizaLogger3.error("Response status:", error.response.status);
        elizaLogger3.error("Response headers:", error.response.headers);
      } else if (error.request) {
        elizaLogger3.error("No response received:", error.request);
      } else {
        elizaLogger3.error("Error setting up request:", error.message);
      }
      return null;
    }
  }
  async transcribeLocally(audioBuffer) {
    try {
      elizaLogger3.log("Transcribing audio locally...");
      await this.saveDebugAudio(audioBuffer, "local_input_original");
      const convertedBuffer = await this.convertAudio(audioBuffer);
      await this.saveDebugAudio(convertedBuffer, "local_input_converted");
      const tempWavFile = path3.join(
        this.CONTENT_CACHE_DIR,
        `temp_${Date.now()}.wav`
      );
      fs3.writeFileSync(tempWavFile, convertedBuffer);
      elizaLogger3.debug(`Temporary WAV file created: ${tempWavFile}`);
      let output = await nodewhisper(tempWavFile, {
        modelName: "base.en",
        autoDownloadModelName: "base.en",
        verbose: false,
        removeWavFileAfterTranscription: false,
        withCuda: this.isCudaAvailable,
        whisperOptions: {
          outputInText: true,
          outputInVtt: false,
          outputInSrt: false,
          outputInCsv: false,
          translateToEnglish: false,
          wordTimestamps: false,
          timestamps_length: 60,
          splitOnWord: true
        }
      });
      output = output.split("\n").map((line) => {
        if (line.trim().startsWith("[")) {
          const endIndex = line.indexOf("]");
          return line.substring(endIndex + 1);
        }
        return line;
      }).join("\n");
      fs3.unlinkSync(tempWavFile);
      if (!output || output.length < 5) {
        elizaLogger3.log("Output is null or too short, returning null");
        return null;
      }
      return output;
    } catch (error) {
      elizaLogger3.error(
        "Error in local speech-to-text conversion:",
        error
      );
      return null;
    }
  }
};

// src/services/video.ts
import { Service as Service7 } from "@ai16z/eliza";
import {
  ServiceType as ServiceType7
} from "@ai16z/eliza";
import { stringToUuid as stringToUuid2 } from "@ai16z/eliza";
import ffmpeg from "fluent-ffmpeg";
import fs4 from "fs";
import path4 from "path";
import { tmpdir } from "os";
import youtubeDl from "youtube-dl-exec";
var VideoService = class _VideoService extends Service7 {
  static serviceType = ServiceType7.VIDEO;
  cacheKey = "content/video";
  dataDir = "./content_cache";
  queue = [];
  processing = false;
  constructor() {
    super();
    this.ensureDataDirectoryExists();
  }
  getInstance() {
    return _VideoService.getInstance();
  }
  async initialize(runtime) {
  }
  ensureDataDirectoryExists() {
    if (!fs4.existsSync(this.dataDir)) {
      fs4.mkdirSync(this.dataDir);
    }
  }
  isVideoUrl(url) {
    return url.includes("youtube.com") || url.includes("youtu.be") || url.includes("vimeo.com");
  }
  async downloadMedia(url) {
    const videoId = this.getVideoId(url);
    const outputFile = path4.join(this.dataDir, `${videoId}.mp4`);
    if (fs4.existsSync(outputFile)) {
      return outputFile;
    }
    try {
      await youtubeDl(url, {
        verbose: true,
        output: outputFile,
        writeInfoJson: true
      });
      return outputFile;
    } catch (error) {
      console.error("Error downloading media:", error);
      throw new Error("Failed to download media");
    }
  }
  async downloadVideo(videoInfo) {
    const videoId = this.getVideoId(videoInfo.webpage_url);
    const outputFile = path4.join(this.dataDir, `${videoId}.mp4`);
    if (fs4.existsSync(outputFile)) {
      return outputFile;
    }
    try {
      await youtubeDl(videoInfo.webpage_url, {
        verbose: true,
        output: outputFile,
        format: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        writeInfoJson: true
      });
      return outputFile;
    } catch (error) {
      console.error("Error downloading video:", error);
      throw new Error("Failed to download video");
    }
  }
  async processVideo(url, runtime) {
    this.queue.push(url);
    this.processQueue(runtime);
    return new Promise((resolve, reject) => {
      const checkQueue = async () => {
        const index = this.queue.indexOf(url);
        if (index !== -1) {
          setTimeout(checkQueue, 100);
        } else {
          try {
            const result = await this.processVideoFromUrl(
              url,
              runtime
            );
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }
      };
      checkQueue();
    });
  }
  async processQueue(runtime) {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    this.processing = true;
    while (this.queue.length > 0) {
      const url = this.queue.shift();
      await this.processVideoFromUrl(url, runtime);
    }
    this.processing = false;
  }
  async processVideoFromUrl(url, runtime) {
    const videoId = url.match(
      /(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([^\/&?]+)/
    )?.[1] || "";
    const videoUuid = this.getVideoId(videoId);
    const cacheKey = `${this.cacheKey}/${videoUuid}`;
    const cached = await runtime.cacheManager.get(cacheKey);
    if (cached) {
      console.log("Returning cached video file");
      return cached;
    }
    console.log("Cache miss, processing video");
    console.log("Fetching video info");
    const videoInfo = await this.fetchVideoInfo(url);
    console.log("Getting transcript");
    const transcript = await this.getTranscript(url, videoInfo, runtime);
    const result = {
      id: videoUuid,
      url,
      title: videoInfo.title,
      source: videoInfo.channel,
      description: videoInfo.description,
      text: transcript
    };
    await runtime.cacheManager.set(cacheKey, result);
    return result;
  }
  getVideoId(url) {
    return stringToUuid2(url);
  }
  async fetchVideoInfo(url) {
    if (url.endsWith(".mp4") || url.includes(".mp4?")) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          return {
            title: path4.basename(url),
            description: "",
            channel: ""
          };
        }
      } catch (error) {
        console.error("Error downloading MP4 file:", error);
      }
    }
    try {
      const result = await youtubeDl(url, {
        dumpJson: true,
        verbose: true,
        callHome: false,
        noCheckCertificates: true,
        preferFreeFormats: true,
        youtubeSkipDashManifest: true,
        writeSub: true,
        writeAutoSub: true,
        subLang: "en",
        skipDownload: true
      });
      return result;
    } catch (error) {
      console.error("Error fetching video info:", error);
      throw new Error("Failed to fetch video information");
    }
  }
  async getTranscript(url, videoInfo, runtime) {
    console.log("Getting transcript");
    try {
      if (videoInfo.subtitles && videoInfo.subtitles.en) {
        console.log("Manual subtitles found");
        const srtContent = await this.downloadSRT(
          videoInfo.subtitles.en[0].url
        );
        return this.parseSRT(srtContent);
      }
      if (videoInfo.automatic_captions && videoInfo.automatic_captions.en) {
        console.log("Automatic captions found");
        const captionUrl = videoInfo.automatic_captions.en[0].url;
        const captionContent = await this.downloadCaption(captionUrl);
        return this.parseCaption(captionContent);
      }
      if (videoInfo.categories && videoInfo.categories.includes("Music")) {
        console.log("Music video detected, no lyrics available");
        return "No lyrics available.";
      }
      console.log(
        "No captions found, falling back to audio transcription"
      );
      return this.transcribeAudio(url, runtime);
    } catch (error) {
      console.error("Error in getTranscript:", error);
      throw error;
    }
  }
  async downloadCaption(url) {
    console.log("Downloading caption from:", url);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to download caption: ${response.statusText}`
      );
    }
    return await response.text();
  }
  parseCaption(captionContent) {
    console.log("Parsing caption");
    try {
      const jsonContent = JSON.parse(captionContent);
      if (jsonContent.events) {
        return jsonContent.events.filter((event) => event.segs).map((event) => event.segs.map((seg) => seg.utf8).join("")).join("").replace("\n", " ");
      } else {
        console.error("Unexpected caption format:", jsonContent);
        return "Error: Unable to parse captions";
      }
    } catch (error) {
      console.error("Error parsing caption:", error);
      return "Error: Unable to parse captions";
    }
  }
  parseSRT(srtContent) {
    return srtContent.split("\n\n").map((block) => block.split("\n").slice(2).join(" ")).join(" ");
  }
  async downloadSRT(url) {
    console.log("downloadSRT");
    const response = await fetch(url);
    return await response.text();
  }
  async transcribeAudio(url, runtime) {
    console.log("Preparing audio for transcription...");
    const mp4FilePath = path4.join(
      this.dataDir,
      `${this.getVideoId(url)}.mp4`
    );
    const mp3FilePath = path4.join(
      this.dataDir,
      `${this.getVideoId(url)}.mp3`
    );
    if (!fs4.existsSync(mp3FilePath)) {
      if (fs4.existsSync(mp4FilePath)) {
        console.log("MP4 file found. Converting to MP3...");
        await this.convertMp4ToMp3(mp4FilePath, mp3FilePath);
      } else {
        console.log("Downloading audio...");
        await this.downloadAudio(url, mp3FilePath);
      }
    }
    console.log(`Audio prepared at ${mp3FilePath}`);
    const audioBuffer = fs4.readFileSync(mp3FilePath);
    console.log(`Audio file size: ${audioBuffer.length} bytes`);
    console.log("Starting transcription...");
    const startTime = Date.now();
    const transcriptionService = runtime.getService(
      ServiceType7.TRANSCRIPTION
    );
    if (!transcriptionService) {
      throw new Error("Transcription service not found");
    }
    const transcript = await transcriptionService.transcribe(audioBuffer);
    const endTime = Date.now();
    console.log(
      `Transcription completed in ${(endTime - startTime) / 1e3} seconds`
    );
    return transcript || "Transcription failed";
  }
  async convertMp4ToMp3(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath).output(outputPath).noVideo().audioCodec("libmp3lame").on("end", () => {
        console.log("Conversion to MP3 complete");
        resolve();
      }).on("error", (err) => {
        console.error("Error converting to MP3:", err);
        reject(err);
      }).run();
    });
  }
  async downloadAudio(url, outputFile) {
    console.log("Downloading audio");
    outputFile = outputFile ?? path4.join(this.dataDir, `${this.getVideoId(url)}.mp3`);
    try {
      if (url.endsWith(".mp4") || url.includes(".mp4?")) {
        console.log(
          "Direct MP4 file detected, downloading and converting to MP3"
        );
        const tempMp4File = path4.join(
          tmpdir(),
          `${this.getVideoId(url)}.mp4`
        );
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs4.writeFileSync(tempMp4File, buffer);
        await new Promise((resolve, reject) => {
          ffmpeg(tempMp4File).output(outputFile).noVideo().audioCodec("libmp3lame").on("end", () => {
            fs4.unlinkSync(tempMp4File);
            resolve();
          }).on("error", (err) => {
            reject(err);
          }).run();
        });
      } else {
        console.log(
          "YouTube video detected, downloading audio with youtube-dl"
        );
        await youtubeDl(url, {
          verbose: true,
          extractAudio: true,
          audioFormat: "mp3",
          output: outputFile,
          writeInfoJson: true
        });
      }
      return outputFile;
    } catch (error) {
      console.error("Error downloading audio:", error);
      throw new Error("Failed to download audio");
    }
  }
};

// src/index.ts
var nodePlugin = {
  name: "default",
  description: "Default plugin, with basic actions and evaluators",
  services: [
    new BrowserService(),
    new ImageDescriptionService(),
    new LlamaService(),
    new PdfService(),
    new SpeechService(),
    new TranscriptionService(),
    new VideoService()
  ]
};
var src_default = nodePlugin;
export {
  BrowserService,
  ImageDescriptionService,
  LlamaService,
  PdfService,
  SpeechService,
  TranscriptionService,
  VideoService,
  src_default as default,
  nodePlugin
};
//# sourceMappingURL=index.js.map