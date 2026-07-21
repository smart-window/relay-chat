import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  handle: text("handle").notNull().unique(),
  bio: text("bio").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  lastSeen: integer("last_seen").notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull().default("direct"),
  title: text("title"),
  createdAt: integer("created_at").notNull(),
});

export const conversationMembers = sqliteTable(
  "conversation_members",
  {
    conversationId: text("conversation_id").notNull(),
    userId: text("user_id").notNull(),
    joinedAt: integer("joined_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.userId] })],
);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  senderId: text("sender_id").notNull(),
  kind: text("kind").notNull(),
  body: text("body"),
  objectKey: text("object_key"),
  objectName: text("object_name"),
  objectType: text("object_type"),
  createdAt: integer("created_at").notNull(),
});

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  objectName: text("object_name").notNull(),
  objectType: text("object_type").notNull(),
  size: integer("size").notNull(),
  claimed: integer("claimed").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const calls = sqliteTable("calls", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  callerId: text("caller_id").notNull(),
  calleeId: text("callee_id").notNull(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  offerSdp: text("offer_sdp"),
  answerSdp: text("answer_sdp"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
