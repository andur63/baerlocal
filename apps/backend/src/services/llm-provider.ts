import crypto from "crypto";
import type {
	EmbeddingModelV4Result,
	LanguageModelV4FinishReason,
	LanguageModelV4GenerateResult,
	LanguageModelV4StreamPart,
	LanguageModelV4StreamResult,
	LanguageModelV4Usage,
} from "@ai-sdk/provider";
import type { EmbeddingModel, LanguageModel } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { mistral } from "@ai-sdk/mistral";
import { config } from "../config";
import { mockEmbeddingModel, mockLanguageModel } from "./external-mocks";

const ReadableStreamCtor = (
	globalThis as unknown as {
		ReadableStream: new <T>(underlyingSource: {
			start(controller: {
				enqueue(chunk: T): void;
				close(): void;
				error(err: unknown): void;
			}): void | Promise<void>;
		}) => ReadableStream<T>;
	}
).ReadableStream;

/**
 * Central factories for the LLM and Embedding models.
 * - In `test` mode (`NODE_ENV === "test"`), returns static mocks.
 * - When `LOCAL_LLM_ENABLED === "true"`, connects to an OpenAI-compatible local
 *   server such as LM Studio (`LLM_BASE_URL`, default `http://localhost:1234/v1`).
 * - Otherwise, uses the official Mistral provider.
 */

const isTestMode = config.nodeEnv === "test";

