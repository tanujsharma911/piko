import { MultiServerMCPClient } from "@langchain/mcp-adapters";

export async function getSwiggyInstaMartTools(token: string) {
  const mcpClient = new MultiServerMCPClient({
    mcpServers: {
      "swiggy-instamart": {
        url: "https://mcp.swiggy.com/im",
        transport: "http",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
    prefixToolNameWithServerName: true,
  });
  return mcpClient.getTools();
}
