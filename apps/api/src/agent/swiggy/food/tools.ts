import { MultiServerMCPClient } from "@langchain/mcp-adapters";

export async function getSwiggyFoodTools(token: string) {
  const mcpClient = new MultiServerMCPClient({
    mcpServers: {
      "swiggy-food": {
        url: "https://mcp.swiggy.com/food",
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