interface OpenAiChatResponse {
	choices?: Array<{
		message?: {
			content?: string | null;
			reasoning_content?: string | null;
			tool_calls?: Array<{
				id?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
}

interface OpenAiStreamChunk {
	choices?: Array<{
		delta?: {
			content?: string | null;
			reasoning_content?: string | null;
			reasoning?: string | null;
			tool_calls?: Array<{
				index?: number;
				id?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
	};
}

function getBaseUrl(): string {
	return (config.llmBaseUrl || "http://localhost:1234/v1").replace(/\/+$/, "");
}

async function resolveLmStudioModelId(
	requestedModel: string,
	preferEmbedding: boolean = false,
): Promise<string> {
	const baseUrl = getBaseUrl();
	try {
		const res = await fetch(`${baseUrl}/models`, {
			headers: {
				Authorization: `Bearer ${config.mistralApiKey || "lm-studio"}`,
			},
			signal: AbortSignal.timeout(3_000),
		});
		if (res.ok) {
			const data = (await res.json()) as {
				data?: Array<{ id: string }>;
			};
			const models = data.data ?? [];
			if (models.length > 0) {
				const exact = models.find((m) => m.id === requestedModel);
				if (exact) {
					return exact.id;
				}
				if (preferEmbedding) {
					const embedModel = models.find((m) => /embed/i.test(m.id));
					if (embedModel) {
						return embedModel.id;
					}
				} else {
					const chatModel =
						models.find((m) => !/embed/i.test(m.id)) ?? models[0];
					return chatModel.id;
				}
			}
		}
	} catch {
		// Fall back to requestedModel if /models is unreachable
	}
	return requestedModel;
}

function toOpenAiMessages(prompt: unknown[]): Array<Record<string, unknown>> {
	const result: Array<Record<string, unknown>> = [];
	for (const msg of prompt as Array<Record<string, unknown>>) {
		const role = String(msg.role ?? "user");
		const content = msg.content;
		if (typeof content === "string") {
			result.push({ role, content });
			continue;
		}
		if (!Array.isArray(content)) {
			result.push({ role, content: String(content ?? "") });
			continue;
		}
		if (role === "tool") {
			for (const part of content as Array<Record<string, unknown>>) {
				const rawOutput = part.output ?? part.result ?? "";
				let serializedOutput = "";
				if (typeof rawOutput === "string") {
					serializedOutput = rawOutput;
				} else if (
					typeof rawOutput === "object" &&
					rawOutput !== null &&
					"value" in rawOutput
				) {
					const val = (rawOutput as { value: unknown }).value;
					serializedOutput =
						typeof val === "string" ? val : JSON.stringify(val);
				} else {
					serializedOutput = JSON.stringify(rawOutput);
				}
				result.push({
					role: "tool",
					tool_call_id: String(part.toolCallId ?? "call_0"),
					content: serializedOutput,
				});
			}
			continue;
		}
		const textParts: string[] = [];
		const toolCalls: Array<Record<string, unknown>> = [];
		for (const part of content as Array<Record<string, unknown>>) {
			if (part.type === "text" && typeof part.text === "string") {
				textParts.push(part.text);
			} else if (part.type === "tool-call") {
				toolCalls.push({
					id: String(part.toolCallId ?? `call_${toolCalls.length}`),
					type: "function",
					function: {
						name: String(part.toolName ?? ""),
						arguments:
							typeof part.input === "string"
								? part.input
								: JSON.stringify(part.input ?? {}),
					},
				});
			}
		}
		const entry: Record<string, unknown> = {
			role,
			content: textParts.join("\n") || (toolCalls.length > 0 ? null : ""),
		};
		if (toolCalls.length > 0) {
			entry.tool_calls = toolCalls;
		}
		result.push(entry);
	}
	return result;
}

function buildOpenAiTools(
	tools: unknown[] | undefined,
): Array<Record<string, unknown>> | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}
	const mapped: Array<Record<string, unknown>> = [];
	for (const t of tools as Array<Record<string, unknown>>) {
		if (t.type === "function" && typeof t.name === "string") {
			mapped.push({
				type: "function",
				function: {
					name: t.name,
					description:
						typeof t.description === "string" ? t.description : undefined,
					parameters: t.inputSchema ?? { type: "object", properties: {} },
				},
			});
		}
	}
	return mapped.length > 0 ? mapped : undefined;
}

function toUsage(
	promptTokens: number = 1,
	completionTokens: number = 1,
): LanguageModelV4Usage {
	return {
		inputTokens: {
			total: promptTokens,
			noCache: promptTokens,
			cacheRead: 0,
			cacheWrite: 0,
		},
		outputTokens: {
			total: completionTokens,
			text: completionTokens,
			reasoning: 0,
		},
	};
}

function mapFinishReason(
	raw: string | null | undefined,
	hasToolCalls: boolean = false,
): LanguageModelV4FinishReason {
	if (hasToolCalls || raw === "tool_calls") {
		return { unified: "tool-calls", raw: raw ?? "tool_calls" };
	}
	if (raw === "length") {
		return { unified: "length", raw };
	}
	return { unified: "stop", raw: raw ?? "stop" };
}

function createLocalLanguageModel(identifier: string): LanguageModel {
	return new MockLanguageModelV4({
		doGenerate: async (options): Promise<LanguageModelV4GenerateResult> => {
			const baseUrl = getBaseUrl();
			const modelId = await resolveLmStudioModelId(identifier, false);
			const messages = toOpenAiMessages(options.prompt);
			const openAiTools = buildOpenAiTools(options.tools);

			if (options.responseFormat?.type === "json") {
				messages.unshift({
					role: "system",
					content:
						"Antworte ausschließlich mit einem validen JSON-Objekt ohne Markdown-Codeblöcke.",
				});
			}

			const body: Record<string, unknown> = {
				model: modelId,
				messages,
				temperature: options.temperature ?? config.modelTemperature ?? 0.3,
				stream: false,
			};
			if (options.maxOutputTokens) {
				body.max_tokens = options.maxOutputTokens;
			}
			if (openAiTools && options.toolChoice?.type !== "none") {
				body.tools = openAiTools;
				body.tool_choice = "auto";
			}

			const res = await fetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${config.mistralApiKey || "lm-studio"}`,
				},
				body: JSON.stringify(body),
				signal: options.abortSignal,
			});

			if (!res.ok) {
				const errText = await res.text();
				throw new Error(
					`LM Studio request failed (${res.status}): ${errText}`,
				);
			}

			const data = (await res.json()) as OpenAiChatResponse;
			const choice = data.choices?.[0];
			const rawText = choice?.message?.content ?? "";
			const toolCalls = choice?.message?.tool_calls ?? [];

			const content: LanguageModelV4GenerateResult["content"] = [];
			if (rawText) {
				let cleanedText = rawText;
				if (options.responseFormat?.type === "json") {
					const match = rawText.match(
						/```(?:json)?\s*(\{[\s\S]*?\})\s*```|(\{[\s\S]*\})/,
					);
					cleanedText = match ? match[1] || match[2] : '{"citations":[]}';
				}
				content.push({ type: "text", text: cleanedText });
			}

			for (const tc of toolCalls) {
				content.push({
					type: "tool-call",
					toolCallId: tc.id || `call_${crypto.randomUUID().slice(0, 8)}`,
					toolName: tc.function?.name || "",
					input: tc.function?.arguments || "{}",
				});
			}

			if (content.length === 0) {
				content.push({
					type: "text",
					text:
						options.responseFormat?.type === "json"
							? '{"citations":[]}'
							: "",
				});
			}

			return {
				content,
				finishReason: mapFinishReason(
					choice?.finish_reason,
					toolCalls.length > 0,
				),
				usage: toUsage(
					data.usage?.prompt_tokens ?? 1,
					data.usage?.completion_tokens ?? 1,
				),
				warnings: [],
			};
		},

		doStream: async (options): Promise<LanguageModelV4StreamResult> => {
			const baseUrl = getBaseUrl();
			const modelId = await resolveLmStudioModelId(identifier, false);
			const messages = toOpenAiMessages(options.prompt);
			const openAiTools = buildOpenAiTools(options.tools);

			const body: Record<string, unknown> = {
				model: modelId,
				messages,
				temperature: options.temperature ?? config.modelTemperature ?? 0.3,
				stream: true,
			};
			if (options.maxOutputTokens) {
				body.max_tokens = options.maxOutputTokens;
			}
			if (openAiTools && options.toolChoice?.type !== "none") {
				body.tools = openAiTools;
				body.tool_choice = "auto";
			}

			const res = await fetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${config.mistralApiKey || "lm-studio"}`,
				},
				body: JSON.stringify(body),
				signal: options.abortSignal,
			});

			if (!res.ok || !res.body) {
				const errText = await res.text().catch(() => "");
				throw new Error(
					`LM Studio stream failed (${res.status}): ${errText}`,
				);
			}

			const upstreamReader = res.body.getReader();
			const decoder = new TextDecoder();

			const stream = new ReadableStreamCtor<LanguageModelV4StreamPart>({
				async start(controller) {
					controller.enqueue({ type: "stream-start", warnings: [] });

					let buffer = "";
					let textStarted = false;
					let reasoningStarted = false;
					let finishReasonRaw: string | null = null;
					let promptTokens = 1;
					let completionTokens = 1;

					const pendingTools = new Map<
						number,
						{ id: string; name: string; args: string; started: boolean }
					>();

					try {
						while (true) {
							const { done, value } = await upstreamReader.read();
							if (done) {
								break;
							}

							buffer += decoder.decode(value, { stream: true });
							const lines = buffer.split("\n");
							buffer = lines.pop() ?? "";

							for (const rawLine of lines) {
								const line = rawLine.trim();
								if (!line.startsWith("data:")) {
									continue;
								}
								const payload = line.slice(5).trim();
								if (!payload || payload === "[DONE]") {
									continue;
								}

								let chunk: OpenAiStreamChunk;
								try {
									chunk = JSON.parse(payload) as OpenAiStreamChunk;
								} catch {
									continue;
								}

								if (chunk.usage) {
									promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
									completionTokens =
										chunk.usage.completion_tokens ?? completionTokens;
								}

								const choice = chunk.choices?.[0];
								if (!choice) {
									continue;
								}
								if (choice.finish_reason) {
									finishReasonRaw = choice.finish_reason;
								}

								const delta = choice.delta;
								if (!delta) {
									continue;
								}

								const reasoningDelta =
									delta.reasoning_content ?? delta.reasoning ?? null;
								if (reasoningDelta) {
									if (!reasoningStarted) {
										reasoningStarted = true;
										controller.enqueue({ type: "reasoning-start", id: "r0" });
									}
									controller.enqueue({
										type: "reasoning-delta",
										id: "r0",
										delta: reasoningDelta,
									});
								}

								if (delta.content) {
									if (reasoningStarted) {
										reasoningStarted = false;
										controller.enqueue({ type: "reasoning-end", id: "r0" });
									}
									if (!textStarted) {
										textStarted = true;
										controller.enqueue({ type: "text-start", id: "0" });
									}
									controller.enqueue({
										type: "text-delta",
										id: "0",
										delta: delta.content,
									});
								}

								if (delta.tool_calls) {
									for (const tc of delta.tool_calls) {
										const idx = tc.index ?? 0;
										let entry = pendingTools.get(idx);
										if (!entry) {
											entry = {
												id:
													tc.id ||
													`call_${crypto.randomUUID().slice(0, 8)}`,
												name: tc.function?.name || "",
												args: "",
												started: false,
											};
											pendingTools.set(idx, entry);
										}
										if (tc.id) {
											entry.id = tc.id;
										}
										if (tc.function?.name) {
											entry.name = tc.function.name;
										}
										if (!entry.started && entry.name) {
											entry.started = true;
											controller.enqueue({
												type: "tool-input-start",
												id: entry.id,
												toolName: entry.name,
											});
										}
										if (tc.function?.arguments) {
											entry.args += tc.function.arguments;
											if (entry.started) {
												controller.enqueue({
													type: "tool-input-delta",
													id: entry.id,
													delta: tc.function.arguments,
												});
											}
										}
									}
								}
							}
						}

						if (reasoningStarted) {
							controller.enqueue({ type: "reasoning-end", id: "r0" });
						}
						if (textStarted) {
							controller.enqueue({ type: "text-end", id: "0" });
						}

						for (const entry of pendingTools.values()) {
							if (entry.started) {
								controller.enqueue({
									type: "tool-input-end",
									id: entry.id,
								});
							}
							if (entry.name) {
								controller.enqueue({
									type: "tool-call",
									toolCallId: entry.id,
									toolName: entry.name,
									input: entry.args || "{}",
								});
							}
						}

						controller.enqueue({
							type: "finish",
							finishReason: mapFinishReason(
								finishReasonRaw,
								pendingTools.size > 0,
							),
							usage: toUsage(promptTokens, completionTokens),
						});
						controller.close();
					} catch (err) {
						controller.error(err);
					}
				},
			});

			return { stream };
		},
	});
}

