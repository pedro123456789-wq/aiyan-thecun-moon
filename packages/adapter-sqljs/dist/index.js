// src/sqliteTables.ts
var sqliteTables = `
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

-- Table: accounts
CREATE TABLE IF NOT EXISTS "accounts" (
    "id" TEXT PRIMARY KEY,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,
    "username" TEXT,
    "email" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "details" TEXT DEFAULT '{}' CHECK(json_valid("details")) -- Ensuring details is a valid JSON field
);

-- Table: memories
CREATE TABLE IF NOT EXISTS "memories" (
    "id" TEXT PRIMARY KEY,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "content" TEXT NOT NULL,
    "embedding" BLOB NOT NULL, -- TODO: EMBEDDING ARRAY, CONVERT TO BEST FORMAT FOR SQLITE-VSS (JSON?)
    "userId" TEXT,
    "roomId" TEXT,
    "agentId" TEXT,
    "unique" INTEGER DEFAULT 1 NOT NULL,
    FOREIGN KEY ("userId") REFERENCES "accounts"("id"),
    FOREIGN KEY ("roomId") REFERENCES "rooms"("id"),
    FOREIGN KEY ("agentId") REFERENCES "accounts"("id")
);

-- Table: goals
CREATE TABLE IF NOT EXISTS "goals" (
    "id" TEXT PRIMARY KEY,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "name" TEXT,
    "status" TEXT,
    "description" TEXT,
    "roomId" TEXT,
    "objectives" TEXT DEFAULT '[]' NOT NULL CHECK(json_valid("objectives")) -- Ensuring objectives is a valid JSON array
);

-- Table: logs
CREATE TABLE IF NOT EXISTS "logs" (
    "id" TEXT PRIMARY KEY,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "roomId" TEXT NOT NULL
);

-- Table: participants
CREATE TABLE IF NOT EXISTS "participants" (
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "roomId" TEXT,
    "userState" TEXT,
    "id" TEXT PRIMARY KEY,
    "last_message_read" TEXT,
    FOREIGN KEY ("userId") REFERENCES "accounts"("id"),
    FOREIGN KEY ("roomId") REFERENCES "rooms"("id")
);

-- Table: relationships
CREATE TABLE IF NOT EXISTS "relationships" (
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "userA" TEXT NOT NULL,
    "userB" TEXT NOT NULL,
    "status" "text",
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL,
    FOREIGN KEY ("userA") REFERENCES "accounts"("id"),
    FOREIGN KEY ("userB") REFERENCES "accounts"("id"),
    FOREIGN KEY ("userId") REFERENCES "accounts"("id")
);

-- Table: rooms
CREATE TABLE IF NOT EXISTS "rooms" (
    "id" TEXT PRIMARY KEY,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: cache
CREATE TABLE IF NOT EXISTS "cache" (
    "key" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "value" TEXT DEFAULT '{}' CHECK(json_valid("value")),
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP,
    PRIMARY KEY ("key", "agentId")
);

-- Index: relationships_id_key
CREATE UNIQUE INDEX IF NOT EXISTS "relationships_id_key" ON "relationships" ("id");

-- Index: memories_id_key
CREATE UNIQUE INDEX IF NOT EXISTS "memories_id_key" ON "memories" ("id");

-- Index: participants_id_key
CREATE UNIQUE INDEX IF NOT EXISTS "participants_id_key" ON "participants" ("id");

COMMIT;`;

