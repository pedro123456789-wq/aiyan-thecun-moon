import { Plugin } from '@ai16z/eliza';

declare function saveBase64Image(base64Data: string, filename: string): string;
declare function saveHeuristImage(imageUrl: string, filename: string): Promise<string>;
declare const imageGenerationPlugin: Plugin;

export { imageGenerationPlugin, saveBase64Image, saveHeuristImage };
