import { config } from "../config";
import { LLMHandler } from "../types/common";
import { getLanguageModel } from "./llm-provider";

type modelIdentifiers = "fast" | "precise" | "experimental";

export class ModelService {
	contextSizes: Record<modelIdentifiers, number> = {
		fast: 256_000,
		precise: 256_000,
		experimental: 1_000_000,
	};

	handlers: Record<string, LLMHandler> = {
		fast: new LLMHandler(
			"fast",
			getLanguageModel(config.fastModelIdentifier),
			config.llmBaseUrl,
		),
		precise: new LLMHandler(
			"precise",
			getLanguageModel(config.preciseModelIdentifier),
			config.llmBaseUrl,
		),
		...(config.featureFlagExperimentalModelAllowed
			? {
					experimental: new LLMHandler(
						"experimental",
						getLanguageModel(config.experimentalModelIdentifier),
						config.llmBaseUrl,
					),
				}
			: {}),
	};

	resolveLlmHandler(llmType: string): LLMHandler {
		if (!(llmType in this.handlers)) {
			throw new Error(`LLM type ${llmType} is not supported.`);
		}

		return this.handlers[llmType];
	}
}
