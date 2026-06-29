import "@swarm/ai-llm/register-bedrock";
import { bootstrapApi } from "./bootstrap";

bootstrapApi();

await import("@swarm/api-server/http");