// src/index.ts
import { v4 } from "uuid";
import { DatabaseAdapter } from "@ai16z/eliza";
var SqlJsDatabaseAdapter = class extends DatabaseAdapter {
  constructor(db) {
    super();
    this.db = db;
  }
  async init() {
    this.db.exec(sqliteTables);
  }
  async getRoom(roomId) {
    const sql = "SELECT id FROM rooms WHERE id = ?";
    const stmt = this.db.prepare(sql);
    stmt.bind([roomId]);
    const room = stmt.getAsObject();
    stmt.free();
    return room ? room.id : null;
  }
  async getParticipantsForAccount(userId) {
    const sql = `
      SELECT p.id, p.userId, p.roomId, p.last_message_read
      FROM participants p
      WHERE p.userId = ?
    `;
    const stmt = this.db.prepare(sql);
    stmt.bind([userId]);
    const participants = [];
    while (stmt.step()) {
      const participant = stmt.getAsObject();
      participants.push(participant);
    }
    stmt.free();
    return participants;
  }
  async getParticipantUserState(roomId, userId) {
    const sql = "SELECT userState FROM participants WHERE roomId = ? AND userId = ?";
    const stmt = this.db.prepare(sql);
    stmt.bind([roomId, userId]);
    const result = stmt.getAsObject();
    stmt.free();
    return result.userState ?? null;
  }
  async getMemoriesByRoomIds(params) {
    const placeholders = params.roomIds.map(() => "?").join(", ");
    let sql = `SELECT * FROM memories WHERE type = ? AND roomId IN (${placeholders})`;
    const stmt = this.db.prepare(sql);
    const queryParams = [params.tableName, ...params.roomIds];
    if (params.agentId) {
      sql += " AND userId = ?";
      queryParams.push(params.agentId);
    }
    stmt.bind(queryParams);
    const memories = [];
    while (stmt.step()) {
      const memory = stmt.getAsObject();
      memories.push({
        ...memory,
        content: JSON.parse(memory.content)
      });
    }
    stmt.free();
    return memories;
  }
  async setParticipantUserState(roomId, userId, state) {
    const sql = "UPDATE participants SET userState = ? WHERE roomId = ? AND userId = ?";
    const stmt = this.db.prepare(sql);
    stmt.bind([state, roomId, userId]);
    stmt.step();
    stmt.free();
  }
  async getParticipantsForRoom(roomId) {
    const sql = "SELECT userId FROM participants WHERE roomId = ?";
    const stmt = this.db.prepare(sql);
    stmt.bind([roomId]);
    const userIds = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      userIds.push(row.userId);
    }
    stmt.free();
    return userIds;
  }
  async getAccountById(userId) {
    const sql = "SELECT * FROM accounts WHERE id = ?";
    const stmt = this.db.prepare(sql);
    stmt.bind([userId]);
    const account = stmt.getAsObject();
    if (account && typeof account.details === "string") {
      account.details = JSON.parse(account.details);
    }
    stmt.free();
    return account || null;
  }
  async createAccount(account) {
    try {
      const sql = `
      INSERT INTO accounts (id, name, username, email, avatarUrl, details)
      VALUES (?, ?, ?, ?, ?, ?)
      `;
      const stmt = this.db.prepare(sql);
      stmt.run([
        account.id ?? v4(),
        account.name,
        account.username || "",
        account.email || "",
        account.avatarUrl || "",
        JSON.stringify(account.details)
      ]);
      stmt.free();
      return true;
    } catch (error) {
      console.log("Error creating account", error);
      return false;
    }
  }
  async getActorById(params) {
    const sql = `
      SELECT a.id, a.name, a.username, a.details
      FROM participants p
      LEFT JOIN accounts a ON p.userId = a.id
      WHERE p.roomId = ?
    `;
    const stmt = this.db.prepare(sql);
    stmt.bind([params.roomId]);
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        ...row,
        details: typeof row.details === "string" ? JSON.parse(row.details) : row.details
      });
    }
    stmt.free();
    return rows;
  }
  async getActorDetails(params) {
    const sql = `
      SELECT a.id, a.name, a.username, a.details
      FROM participants p
      LEFT JOIN accounts a ON p.userId = a.id
      WHERE p.roomId = ?
    `;
    const stmt = this.db.prepare(sql);
    stmt.bind([params.roomId]);
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        ...row,
        details: typeof row.details === "string" ? JSON.parse(row.details) : row.details
      });
    }
    stmt.free();
    return rows;
  }
  async getMemoryById(id) {
    const sql = "SELECT * FROM memories WHERE id = ?";
    const stmt = this.db.prepare(sql);
    stmt.bind([id]);
    const memory = stmt.getAsObject();
    stmt.free();
    return memory || null;
  }
  async createMemory(memory, tableName) {
    let isUnique = true;
    if (memory.embedding) {
      const similarMemories = await this.searchMemoriesByEmbedding(
        memory.embedding,
        {
          tableName,
          roomId: memory.roomId,
          match_threshold: 0.95,
          // 5% similarity threshold
          count: 1
        }
      );
      isUnique = similarMemories.length === 0;
    }
    const sql = `INSERT INTO memories (id, type, content, embedding, userId, roomId, agentId, \`unique\`, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const stmt = this.db.prepare(sql);
    const createdAt = memory.createdAt ?? Date.now();
    stmt.run([
      memory.id ?? v4(),
      tableName,
      JSON.stringify(memory.content),
      JSON.stringify(memory.embedding),
      memory.userId,
      memory.roomId,
      memory.agentId,
      isUnique ? 1 : 0,
      createdAt
    ]);
    stmt.free();
  }
  async searchMemories(params) {
    let sql = `
  SELECT * FROM memories
  WHERE type = ?
  AND roomId = ?`;
    if (params.unique) {
      sql += " AND `unique` = 1";
    }
    const stmt = this.db.prepare(sql);
    stmt.bind([
      // JSON.stringify(params.embedding),
      params.tableName,
      params.roomId
      // params.match_count,
    ]);
    const memories = [];
    while (stmt.step()) {
      const memory = stmt.getAsObject();
      memories.push({
        ...memory,
        content: JSON.parse(memory.content)
      });
    }
    stmt.free();
    return memories;
  }
  async searchMemoriesByEmbedding(_embedding, params) {
    let sql = `SELECT * FROM memories
        WHERE type = ?`;
    if (params.unique) {
      sql += " AND `unique` = 1";
    }
    if (params.roomId) {
      sql += " AND roomId = ?";
    }
    if (params.agentId) {
      sql += " AND userId = ?";
    }
    if (params.count) {
      sql += " LIMIT ?";
    }
    const stmt = this.db.prepare(sql);
    const bindings = [
      // JSON.stringify(embedding),
      params.tableName
    ];
    if (params.roomId) {
      bindings.push(params.roomId);
    }
    if (params.count) {
      bindings.push(params.count.toString());
    }
    stmt.bind(bindings);
    const memories = [];
    while (stmt.step()) {
      const memory = stmt.getAsObject();
      memories.push({
        ...memory,
        content: JSON.parse(memory.content)
      });
    }
    stmt.free();
    return memories;
  }
  async getCachedEmbeddings(opts) {
    const sql = `
        SELECT *
        FROM memories
        WHERE type = ? LIMIT ?
      `;
    const stmt = this.db.prepare(sql);
    stmt.bind([
      opts.query_table_name,
      // opts.query_input,
      // opts.query_input,
      opts.query_match_count
    ]);
    const memories = [];
    while (stmt.step()) {
      const memory = stmt.getAsObject();
      memories.push(memory);
    }
    stmt.free();
    return memories.map((memory) => ({
      ...memory,
      createdAt: memory.createdAt ?? Date.now(),
      embedding: JSON.parse(memory.embedding),
      levenshtein_score: 0
    }));
  }
  async updateGoalStatus(params) {
    const sql = "UPDATE goals SET status = ? WHERE id = ?";
    const stmt = this.db.prepare(sql);
    stmt.run([params.status, params.goalId]);
    stmt.free();
  }
  async log(params) {
    const sql = "INSERT INTO logs (body, userId, roomId, type) VALUES (?, ?, ?, ?)";
    const stmt = this.db.prepare(sql);
    stmt.run([
      JSON.stringify(params.body),
      params.userId,
      params.roomId,
      params.type
    ]);
    stmt.free();
  }
  async getMemories(params) {
    if (!params.tableName) {
      throw new Error("tableName is required");
    }
    if (!params.roomId) {
      throw new Error("roomId is required");
    }
    let sql = `SELECT * FROM memories WHERE type = ? AND roomId = ?`;
    if (params.start) {
      sql += ` AND createdAt >= ?`;
    }
    if (params.end) {
      sql += ` AND createdAt <= ?`;
    }
    if (params.unique) {
      sql += " AND `unique` = 1";
    }
    if (params.agentId) {
      sql += " AND agentId = ?";
    }
    sql += " ORDER BY createdAt DESC";
    if (params.count) {
      sql += " LIMIT ?";
    }
    const stmt = this.db.prepare(sql);
    stmt.bind([
      params.tableName,
      params.roomId,
      ...params.start ? [params.start] : [],
      ...params.end ? [params.end] : [],
      ...params.agentId ? [params.agentId] : [],
      ...params.count ? [params.count] : []
    ]);
    const memories = [];
    while (stmt.step()) {
      const memory = stmt.getAsObject();
      memories.push({
        ...memory,
        content: JSON.parse(memory.content)
      });
    }
    stmt.free();
    return memories;
  }
  async removeMemory(memoryId, tableName) {
    const sql = `DELETE FROM memories WHERE type = ? AND id = ?`;
    const stmt = this.db.prepare(sql);
    stmt.run([tableName, memoryId]);
    stmt.free();
  }
  async removeAllMemories(roomId, tableName) {
    const sql = `DELETE FROM memories WHERE type = ? AND roomId = ?`;
    const stmt = this.db.prepare(sql);
    stmt.run([tableName, roomId]);
    stmt.free();
  }
  async countMemories(roomId, unique = true, tableName = "") {
    if (!tableName) {
      throw new Error("tableName is required");
    }
    let sql = `SELECT COUNT(*) as count FROM memories WHERE type = ? AND roomId = ?`;
    if (unique) {
      sql += " AND `unique` = 1";
    }
    const stmt = this.db.prepare(sql);
    stmt.bind([tableName, roomId]);
    let count = 0;
    if (stmt.step()) {
      const result = stmt.getAsObject();
      count = result.count;
    }
    stmt.free();
    return count;
  }
  async getGoals(params) {
    let sql = "SELECT * FROM goals WHERE roomId = ?";
    const bindings = [params.roomId];
    if (params.userId) {
      sql += " AND userId = ?";
      bindings.push(params.userId);
    }
    if (params.onlyInProgress) {
      sql += " AND status = 'IN_PROGRESS'";
    }
    if (params.count) {
      sql += " LIMIT ?";
      bindings.push(params.count.toString());
    }
    const stmt = this.db.prepare(sql);
    stmt.bind(bindings);
    const goals = [];
    while (stmt.step()) {
      const goal = stmt.getAsObject();
      goals.push({
        ...goal,
        objectives: typeof goal.objectives === "string" ? JSON.parse(goal.objectives) : goal.objectives
      });
    }
    stmt.free();
    return goals;
  }
  async updateGoal(goal) {
    const sql = "UPDATE goals SET name = ?, status = ?, objectives = ? WHERE id = ?";
    const stmt = this.db.prepare(sql);
    stmt.run([
      goal.name,
      goal.status,
      JSON.stringify(goal.objectives),
      goal.id
    ]);
    stmt.free();
  }
  async createGoal(goal) {
    const sql = "INSERT INTO goals (id, roomId, userId, name, status, objectives) VALUES (?, ?, ?, ?, ?, ?)";
    const stmt = this.db.prepare(sql);
    stmt.run([
      goal.id ?? v4(),
      goal.roomId,
      goal.userId,
      goal.name,
      goal.status,
      JSON.stringify(goal.objectives)
    ]);
    stmt.free();
  }
  async removeGoal(goalId) {
    const sql = "DELETE FROM goals WHERE id = ?";
    const stmt = this.db.prepare(sql);
    stmt.run([goalId]);
    stmt.free();
  }
  async removeAllGoals(roomId) {
    const sql = "DELETE FROM goals WHERE roomId = ?";
    const stmt = this.db.prepare(sql);
    stmt.run([roomId]);
    stmt.free();
  }
  async createRoom(roomId) {
    roomId = roomId || v4();
    try {
      const sql = "INSERT INTO rooms (id) VALUES (?)";
      const stmt = this.db.prepare(sql);
      stmt.run([roomId ?? v4()]);
      stmt.free();
    } catch (error) {
      console.log("Error creating room", error);
    }
    return roomId;
  }
  async removeRoom(roomId) {
    const sql = "DELETE FROM rooms WHERE id = ?";
    const stmt = this.db.prepare(sql);
    stmt.run([roomId]);
    stmt.free();
  }
  async getRoomsForParticipant(userId) {
    const sql = "SELECT roomId FROM participants WHERE userId = ?";
    const stmt = this.db.prepare(sql);
    stmt.bind([userId]);
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push(row);
    }
    stmt.free();
    return rows.map((row) => row.roomId);
  }
  async getRoomsForParticipants(userIds) {
    const placeholders = userIds.map(() => "?").join(", ");
    const sql = `SELECT roomId FROM participants WHERE userId IN (${placeholders})`;
    const stmt = this.db.prepare(sql);
    stmt.bind(userIds);
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push(row);
    }
    stmt.free();
    return rows.map((row) => row.roomId);
  }
  async addParticipant(userId, roomId) {
    try {
      const sql = "INSERT INTO participants (id, userId, roomId) VALUES (?, ?, ?)";
      const stmt = this.db.prepare(sql);
      stmt.run([v4(), userId, roomId]);
      stmt.free();
      return true;
    } catch (error) {
      console.log("Error adding participant", error);
      return false;
    }
  }
  async removeParticipant(userId, roomId) {
    try {
      const sql = "DELETE FROM participants WHERE userId = ? AND roomId = ?";
      const stmt = this.db.prepare(sql);
      stmt.run([userId, roomId]);
      stmt.free();
      return true;
    } catch (error) {
      console.log("Error removing participant", error);
      return false;
    }
  }
  async createRelationship(params) {
    if (!params.userA || !params.userB) {
      throw new Error("userA and userB are required");
    }
    const sql = "INSERT INTO relationships (id, userA, userB, userId) VALUES (?, ?, ?, ?)";
    const stmt = this.db.prepare(sql);
    stmt.run([v4(), params.userA, params.userB, params.userA]);
    stmt.free();
    return true;
  }
  async getRelationship(params) {
    let relationship = null;
    try {
      const sql = "SELECT * FROM relationships WHERE (userA = ? AND userB = ?) OR (userA = ? AND userB = ?)";
      const stmt = this.db.prepare(sql);
      stmt.bind([params.userA, params.userB, params.userB, params.userA]);
      if (stmt.step()) {
        relationship = stmt.getAsObject();
      }
      stmt.free();
    } catch (error) {
      console.log("Error fetching relationship", error);
    }
    return relationship;
  }
  async getRelationships(params) {
    const sql = "SELECT * FROM relationships WHERE (userA = ? OR userB = ?)";
    const stmt = this.db.prepare(sql);
    stmt.bind([params.userId, params.userId]);
    const relationships = [];
    while (stmt.step()) {
      const relationship = stmt.getAsObject();
      relationships.push(relationship);
    }
    stmt.free();
    return relationships;
  }
  async getCache(params) {
    const sql = "SELECT value FROM cache WHERE (key = ? AND agentId = ?)";
    const stmt = this.db.prepare(sql);
    stmt.bind([params.key, params.agentId]);
    let cached = void 0;
    if (stmt.step()) {
      cached = stmt.getAsObject();
    }
    stmt.free();
    return cached.value;
  }
  async setCache(params) {
    const sql = "INSERT OR REPLACE INTO cache (key, agentId, value, createdAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)";
    const stmt = this.db.prepare(sql);
    stmt.run([params.key, params.agentId, params.value]);
    stmt.free();
    return true;
  }
  async deleteCache(params) {
    try {
      const sql = "DELETE FROM cache WHERE key = ? AND agentId = ?";
      const stmt = this.db.prepare(sql);
      stmt.run([params.key, params.agentId]);
      stmt.free();
    } catch (error) {
      console.log("Error removing cache", error);
      return false;
    }
  }
};
export {
  SqlJsDatabaseAdapter,
  sqliteTables
};
//# sourceMappingURL=index.js.map