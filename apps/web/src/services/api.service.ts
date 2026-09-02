import { config } from "@/config/env";
import axios from "axios";

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthResponse {
  user: User;
  token: string;
}

interface Message {
  _id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface Conversation {
  _id: string;
  title: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
}

interface CreateConversationInput {
  title?: string;
  firstMessage?: string;
}

class BackendApi {
  private api = axios.create({
    baseURL: config.VITE_BACKEND_URL,
    withCredentials: true,
  });

  public login = async (
    email: string,
    password: string,
  ): Promise<AuthResponse> => {
    try {
      const { data } = await this.api.post<AuthResponse>("/auth/login", {
        email,
        password,
      });
      return data;
    } catch (error: any) {
      console.error(
        "Login failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public register = async (
    name: string,
    email: string,
    password: string,
  ): Promise<AuthResponse> => {
    try {
      const { data } = await this.api.post<AuthResponse>("/auth/register", {
        name,
        email,
        password,
      });
      return data;
    } catch (error: any) {
      console.error(
        "Registration failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public getMe = async (): Promise<{ user: User }> => {
    try {
      const { data } = await this.api.get<{ user: User }>("/auth/me");
      return data;
    } catch (error: any) {
      console.error(
        "Get user failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public logout = async (): Promise<void> => {
    try {
      await this.api.post("/auth/logout");
    } catch (error: any) {
      console.error(
        "Logout failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public getConversations = async (): Promise<{
    conversations: Conversation[];
  }> => {
    try {
      const { data } = await this.api.get<{ conversations: Conversation[] }>(
        "/conversations",
      );
      return data;
    } catch (error: any) {
      console.error(
        "Get conversations failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public getConversation = async (
    id: string,
  ): Promise<{ conversation: Conversation }> => {
    try {
      const { data } = await this.api.get<{ conversation: Conversation }>(
        `/conversations/${id}`,
      );
      return data;
    } catch (error: any) {
      console.error(
        "Get conversation failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public createConversation = async (
    input: CreateConversationInput,
  ): Promise<{ conversation: Conversation }> => {
    try {
      const { data } = await this.api.post<{ conversation: Conversation }>(
        "/conversations",
        input,
      );
      return data;
    } catch (error: any) {
      console.error(
        "Create conversation failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public deleteConversation = async (id: string): Promise<void> => {
    try {
      await this.api.delete(`/conversations/${id}`);
    } catch (error: any) {
      console.error(
        "Delete conversation failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  /**
   * Sends a message to the assistant.
   * @param conversationId - The ID of the conversation.
   * @param input - The message to send.
   * @returns user message + assistant message
   */
  public sendMessage = async (
    conversationId: string,
    input: string,
  ): Promise<{ conversationId: string; messages: Message[] }> => {
    try {
      const { data } = await this.api.post<{
        conversationId: string;
        messages: Message[];
      }>(`/conversations/${conversationId}/messages`, {
        content: input,
        role: "user",
      });
      return data;
    } catch (error: any) {
      console.error(
        "Send message failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public getMessages = async (
    conversationId: string,
  ): Promise<{ messages: Message[] }> => {
    try {
      const { data } = await this.api.get<{ messages: Message[] }>(
        `/conversations/${conversationId}/messages`,
      );
      return data;
    } catch (error: any) {
      console.error(
        "Get messages failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public getSwiggyConnectUrl = async (): Promise<{ url: string }> => {
    try {
      const { data } = await this.api.get<{ url: string }>("/swiggy/connect");
      return data;
    } catch (error: any) {
      console.error(
        "Get Swiggy connect URL failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public getSwiggyStatus = async (): Promise<{
    connected: boolean;
    expiresAt: string | null;
  }> => {
    try {
      const { data } = await this.api.get<{
        connected: boolean;
        expiresAt: string | null;
      }>("/swiggy/status");
      return data;
    } catch (error: any) {
      console.error(
        "Get Swiggy status failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public disconnectSwiggy = async (): Promise<void> => {
    try {
      await this.api.post("/swiggy/disconnect");
    } catch (error: any) {
      console.error(
        "Disconnect Swiggy failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public authorizeCheckout = async (
    conversationId: string,
    paymentMethod: string,
  ): Promise<{
    success: boolean;
    authorizationId: string;
    amount: number;
    cartId: string;
    cartHash: string;
    addressId: string;
    paymentMethod: string;
    expiresAt: string;
  }> => {
    try {
      const { data } = await this.api.post(
        `/conversations/${conversationId}/checkout-authorize`,
        { paymentMethod },
      );
      return data;
    } catch (error: any) {
      console.error(
        "Authorize checkout failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };

  public getConversationOrders = async (
    conversationId: string,
  ): Promise<{ orders: any[] }> => {
    try {
      const { data } = await this.api.get<{ orders: any[] }>(
        `/orders/conversations/${conversationId}`,
      );
      return data;
    } catch (error: any) {
      console.error(
        "Get conversation orders failed:",
        error?.response?.data?.message || error.message,
      );
      throw error;
    }
  };
}

export const backendApi = new BackendApi();
