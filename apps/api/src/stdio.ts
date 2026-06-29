import { bootstrapApi } from "./bootstrap";

bootstrapApi();

await import("@swarm/api-server/stdio");
