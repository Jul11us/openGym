import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Sites identity is the account boundary; request bodies never choose a user.
export const gymUsers = sqliteTable('gym_users', {
  userId: text('user_id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  deletedAt: integer('deleted_at'),
  mediaEpoch: integer('media_epoch').notNull().default(0),
  mediaPurge: integer('media_purge').notNull().default(0),
});

export const gymState = sqliteTable('gym_state', {
  userId: text('user_id').primaryKey().references(() => gymUsers.userId),
  revision: integer('revision').notNull().default(0),
  writeId: text('write_id'),
  document: text('document'),
  updatedAt: integer('updated_at').notNull(),
});

export const gymMutations = sqliteTable('gym_mutations', {
  userId: text('user_id').notNull().references(() => gymUsers.userId),
  mutationId: text('mutation_id').notNull(),
  digest: text('digest').notNull(),
  response: text('response').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.mutationId] })]);

export const gymMedia = sqliteTable('gym_media', {
  userId: text('user_id').notNull().references(() => gymUsers.userId),
  hash: text('hash').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.hash] })]);
