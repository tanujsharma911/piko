import { getSwiggyInstaMartTools } from "./swiggy/instamart/tools.js";

const ALLOWED_INSTAMART_TOOLS = [
  "get_addresses",
  "create_address",
  "delete_address",
  "search_products",
  "your_go_to_items",
  "get_cart",
  "update_cart",
  "clear_cart",
  "apply_coupon",
  "list_coupons",
  "get_payment_options",
  "check_payment_status",
  "get_orders",
  "get_order_details",
  "track_order",
  "get_delivery_status",
  "report_error",
  "checkout",
  "confirm_order",
];

export class Tool {
  public getTools = async ({
    isSwiggyConnected,
    swiggyAccessToken,
  }: {
    isSwiggyConnected: boolean;
    swiggyAccessToken: string;
  }) => {
    const allTools = [];

    const swiggyTools = isSwiggyConnected
      ? (await getSwiggyInstaMartTools(swiggyAccessToken)).filter((t: any) =>
          this.isToolAllowed(t.name),
        )
      : [];

    allTools.push(...swiggyTools);

    const toolsByName = new Map(swiggyTools.map((t) => [t.name, t]));

    const geminiTools = this.buildGeminiTools(allTools);

    return { toolsByName, geminiTools };
  };

  private isToolAllowed = (name: string): boolean => {
    if (name.startsWith("swiggy-instamart__")) {
      return ALLOWED_INSTAMART_TOOLS.includes(
        name.slice("swiggy-instamart__".length),
      );
    }
    return false;
  };

  private buildGeminiTools = (tools: any[]) => {
    if (tools.length === 0) return undefined;
    return [
      {
        function_declarations: tools.map((tool) => ({
          name: tool.name,
          description: tool.description || "",
          parameters: this.toGeminiSchema(tool.schema),
        })),
      },
    ];
  };

  private toGeminiSchema = (schema: any): any => {
    if (!schema || typeof schema !== "object") return schema;

    const out: any = {};

    if (schema.type) {
      out.type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    }

    if (schema.description) {
      out.description = schema.description;
    }

    if (schema.enum) {
      out.enum = schema.enum.map((v: any) => String(v));
    }

    if (schema.properties) {
      out.properties = {};
      for (const key of Object.keys(schema.properties)) {
        const prop = schema.properties[key];
        if (prop.value && typeof prop.value === "object") {
          out.properties[key] = this.toGeminiSchema(prop.value);
        } else {
          out.properties[key] = this.toGeminiSchema(prop);
        }
      }
    }

    if (schema.items) {
      if (schema.items.value && typeof schema.items.value === "object") {
        out.items = this.toGeminiSchema(schema.items.value);
      } else {
        out.items = this.toGeminiSchema(schema.items);
      }
    }

    return out;
  };
}