import { MultiServerMCPClient } from "@langchain/mcp-adapters";

export async function getSwiggyDineOutTools(token: string) {
  const mcpClient = new MultiServerMCPClient({
    mcpServers: {
      "swiggy-dineout": {
        url: "https://mcp.swiggy.com/dineout",
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
