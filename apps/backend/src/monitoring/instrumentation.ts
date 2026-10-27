import { NodeSDK } from "@opentelemetry/sdk-node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { registerTelemetry } from "ai";
import * as Sentry from "@sentry/node";
import { SentryPropagator, SentrySampler } from "@sentry/opentelemetry";
import { config } from "../config";

export const sentryClient = Sentry.init({
	dsn: config.sentryDsn || "",
	environment: config.nodeEnv || "development",
	tracesSampleRate: 1.0,
	enabled:
		!config.localLlmEnabled &&
		["production", "staging"].includes(config.nodeEnv),
	skipOpenTelemetrySetup: true,
});

export const langfuseSpanProcessor = config.localLlmEnabled
	? undefined
	: new LangfuseSpanProcessor({
			environment: config.nodeEnv,
		});

const sdk = new NodeSDK({
	spanProcessors: langfuseSpanProcessor ? [langfuseSpanProcessor] : [],
	sampler: sentryClient ? new SentrySampler(sentryClient) : undefined,
	contextManager: new Sentry.SentryContextManager(),
	textMapPropagator: new SentryPropagator(),
	instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()],
});

sdk.start();
Sentry.validateOpenTelemetrySetup();
if (!config.localLlmEnabled) {
	registerTelemetry(new LangfuseVercelAiSdkIntegration());
}

if (config.nodeEnv === "development") {
	process.on("SIGTERM", () => process.exit(0));
}
