import {
  memo,
  useState,
  useEffect,
  useRef,
  useCallback,
  type MutableRefObject,
} from "react";
import { useParams } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { PackageIcon, XIcon } from "lucide-react";
import Markdown from "@/components/Markdown";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";

import { backendApi } from "@/services/api.service";
import ChatInput from "@/components/ChatInput";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import AuditTrail, { type AuditEntry } from "@/components/AuditTrail";
import PaymentModal, { type PaymentOrder } from "@/components/PaymentModal";
import CheckoutCard, { type PendingCheckout } from "@/components/CheckoutCard";
import OrderCard from "@/components/OrderTracking/OrderCard";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ConversationOrder } from "@/types/orderTracking";
import type { AuditEvent } from "@/hooks/useSSE";

const normalizeAudit = (events?: any[]): AuditEntry[] =>
  (events || []).map((e) => ({
    ...e,
    status: e.status === "pending" ? "done" : e.status || "done",
  }));

const CONFIRM_ORDER_MESSAGE =
  "I have completed the payment. Please confirm and place my order.";
const authorizeAndPlaceMessage = (paymentMethod: string) =>
  `I authorize this Instamart checkout for ${paymentMethod}. Place my order now.`;

const MemoizedMessageItem = memo(({ message }: { message: any }) => {
  return (
    <MessageScrollerItem messageId={message._id}>
      <Message align={message.role === "user" ? "end" : "start"}>
        <MessageContent>
          {message.role !== "user" && message.auditTrail?.length > 1 && (
            <div className="mb-1.5 w-full max-w-full">
              <AuditTrail entries={message.auditTrail} />
            </div>
          )}
          {message.role === "user" || message.content ? (
            <Bubble variant={message.role !== "user" ? "ghost" : "muted"}>
              <BubbleContent>
                <Markdown>{message.content}</Markdown>
              </BubbleContent>
            </Bubble>
          ) : null}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
});

type ScrollApi = Pick<ReturnType<typeof useMessageScroller>, "scrollToEnd">;

const ScrollApiBridge = ({
  conversationId,
  messageCount,
  apiRef,
}: {
  conversationId?: string;
  messageCount: number;
  apiRef: MutableRefObject<ScrollApi | null>;
}) => {
  const { scrollToEnd } = useMessageScroller();
  const prevConvRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    apiRef.current = { scrollToEnd };
    return () => {
      apiRef.current = null;
    };
  }, [scrollToEnd, apiRef]);

  useEffect(() => {
    if (messageCount === 0) return;
    if (prevConvRef.current !== conversationId) {
      scrollToEnd({ behavior: "auto" });
    }
    prevConvRef.current = conversationId;
  }, [conversationId, messageCount, scrollToEnd]);

  return null;
};

