import {
	ChatPromptClient,
	LangfuseClient,
	TextPromptClient,
} from "@langfuse/client";
import type { ChatMessage } from "@langfuse/core";
import { config } from "../config";
import { mockChatPrompt, mockTextPrompt } from "./external-mocks";

/**
 * Central access point for Langfuse prompts.
 * - In `test` mode (`NODE_ENV === "test"`), returns static test mocks.
 * - When `LOCAL_LLM_ENABLED === "true"`, returns built-in German BärGPT prompt
 *   templates locally without requiring a Langfuse Cloud connection.
 * - Otherwise, delegates to the real Langfuse client.
 */

const isTestMode = config.nodeEnv === "test";

const langfuse =
	isTestMode || config.localLlmEnabled ? null : new LangfuseClient();

type BasePromptOptions = {
	label?: string;
	version?: number;
	cacheTtlSeconds?: number;
	maxRetries?: number;
};

const LOCAL_TEXT_PROMPTS: Record<string, string> = {
	"free-chat-basic": [
		"Du bist BärGPT, der hilfreiche und verlässliche KI-Assistent für die Berliner Verwaltung.",
		"Heutiges Datum: {{currentDate}}",
		"Anredeform: {{addressForm}} die nutzende Person konsequent.",
		"Antworte präzise, strukturiert, freundlich und auf Deutsch.",
		"{{toolInstructions}}",
		"{{userSystemPrompt}}",
	].join("\n\n"),
	"tool-instruction-documents":
		"Dir steht das Tool `ragSearchTool` zur Verfügung, um in den ausgewählten Dokumenten zu suchen. Nutze es, wenn Fragen Bezug auf hochgeladene oder ausgewählte Dokumente nehmen.",
	"tool-instruction-web-search":
		"Dir steht das Tool `webSearchTool` für aktuelle Web-Recherchen zur Verfügung.",
	"tool-instruction-parla":
		"Dir steht das Tool `parla_vector_search` für parlamentarische Drucksachen und Dokumente aus PARLA Berlin zur Verfügung.",
	"tool-instruction-open-data":
		"Dir stehen die Berliner Open-Data-Tools zur Verfügung, um Datensätze des Berliner Datenportals zu durchsuchen und auszuwerten.",
	"tool-instruction-datawrapper":
		"Dir stehen Datawrapper-Tools zur Verfügung, um Diagramme und Karten zu erstellen.",
	"tool-instruction-external-context":
		"Hinweis: Da ein externes Tool aktiv ist, enthält der Gesprächsverlauf nur Nachrichten aus dem Kontext externer Tools.",
};

const LOCAL_CHAT_PROMPTS: Record<string, ChatMessage[]> = {
	summary: [
		{
			type: "chatmessage",
			role: "system",
			content:
				"Du bist BärGPT. Erstelle eine strukturierte, präzise deutsche Zusammenfassung des übergebenen Dokuments.",
		},
		{
			type: "chatmessage",
			role: "user",
			content: "Fasse folgendes Dokument zusammen:\n\n{{docContent}}",
		},
	],
	"one-sentence-summary": [
		{
			type: "chatmessage",
			role: "system",
			content:
				"Du bist BärGPT. Fasse das übergebene Dokument in einem einzigen prägnanten deutschen Satz zusammen.",
		},
		{
			type: "chatmessage",
			role: "user",
			content: "{{docContent}}",
		},
	],
	tagging: [
		{
			type: "chatmessage",
			role: "system",
			content:
				'Extrahiere 3 bis 5 prägnante deutsche Schlagwörter (Tags) für den Text. Antworte ausschließlich mit validem JSON im Format {"tags": ["Tag1", "Tag2"]}.',
		},
		{
			type: "chatmessage",
			role: "user",
			content: "{{docContent}}",
		},
	],
	"document-citation-extraction": [
		{
			type: "chatmessage",
			role: "system",
			content:
				'Prüfe, welche der folgenden Quellen-Snippets für die generierte Antwort verwendet wurden. Antworte ausschließlich mit validem JSON im Format {"citations": [<IDs als Zahlen>]}.',
		},
		{
			type: "chatmessage",
			role: "user",
			content:
				"Generierte Antwort:\n{{generatedAnswer}}\n\nVerfügbare Quellen:\n{{availableSources}}",
		},
	],
	"web-citation-extraction": [
		{
			type: "chatmessage",
			role: "system",
			content:
				'Prüfe, welche der folgenden Web-Quellen für die generierte Antwort verwendet wurden. Antworte ausschließlich mit validem JSON im Format {"citations": [{"url": "..."}]}.',
		},
		{
			type: "chatmessage",
			role: "user",
			content:
				"Generierte Antwort:\n{{generatedText}}\n\nVerfügbare Quellen:\n{{availableSources}}",
		},
	],
	"open-data-citation-extraction": [
		{
			type: "chatmessage",
			role: "system",
			content:
				'Prüfe, welche der folgenden Open-Data-Quellen für die generierte Antwort verwendet wurden. Antworte ausschließlich mit validem JSON im Format {"citations": [{"url": "..."}]}.',
		},
		{
			type: "chatmessage",
			role: "user",
			content:
				"Generierte Antwort:\n{{generatedText}}\n\nVerfügbare Quellen:\n{{availableSources}}",
		},
	],
};

function createLocalTextPrompt(name: string): TextPromptClient {
	return new TextPromptClient(
		{
			name,
			version: 1,
			labels: ["local"],
			tags: ["local"],
			type: "text",
			prompt: LOCAL_TEXT_PROMPTS[name] ?? "Du bist BärGPT.",
		},
		true,
	);
}

function createLocalChatPrompt(name: string): ChatPromptClient {
	return new ChatPromptClient(
		{
			name,
			version: 1,
			labels: ["local"],
			tags: ["local"],
			type: "chat",
			prompt: LOCAL_CHAT_PROMPTS[name] ?? [
				{
					type: "chatmessage",
					role: "system",
					content: "Du bist BärGPT.",
				},
			],
		},
		true,
	);
}

/**
 * Fetches a "text" Langfuse prompt: a single template string.
 * `compile()` returns that string with its variables filled in.
 */
export async function getTextPrompt(
	name: string,
	options?: BasePromptOptions & { fallback?: string },
) {
	if (isTestMode) {
		return mockTextPrompt(name);
	}
	if (config.localLlmEnabled || !langfuse) {
		return createLocalTextPrompt(name);
	}

	return langfuse.prompt.get(name, { ...options, type: "text" });
}

/**
 * Fetches a "chat" Langfuse prompt. "Chat" refers to the prompt format —
 * an array of role-tagged messages (system + user) — not an end-user
 * conversation. We use it for self-contained, one-shot backend inferences
 * like summaries or tagging because it improves instruction-following.
 */
export async function getChatPrompt(
	name: string,
	options?: BasePromptOptions & { fallback?: ChatMessage[] },
) {
	if (isTestMode) {
		return mockChatPrompt(name);
	}
	if (config.localLlmEnabled || !langfuse) {
		return createLocalChatPrompt(name);
	}

	return langfuse.prompt.get(name, { ...options, type: "chat" });
}
