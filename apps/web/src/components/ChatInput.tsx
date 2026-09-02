import {
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowUpIcon, Loader2Icon, ChevronDown } from "lucide-react";
import { useState, useEffect } from "react";
import { Textarea } from "./ui/textarea";
import { useSSE, type AuditEvent, type PaymentOrder } from "@/hooks/useSSE";
import { useQueryClient } from "@tanstack/react-query";

const MODELS = [
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
];

const ChatInput = ({
  conversationId,
  onAction,
  onToken,
  onDone,
  onError,
  onPayment,
  onUserMessage,
  onRegisterSend,
}: {
  conversationId: string | undefined;
  onAction?: (event: AuditEvent) => void;
  onToken?: (text: string) => void;
  onDone?: (data: any) => void;
  onError?: (event: AuditEvent) => void;
  onPayment?: (order: PaymentOrder) => void;
  onUserMessage?: (message: any) => void;
  onRegisterSend?: (send: (content: string) => void) => void;
}) => {
  const queryClient = useQueryClient();
  const [nextMessage, setNextMessage] = useState<string>("");
  const [model, setModel] = useState<string>("gemini-3.5-flash-lite");
  const [isLoading, setIsLoading] = useState(false);
  const { sendMessage } = useSSE();

  const handleSend = async (contentOverride?: string) => {
    const content = (contentOverride ?? nextMessage).trim();
    if (!conversationId || !content || isLoading) return;

    setIsLoading(true);
    if (contentOverride === undefined) setNextMessage("");

    onUserMessage?.({
      _id: `temp-${Date.now()}`,
      role: "user",
      content,
    });

    try {
      onAction?.({ message: "Sending...", status: "pending" });
      await sendMessage(
        conversationId,
        content,
        {
          onAction: (event) => onAction?.(event),
          onToken: (text) => onToken?.(text),
          onPayment: (order) => onPayment?.(order),
          onDone: (data) => {
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            onDone?.(data);
          },
          onError: (event) => onError?.(event),
        },
        model,
      );
    } catch (err: any) {
      onError?.({
        message: err.message || "Failed to send message",
        status: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    onRegisterSend?.(async (content: string) => handleSend(content));
  });

  return (
    <div className="bg-white dark:bg-white rounded-2xl flex flex-col">
      <div className="max-h-48 overflow-y-auto w-full p-2">
        <Textarea
          autoFocus
          rows={1}
          placeholder="Ask Piko anything..."
          value={nextMessage}
          onChange={(e) => setNextMessage(e.target.value)}
          className="border-0 bg-white dark:bg-white ring-0 focus-visible:border-0 focus-visible:ring-0 field-sizing-content resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
      </div>
      <InputGroupAddon align="block-end" className="pt-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <InputGroupButton
                aria-label="Select model"
                type="button"
                variant="ghost"
              >
                {model}
                <ChevronDown />
              </InputGroupButton>
            }
          />
          <DropdownMenuContent align="start" side="top" className="w-44">
            <p className="text-muted-foreground text-xs p-2">Select model</p>
            {MODELS.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => setModel(m.id)}
                className={m.id === model ? "bg-muted/50" : ""}
              >
                {m.label}
                {m.id === model && <span className="ml-auto">✓</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <InputGroupButton
          type="submit"
          variant="default"
          size="icon-sm"
          disabled={!nextMessage || isLoading}
          className="ml-auto"
          onClick={() => handleSend()}
        >
          {isLoading ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <ArrowUpIcon />
          )}
          <span className="sr-only">Send</span>
        </InputGroupButton>
      </InputGroupAddon>
    </div>
  );
};

export default ChatInput;