const Chat = () => {
  const { conversationId } = useParams<{ conversationId: string }>();

  const [messages, setMessages] = useState<any[]>([]);
  const [currentAudit, setCurrentAudit] = useState<AuditEntry[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState<PaymentOrder | null>(null);
  const [pendingCheckout, setPendingCheckout] =
    useState<PendingCheckout | null>(null);
  const [conversationOrders, setConversationOrders] = useState<
    ConversationOrder[]
  >([]);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const isMobile = useIsMobile();
  const scrollApiRef = useRef<ScrollApi | null>(null);
  const currentAuditRef = useRef<AuditEntry[]>([]);
  const sendMessageRef = useRef<((content: string) => void) | undefined>(
    undefined,
  );

  const resetStreaming = () => {
    currentAuditRef.current = [];
    setCurrentAudit([]);
    setStreamingText("");
    setIsStreaming(false);
  };

  const updateAudit = (updater: (prev: AuditEntry[]) => AuditEntry[]) => {
    setCurrentAudit((prev) => {
      const next = updater(prev);
      currentAuditRef.current = next;
      return next;
    });
  };

  const markLastDone = (prev: AuditEntry[]) => {
    if (prev.length === 0) return prev;
    const last = prev[prev.length - 1];
    if (last.status !== "pending") return prev;
    return [...prev.slice(0, -1), { ...last, status: "done" as const }];
  };

  const loadConversationOrders = useCallback(async (cid: string) => {
    try {
      const res = await backendApi.getConversationOrders(cid);
      setConversationOrders(Array.isArray(res.orders) ? res.orders : []);
    } catch (err) {
      console.error("Failed to fetch conversation orders", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMessages([]);
    resetStreaming();
    setPendingCheckout(null);
    setConversationOrders([]);
    setOrdersOpen(false);
    setCheckoutError(null);
    if (!conversationId) return;
    backendApi
      .getMessages(conversationId)
      .then((res) => {
        setMessages(
          (res.messages || []).map((m: any) => ({
            ...m,
            auditTrail: normalizeAudit(m.auditEvents),
          })),
        );
      })
      .catch((err) => {
        console.error("Failed to fetch messages", err);
      });
    loadConversationOrders(conversationId);
  }, [conversationId, loadConversationOrders]);

  const handleUserMessage = (message: any) => {
    resetStreaming();
    setMessages((prev) => [...prev, message]);
    setIsStreaming(true);
    requestAnimationFrame(() => {
      scrollApiRef.current?.scrollToEnd({ behavior: "smooth" });
    });
  };

  const handleAction = (event: AuditEvent) => {
    setIsStreaming(true);
    if (event.kind === "CHECKOUT_AUTHORIZATION_REQUESTED" && event.data?.cart) {
      setPendingCheckout(event.data.cart as PendingCheckout);
      setCheckoutError(null);
    }
    updateAudit((prev) => [
      ...markLastDone(prev),
      {
        message: event.message,
        toolName: event.toolName,
        status: event.status || "pending",
      },
    ]);
  };

  const handleToken = (text: string) => {
    setIsStreaming(true);
    updateAudit(markLastDone);
    setStreamingText((prev) => prev + text);
  };

  const handleDone = (data: any) => {
    setIsStreaming(false);
    setStreamingText("");

    if (data?.messages) {
      const withAudit = data.messages.map((m: any) => ({
        ...m,
        auditTrail: normalizeAudit(m.auditEvents),
      }));
      setMessages((prev) => [...prev, ...withAudit]);
    }

    currentAuditRef.current = [];
    setCurrentAudit([]);

    if (conversationId) {
      loadConversationOrders(conversationId);
    }
  };

  const handleError = (event: AuditEvent) => {
    updateAudit((prev) => [
      ...markLastDone(prev),
      {
        message:
          event.message ||
          "Something went wrong while processing your request. Please try again.",
        status: "error",
      },
    ]);
  };

  const handlePayment = (order: PaymentOrder) => {
    setPaymentOrder(order);
  };

  const handlePaymentSuccess = () => {
    setPaymentOrder(null);
    sendMessageRef.current?.(CONFIRM_ORDER_MESSAGE);
  };

  const handleConfirmCheckout = async (paymentMethod: string) => {
    if (!conversationId || isAuthorizing) return;

    setIsAuthorizing(true);
    setCheckoutError(null);

    try {
      await backendApi.authorizeCheckout(conversationId, paymentMethod);
      setPendingCheckout(null);
      sendMessageRef.current?.(authorizeAndPlaceMessage(paymentMethod));
      requestAnimationFrame(() => {
        scrollApiRef.current?.scrollToEnd({ behavior: "smooth" });
      });
    } catch (err: any) {
      setCheckoutError(
        err?.response?.data?.message ||
          err?.message ||
          "Could not authorize checkout.",
      );
    } finally {
      setIsAuthorizing(false);
    }
  };

  return (
    <div className="w-full h-[100dvh] flex overflow-hidden box-border">
      <div
        className={`flex flex-col min-w-0 transition-[flex-grow,max-width] duration-300 ease-in-out ${
          ordersOpen && !isMobile
            ? "flex-[1_1_0%] max-w-[calc(100%-20rem)]"
            : "flex-1"
        }`}
      >
        {conversationId && conversationOrders.length > 0 && !ordersOpen && (
          <button
            type="button"
            onClick={() => setOrdersOpen((v) => !v)}
            className="absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-colors hover:bg-muted"
          >
            <PackageIcon className="size-3.5" />
            {conversationOrders.length} order
            {conversationOrders.length !== 1 ? "s" : ""}
          </button>
        )}
        <MessageScrollerProvider autoScroll>
          <ScrollApiBridge
            conversationId={conversationId}
            messageCount={messages.length}
            apiRef={scrollApiRef}
          />
          <div className="flex-1 min-h-0 grid grid-rows-[1fr_auto]">
            <MessageScroller className="h-full min-h-0">
              <MessageScrollerViewport>
                <MessageScrollerContent className="max-w-200 mx-auto p-5 pb-20">
                  {messages?.map((message: any, i) => (
                    <MemoizedMessageItem key={i} message={message} />
                  ))}

                  {isStreaming && (
                    <MessageScrollerItem messageId="streaming">
                      <Message align="start">
                        <MessageContent>
                          <AuditTrail entries={currentAudit} defaultOpen />
                          {streamingText && (
                            <Bubble variant="ghost" className="mt-1.5">
                              <BubbleContent>
                                <Markdown>{streamingText}</Markdown>
                              </BubbleContent>
                            </Bubble>
                          )}
                          <div className="mt-1.5 flex justify-start"></div>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>

            {/* Chat navigator */}
            <motion.div
              layout
              className="m-5 p-1 w-full max-w-200 mx-auto bg-accent/70 rounded-3xl"
              transition={{ layout: { duration: 0.3, ease: "easeInOut" } }}
            >
              <AnimatePresence>
                {pendingCheckout && (
                  <CheckoutCard
                    checkout={pendingCheckout}
                    isConfirming={isAuthorizing}
                    error={checkoutError}
                    onConfirm={handleConfirmCheckout}
                    onCancel={() => {
                      setPendingCheckout(null);
                      setCheckoutError(null);
                    }}
                  />
                )}
              </AnimatePresence>
              <ChatInput
                conversationId={conversationId}
                onAction={handleAction}
                onToken={handleToken}
                onDone={handleDone}
                onError={handleError}
                onPayment={handlePayment}
                onUserMessage={handleUserMessage}
                onRegisterSend={(send) => {
                  sendMessageRef.current = send;
                }}
              />
            </motion.div>
          </div>
        </MessageScrollerProvider>
      </div>

      {ordersOpen && conversationOrders.length > 0 && (
        <aside className="flex w-80 shrink-0 flex-col border-l bg-popover">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="font-heading text-base font-medium">Orders</span>
            <button
              type="button"
              onClick={() => setOrdersOpen(false)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
              aria-label="Close orders panel"
            >
              <XIcon className="size-4" />
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {conversationOrders.map((order) => (
              <OrderCard
                key={order.orderId}
                order={order}
                onTerminal={() => {
                  if (conversationId) loadConversationOrders(conversationId);
                }}
              />
            ))}
          </div>
        </aside>
      )}

      <PaymentModal
        order={paymentOrder}
        onSuccess={handlePaymentSuccess}
        onClose={() => setPaymentOrder(null)}
      />
    </div>
  );
};

export default Chat;
