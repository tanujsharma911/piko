import {
  Conversation,
  type IConversation,
  type IMessage,
  type IAuditEvent,
} from "db";

export const conversationService = {
  createConversation: async (
    userId: string,
    title?: string,
  ): Promise<IConversation> => {
    try {
      const conversation = await Conversation.create({
        userId,
        title: title || "New chat",
      });
      return conversation;
    } catch (error) {
      throw new Error("Error creating conversation");
    }
  },

  addMessage: async (
    conversationId: string,
    messages: IMessage[],
  ): Promise<IConversation> => {
    try {
      const conversation = await Conversation.findByIdAndUpdate(
        conversationId,
        {
          $push: {
            messages: { $each: messages },
          },
          $set: { updatedAt: new Date() },
        },
        { new: true },
      );

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      return conversation;
    } catch (error) {
      throw new Error("Error adding message to conversation");
    }
  },

  getConversationsByUser: async (userId: string): Promise<IConversation[]> => {
    try {
      const conversations = await Conversation.find({ userId })
        .select("-messages")
        .sort({ updatedAt: -1 });
      return conversations;
    } catch (error) {
      throw new Error("Error fetching conversations");
    }
  },

  getConversationById: async (
    conversationId: string,
    userId: string,
  ): Promise<IConversation | null> => {
    try {
      const conversation = await Conversation.findOne({
        _id: conversationId,
        userId,
      });
      return conversation;
    } catch (error) {
      throw new Error("Error fetching conversation");
    }
  },

  deleteConversation: async (
    conversationId: string,
    userId: string,
  ): Promise<boolean> => {
    try {
      const result = await Conversation.deleteOne({
        _id: conversationId,
        userId,
      });
      return result.deletedCount > 0;
    } catch (error) {
      throw new Error("Error deleting conversation");
    }
  },

  updateTitle: async (
    conversationId: string,
    title: string,
  ): Promise<IConversation | null> => {
    try {
      return await Conversation.findByIdAndUpdate(
        conversationId,
        { title },
        { new: true },
      );
    } catch (error) {
      throw new Error("Error updating conversation title");
    }
  },

  appendAuditEvents: async (
    conversationId: string,
    events: IAuditEvent[],
  ): Promise<void> => {
    try {
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        throw new Error("Conversation not found");
      }
      const lastAssistant = [...conversation.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (lastAssistant) {
        lastAssistant.auditEvents = [
          ...(lastAssistant.auditEvents || []),
          ...events,
        ];
        await conversation.save();
      }
    } catch (error) {
      throw new Error("Error appending audit events");
    }
  },
};
