import { IAgentRuntime } from "@ai16z/eliza";
import { z } from "zod";

export const githubEnvSchema = z.object({
    TELEGRAM_BOT_TOKEN: z.string().min(1, "Telegram bot token is rquired"),
    TELEGRAM_CHANNEL_ID: z.string().min(1, "Telegram channel id is required"),
});

export type GithubConfig = z.infer<typeof githubEnvSchema>;

export async function validateGithubConfig(
    runtime: IAgentRuntime
): Promise<GithubConfig> {
    try {
        const config = {
            TELEGRAM_BOT_TOKEN: runtime.getSetting("TELEGRAM_BOT_TOKEN"),
            TELEGRAM_CHANNEL_ID: runtime.getSetting("TELEGRAM_CHANNEL_ID"),
        };

        return githubEnvSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join(".")}: ${err.message}`)
                .join("\n");
            throw new Error(
                `GitHub configuration validation failed:\n${errorMessages}`
            );
        }
        throw error;
    }
}
