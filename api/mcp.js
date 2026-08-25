import { handleMcpHttp } from "./lib/mcp-http.js";

export default async function handler(req, res) {
  await handleMcpHttp(req, res);
}