function deterministicLocalEmbedding(
	text: string,
	dimensions: number,
): number[] {
	const vec = new Array<number>(dimensions).fill(0);
	const normalized = text.toLowerCase().trim();
	if (!normalized) {
		return vec;
	}
	const tokens = normalized.split(/\s+/);
	for (const token of tokens) {
		const digest = crypto.createHash("sha256").update(token).digest();
		for (let i = 0; i < 8; i++) {
			const idx = digest.readUInt16BE(i * 2) % dimensions;
			const sign = (digest[16 + i] & 1) === 0 ? 1 : -1;
			vec[idx] += sign;
		}
	}
	let norm = 0;
	for (const v of vec) {
		norm += v * v;
	}
	norm = Math.sqrt(norm) || 1;
	return vec.map((v) => v / norm);
}

function normalizeVectorDimensions(
	rawVector: number[],
	targetDimensions: number,
): number[] {
	if (rawVector.length === targetDimensions) {
		return rawVector;
	}
	const out = new Array<number>(targetDimensions).fill(0);
	for (let i = 0; i < rawVector.length; i++) {
		out[i % targetDimensions] += rawVector[i];
	}
	let norm = 0;
	for (const v of out) {
		norm += v * v;
	}
	norm = Math.sqrt(norm) || 1;
	return out.map((v) => v / norm);
}

