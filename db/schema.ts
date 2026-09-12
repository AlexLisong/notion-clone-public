import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
export const workspaces = sqliteTable("workspaces", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  data: text("data").notNull(),
});
