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

// src/sqlite_vec.ts
import * as sqliteVec from "sqlite-vec";
import { elizaLogger } from "@ai16z/eliza";
function loadVecExtensions(db) {
  try {
    sqliteVec.load(db);
    elizaLogger.log("sqlite-vec extensions loaded successfully.");
  } catch (error) {
    elizaLogger.error("Failed to load sqlite-vec extensions:", error);
    throw error;
  }
}
function load2(db) {
  loadVecExtensions(db);
}

// src/index.ts
import { DatabaseAdapter } from "@ai16z/eliza";
import { embeddingZeroVector } from "@ai16z/eliza";
import { v4 } from "uuid";
var SqliteDatabaseAdapter = class extends DatabaseAdapter {
  async getRoom(roomId) {
    const sql = "SELECT id FROM rooms WHERE id = ?";
    const room = this.db.prepare(sql).get(roomId);
    return room ? room.id : null;
  }
  async getParticipantsForAccount(userId) {
    const sql = `
      SELECT p.id, p.userId, p.roomId, p.last_message_read
      FROM participants p
      WHERE p.userId = ?
    `;
    const rows = this.db.prepare(sql).all(userId);
    return rows;
  }
  async getParticipantsForRoom(roomId) {
    const sql = "SELECT userId FROM participants WHERE roomId = ?";
    const rows = this.db.prepare(sql).all(roomId);
    return rows.map((row) => row.userId);
  }
  async getParticipantUserState(roomId, userId) {
    const stmt = this.db.prepare(
      "SELECT userState FROM participants WHERE roomId = ? AND userId = ?"
    );
    const res = stmt.get(roomId, userId);
    return res?.userState ?? null;
  }
  async setParticipantUserState(roomId, userId, state) {
    const stmt = this.db.prepare(
      "UPDATE participants SET userState = ? WHERE roomId = ? AND userId = ?"
    );
    stmt.run(state, roomId, userId);
  }
  constructor(db) {
    super();
    this.db = db;
    load2(db);
  }
  async init() {
    this.db.exec(sqliteTables);
  }
  async getAccountById(userId) {
    const sql = "SELECT * FROM accounts WHERE id = ?";
    const account = this.db.prepare(sql).get(userId);
    if (!account) return null;
    if (account) {
      if (typeof account.details === "string") {
        account.details = JSON.parse(
          account.details
        );
      }
    }
    return account;
  }
  async createAccount(account) {
    try {
      const sql = "INSERT INTO accounts (id, name, username, email, avatarUrl, details) VALUES (?, ?, ?, ?, ?, ?)";
      this.db.prepare(sql).run(
        account.id ?? v4(),
        account.name,
        account.username,
        account.email,
        account.avatarUrl,
        JSON.stringify(account.details)
      );
      return true;
    } catch (error) {
      console.log("Error creating account", error);
      return false;
    }
  }
  async getActorDetails(params) {
    const sql = `
      SELECT a.id, a.name, a.username, a.details
      FROM participants p
      LEFT JOIN accounts a ON p.userId = a.id
      WHERE p.roomId = ?
    `;
    const rows = this.db.prepare(sql).all(params.roomId);
    return rows.map((row) => {
      if (row === null) {
        return null;
      }
      return {
        ...row,
        details: typeof row.details === "string" ? JSON.parse(row.details) : row.details
      };
    }).filter((row) => row !== null);
  }
  async getMemoriesByRoomIds(params) {
    if (!params.tableName) {
      params.tableName = "messages";
    }
    const placeholders = params.roomIds.map(() => "?").join(", ");
    let sql = `SELECT * FROM memories WHERE type = ? AND roomId IN (${placeholders})`;
    let queryParams = [params.tableName, ...params.roomIds];
    if (params.agentId) {
      sql += ` AND agentId = ?`;
      queryParams.push(params.agentId);
    }
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...queryParams);
    return rows.map((row) => ({
      ...row,
      content: JSON.parse(row.content)
    }));
  }
  async getMemoryById(memoryId) {
    const sql = "SELECT * FROM memories WHERE id = ?";
    const stmt = this.db.prepare(sql);
    stmt.bind([memoryId]);
    const memory = stmt.get();
    if (memory) {
      return {
        ...memory,
        content: JSON.parse(memory.content)
      };
    }
    return null;
  }
  async createMemory(memory, tableName) {
    const deleteSql = `DELETE FROM memories WHERE id = ? AND type = ?`;
    this.db.prepare(deleteSql).run(memory.id, tableName);
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
    const content = JSON.stringify(memory.content);
    const createdAt = memory.createdAt ?? Date.now();
    const sql = `INSERT OR REPLACE INTO memories (id, type, content, embedding, userId, roomId, agentId, \`unique\`, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    this.db.prepare(sql).run(
      memory.id ?? v4(),
      tableName,
      content,
      new Float32Array(memory.embedding ?? embeddingZeroVector),
      // Store as Float32Array
      memory.userId,
      memory.roomId,
      memory.agentId,
      isUnique ? 1 : 0,
      createdAt
    );
  }
  async searchMemories(params) {
    const queryParams = [
      new Float32Array(params.embedding),
      // Ensure embedding is Float32Array
      params.tableName,
      params.roomId
    ];
    let sql = `
            SELECT *, vec_distance_L2(embedding, ?) AS similarity
            FROM memories 
            WHERE type = ? 
            AND roomId = ?`;
    if (params.unique) {
      sql += " AND `unique` = 1";
    }
    if (params.agentId) {
      sql += " AND agentId = ?";
      queryParams.push(params.agentId);
    }
    sql += ` ORDER BY similarity ASC LIMIT ?`;
    queryParams.push(params.match_count.toString());
    const memories = this.db.prepare(sql).all(...queryParams);
    return memories.map((memory) => ({
      ...memory,
      createdAt: typeof memory.createdAt === "string" ? Date.parse(memory.createdAt) : memory.createdAt,
      content: JSON.parse(memory.content)
    }));
  }
  async searchMemoriesByEmbedding(embedding, params) {
    const queryParams = [
      // JSON.stringify(embedding),
      new Float32Array(embedding),
      params.tableName
    ];
    let sql = `
      SELECT *, vec_distance_L2(embedding, ?) AS similarity
      FROM memories
      WHERE type = ?`;
    if (params.unique) {
      sql += " AND `unique` = 1";
    }
    if (params.agentId) {
      sql += " AND agentId = ?";
      queryParams.push(params.agentId);
    }
    if (params.roomId) {
      sql += " AND roomId = ?";
      queryParams.push(params.roomId);
    }
    sql += ` ORDER BY similarity DESC`;
    if (params.count) {
      sql += " LIMIT ?";
      queryParams.push(params.count.toString());
    }
    const memories = this.db.prepare(sql).all(...queryParams);
    return memories.map((memory) => ({
      ...memory,
      createdAt: typeof memory.createdAt === "string" ? Date.parse(memory.createdAt) : memory.createdAt,
      content: JSON.parse(memory.content)
    }));
  }
  async getCachedEmbeddings(opts) {
    const sql = `
            WITH content_text AS (
                SELECT 
                    embedding,
                    json_extract(
                        json(content),
                        '$.' || ? || '.' || ?
                    ) as content_text
                FROM memories 
                WHERE type = ?
                AND json_extract(
                    json(content),
                    '$.' || ? || '.' || ?
                ) IS NOT NULL
            )
            SELECT 
                embedding,
                length(?) + length(content_text) - (
                    length(?) + length(content_text) - (
                        length(replace(lower(?), lower(content_text), '')) + 
                        length(replace(lower(content_text), lower(?), ''))
                    ) / 2
                ) as levenshtein_score
            FROM content_text
            ORDER BY levenshtein_score ASC
            LIMIT ?
        `;
    const rows = this.db.prepare(sql).all(
      opts.query_field_name,
      opts.query_field_sub_name,
      opts.query_table_name,
      opts.query_field_name,
      opts.query_field_sub_name,
      opts.query_input,
      opts.query_input,
      opts.query_input,
      opts.query_input,
      opts.query_match_count
    );
    return rows.map((row) => ({
      embedding: Array.from(new Float32Array(row.embedding)),
      levenshtein_score: row.levenshtein_score
    }));
  }
  async updateGoalStatus(params) {
    const sql = "UPDATE goals SET status = ? WHERE id = ?";
    this.db.prepare(sql).run(params.status, params.goalId);
  }
  async log(params) {
    const sql = "INSERT INTO logs (body, userId, roomId, type) VALUES (?, ?, ?, ?)";
    this.db.prepare(sql).run(
      JSON.stringify(params.body),
      params.userId,
      params.roomId,
      params.type
    );
  }
  async getMemories(params) {
    if (!params.tableName) {
      throw new Error("tableName is required");
    }
    if (!params.roomId) {
      throw new Error("roomId is required");
    }
    let sql = `SELECT * FROM memories WHERE type = ? AND roomId = ?`;
    const queryParams = [params.tableName, params.roomId];
    if (params.unique) {
      sql += " AND `unique` = 1";
    }
    if (params.agentId) {
      sql += " AND agentId = ?";
      queryParams.push(params.agentId);
    }
    if (params.start) {
      sql += ` AND createdAt >= ?`;
      queryParams.push(params.start);
    }
    if (params.end) {
      sql += ` AND createdAt <= ?`;
      queryParams.push(params.end);
    }
    sql += " ORDER BY createdAt DESC";
    if (params.count) {
      sql += " LIMIT ?";
      queryParams.push(params.count);
    }
    const memories = this.db.prepare(sql).all(...queryParams);
    return memories.map((memory) => ({
      ...memory,
      createdAt: typeof memory.createdAt === "string" ? Date.parse(memory.createdAt) : memory.createdAt,
      content: JSON.parse(memory.content)
    }));
  }
  async removeMemory(memoryId, tableName) {
    const sql = `DELETE FROM memories WHERE type = ? AND id = ?`;
    this.db.prepare(sql).run(tableName, memoryId);
  }
  async removeAllMemories(roomId, tableName) {
    const sql = `DELETE FROM memories WHERE type = ? AND roomId = ?`;
    this.db.prepare(sql).run(tableName, roomId);
  }
  async countMemories(roomId, unique = true, tableName = "") {
    if (!tableName) {
      throw new Error("tableName is required");
    }
    let sql = `SELECT COUNT(*) as count FROM memories WHERE type = ? AND roomId = ?`;
    const queryParams = [tableName, roomId];
    if (unique) {
      sql += " AND `unique` = 1";
    }
    return this.db.prepare(sql).get(...queryParams).count;
  }
  async getGoals(params) {
    let sql = "SELECT * FROM goals WHERE roomId = ?";
    const queryParams = [params.roomId];
    if (params.userId) {
      sql += " AND userId = ?";
      queryParams.push(params.userId);
    }
    if (params.onlyInProgress) {
      sql += " AND status = 'IN_PROGRESS'";
    }
    if (params.count) {
      sql += " LIMIT ?";
      queryParams.push(params.count.toString());
    }
    const goals = this.db.prepare(sql).all(...queryParams);
    return goals.map((goal) => ({
      ...goal,
      objectives: typeof goal.objectives === "string" ? JSON.parse(goal.objectives) : goal.objectives
    }));
  }
  async updateGoal(goal) {
    const sql = "UPDATE goals SET name = ?, status = ?, objectives = ? WHERE id = ?";
    this.db.prepare(sql).run(
      goal.name,
      goal.status,
      JSON.stringify(goal.objectives),
      goal.id
    );
  }
  async createGoal(goal) {
    const sql = "INSERT INTO goals (id, roomId, userId, name, status, objectives) VALUES (?, ?, ?, ?, ?, ?)";
    this.db.prepare(sql).run(
      goal.id ?? v4(),
      goal.roomId,
      goal.userId,
      goal.name,
      goal.status,
      JSON.stringify(goal.objectives)
    );
  }
  async removeGoal(goalId) {
    const sql = "DELETE FROM goals WHERE id = ?";
    this.db.prepare(sql).run(goalId);
  }
  async removeAllGoals(roomId) {
    const sql = "DELETE FROM goals WHERE roomId = ?";
    this.db.prepare(sql).run(roomId);
  }
  async createRoom(roomId) {
    roomId = roomId || v4();
    try {
      const sql = "INSERT INTO rooms (id) VALUES (?)";
      this.db.prepare(sql).run(roomId ?? v4());
    } catch (error) {
      console.log("Error creating room", error);
    }
    return roomId;
  }
  async removeRoom(roomId) {
    const sql = "DELETE FROM rooms WHERE id = ?";
    this.db.prepare(sql).run(roomId);
  }
  async getRoomsForParticipant(userId) {
    const sql = "SELECT roomId FROM participants WHERE userId = ?";
    const rows = this.db.prepare(sql).all(userId);
    return rows.map((row) => row.roomId);
  }
  async getRoomsForParticipants(userIds) {
    const placeholders = userIds.map(() => "?").join(", ");
    const sql = `SELECT DISTINCT roomId FROM participants WHERE userId IN (${placeholders})`;
    const rows = this.db.prepare(sql).all(...userIds);
    return rows.map((row) => row.roomId);
  }
  async addParticipant(userId, roomId) {
    try {
      const sql = "INSERT INTO participants (id, userId, roomId) VALUES (?, ?, ?)";
      this.db.prepare(sql).run(v4(), userId, roomId);
      return true;
    } catch (error) {
      console.log("Error adding participant", error);
      return false;
    }
  }
  async removeParticipant(userId, roomId) {
    try {
      const sql = "DELETE FROM participants WHERE userId = ? AND roomId = ?";
      this.db.prepare(sql).run(userId, roomId);
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
    this.db.prepare(sql).run(v4(), params.userA, params.userB, params.userA);
    return true;
  }
  async getRelationship(params) {
    const sql = "SELECT * FROM relationships WHERE (userA = ? AND userB = ?) OR (userA = ? AND userB = ?)";
    return this.db.prepare(sql).get(
      params.userA,
      params.userB,
      params.userB,
      params.userA
    ) || null;
  }
  async getRelationships(params) {
    const sql = "SELECT * FROM relationships WHERE (userA = ? OR userB = ?)";
    return this.db.prepare(sql).all(params.userId, params.userId);
  }
  async getCache(params) {
    const sql = "SELECT value FROM cache WHERE (key = ? AND agentId = ?)";
    const cached = this.db.prepare(sql).get(params.key, params.agentId);
    return cached?.value ?? void 0;
  }
  async setCache(params) {
    const sql = "INSERT OR REPLACE INTO cache (key, agentId, value, createdAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)";
    this.db.prepare(sql).run(params.key, params.agentId, params.value);
    return true;
  }
  async deleteCache(params) {
    try {
      const sql = "DELETE FROM cache WHERE key = ? AND agentId = ?";
      this.db.prepare(sql).run(params.key, params.agentId);
      return true;
    } catch (error) {
      console.log("Error removing cache", error);
      return false;
    }
  }
};
export {
  SqliteDatabaseAdapter,
  load2 as load,
  loadVecExtensions,
  sqliteTables
};
//# sourceMappingURL=index.js.map