function createLocalEmbeddingModel(): EmbeddingModel {
	const targetDimensions = config.mistralEmbeddingDimensions || 1024;
	return new MockEmbeddingModelV4({
		doEmbed: async ({ values }): Promise<EmbeddingModelV4Result> => {
			const baseUrl = getBaseUrl();
			try {
				const modelId = await resolveLmStudioModelId(
					config.mistralEmbeddingModel,
					true,
				);
				const res = await fetch(`${baseUrl}/embeddings`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${config.mistralApiKey || "lm-studio"}`,
					},
					body: JSON.stringify({
						model: modelId,
						input: values,
					}),
					signal: AbortSignal.timeout(15_000),
				});
				if (res.ok) {
					const data = (await res.json()) as {
						data?: Array<{ embedding: number[] }>;
						usage?: { total_tokens?: number };
					};
					if (data.data && data.data.length === values.length) {
						return {
							embeddings: data.data.map((d) =>
								normalizeVectorDimensions(d.embedding, targetDimensions),
							),
							usage: { tokens: data.usage?.total_tokens ?? values.length },
							warnings: [],
						};
					}
				}
			} catch {
				// Fall back to deterministic local embedding if no embedding model is loaded in LM Studio
			}

			return {
				embeddings: values.map((v) =>
					deterministicLocalEmbedding(String(v), targetDimensions),
				),
				usage: { tokens: values.length },
				warnings: [],
			};
		},
	});
}

export function getLanguageModel(identifier: string): LanguageModel {
	if (isTestMode) {
		return mockLanguageModel();
	}
	if (config.localLlmEnabled) {
		return createLocalLanguageModel(identifier);
	}

	return mistral(identifier);
}

export function getEmbeddingModel(): EmbeddingModel {
	if (isTestMode) {
		return mockEmbeddingModel();
	}
	if (config.localLlmEnabled) {
		return createLocalEmbeddingModel();
	}

	return mistral.embeddingModel(config.mistralEmbeddingModel);
}
