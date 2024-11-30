// src/index.ts
import { createClient } from "@supabase/supabase-js";
import { DatabaseAdapter } from "@ai16z/eliza";
import { v4 as uuid } from "uuid";
var SupabaseDatabaseAdapter = class extends DatabaseAdapter {
  async getRoom(roomId) {
    const { data, error } = await this.supabase.from("rooms").select("id").eq("id", roomId).single();
    if (error) {
      throw new Error(`Error getting room: ${error.message}`);
    }
    return data ? data.id : null;
  }
  async getParticipantsForAccount(userId) {
    const { data, error } = await this.supabase.from("participants").select("*").eq("userId", userId);
    if (error) {
      throw new Error(
        `Error getting participants for account: ${error.message}`
      );
    }
    return data;
  }
  async getParticipantUserState(roomId, userId) {
    const { data, error } = await this.supabase.from("participants").select("userState").eq("roomId", roomId).eq("userId", userId).single();
    if (error) {
      console.error("Error getting participant user state:", error);
      return null;
    }
    return data?.userState;
  }
  async setParticipantUserState(roomId, userId, state) {
    const { error } = await this.supabase.from("participants").update({ userState: state }).eq("roomId", roomId).eq("userId", userId);
    if (error) {
      console.error("Error setting participant user state:", error);
      throw new Error("Failed to set participant user state");
    }
  }
  async getParticipantsForRoom(roomId) {
    const { data, error } = await this.supabase.from("participants").select("userId").eq("roomId", roomId);
    if (error) {
      throw new Error(
        `Error getting participants for room: ${error.message}`
      );
    }
    return data.map((row) => row.userId);
  }
  supabase;
  constructor(supabaseUrl, supabaseKey) {
    super();
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }
  getCache(params) {
    return void 0;
  }
  setCache(params) {
    return new Promise(() => true);
  }
  deleteCache(params) {
    return new Promise(() => true);
  }
  async getMemoriesByRoomIds(params) {
    let query = this.supabase.from(params.tableName).select("*").in("roomId", params.roomIds);
    if (params.agentId) {
      query = query.eq("agentId", params.agentId);
    }
    const { data, error } = await query;
    if (error) {
      console.error("Error retrieving memories by room IDs:", error);
      return [];
    }
    const memories = data.map((memory) => ({
      ...memory
    }));
    return memories;
  }
  async getAccountById(userId) {
    const { data, error } = await this.supabase.from("accounts").select("*").eq("id", userId);
    if (error) {
      throw new Error(error.message);
    }
    return data?.[0] || null;
  }
  async createAccount(account) {
    const { error } = await this.supabase.from("accounts").upsert([account]);
    if (error) {
      console.error(error.message);
      return false;
    }
    return true;
  }
  async getActorDetails(params) {
    try {
      const response = await this.supabase.from("rooms").select(
        `
          participants:participants(
            account:accounts(id, name, username, details)
          )
      `
      ).eq("id", params.roomId);
      if (response.error) {
        console.error("Error!" + response.error);
        return [];
      }
      const { data } = response;
      return data.map(
        (room) => room.participants.map((participant) => {
          const user = participant.account;
          return {
            name: user?.name,
            details: user?.details,
            id: user?.id,
            username: user?.username
          };
        })
      ).flat();
    } catch (error) {
      console.error("error", error);
      throw error;
    }
  }
  async searchMemories(params) {
    const result = await this.supabase.rpc("search_memories", {
      query_table_name: params.tableName,
      query_roomId: params.roomId,
      query_embedding: params.embedding,
      query_match_threshold: params.match_threshold,
      query_match_count: params.match_count,
      query_unique: params.unique
    });
    if (result.error) {
      throw new Error(JSON.stringify(result.error));
    }
    return result.data.map((memory) => ({
      ...memory
    }));
  }
  async getCachedEmbeddings(opts) {
    const result = await this.supabase.rpc("get_embedding_list", opts);
    if (result.error) {
      throw new Error(JSON.stringify(result.error));
    }
    return result.data;
  }
  async updateGoalStatus(params) {
    await this.supabase.from("goals").update({ status: params.status }).match({ id: params.goalId });
  }
  async log(params) {
    const { error } = await this.supabase.from("logs").insert({
      body: params.body,
      userId: params.userId,
      roomId: params.roomId,
      type: params.type
    });
    if (error) {
      console.error("Error inserting log:", error);
      throw new Error(error.message);
    }
  }
  async getMemories(params) {
    const query = this.supabase.from(params.tableName).select("*").eq("roomId", params.roomId);
    if (params.start) {
      query.gte("createdAt", params.start);
    }
    if (params.end) {
      query.lte("createdAt", params.end);
    }
    if (params.unique) {
      query.eq("unique", true);
    }
    if (params.agentId) {
      query.eq("agentId", params.agentId);
    }
    query.order("createdAt", { ascending: false });
    if (params.count) {
      query.limit(params.count);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`Error retrieving memories: ${error.message}`);
    }
    return data;
  }
  async searchMemoriesByEmbedding(embedding, params) {
    const queryParams = {
      query_table_name: params.tableName,
      query_roomId: params.roomId,
      query_embedding: embedding,
      query_match_threshold: params.match_threshold,
      query_match_count: params.count,
      query_unique: !!params.unique
    };
    if (params.agentId) {
      queryParams.query_agentId = params.agentId;
    }
    const result = await this.supabase.rpc("search_memories", queryParams);
    if (result.error) {
      throw new Error(JSON.stringify(result.error));
    }
    return result.data.map((memory) => ({
      ...memory
    }));
  }
  async getMemoryById(memoryId) {
    const { data, error } = await this.supabase.from("memories").select("*").eq("id", memoryId).single();
    if (error) {
      console.error("Error retrieving memory by ID:", error);
      return null;
    }
    return data;
  }
  async createMemory(memory, tableName, unique = false) {
    const createdAt = memory.createdAt ?? Date.now();
    if (unique) {
      const opts = {
        // TODO: Add ID option, optionally
        query_table_name: tableName,
        query_userId: memory.userId,
        query_content: memory.content.text,
        query_roomId: memory.roomId,
        query_embedding: memory.embedding,
        query_createdAt: createdAt,
        similarity_threshold: 0.95
      };
      const result = await this.supabase.rpc(
        "check_similarity_and_insert",
        opts
      );
      if (result.error) {
        throw new Error(JSON.stringify(result.error));
      }
    } else {
      const result = await this.supabase.from("memories").insert({ ...memory, createdAt, type: tableName });
      const { error } = result;
      if (error) {
        throw new Error(JSON.stringify(error));
      }
    }
  }
  async removeMemory(memoryId) {
    const result = await this.supabase.from("memories").delete().eq("id", memoryId);
    const { error } = result;
    if (error) {
      throw new Error(JSON.stringify(error));
    }
  }
  async removeAllMemories(roomId, tableName) {
    const result = await this.supabase.rpc("remove_memories", {
      query_table_name: tableName,
      query_roomId: roomId
    });
    if (result.error) {
      throw new Error(JSON.stringify(result.error));
    }
  }
  async countMemories(roomId, unique = true, tableName) {
    if (!tableName) {
      throw new Error("tableName is required");
    }
    const query = {
      query_table_name: tableName,
      query_roomId: roomId,
      query_unique: !!unique
    };
    const result = await this.supabase.rpc("count_memories", query);
    if (result.error) {
      throw new Error(JSON.stringify(result.error));
    }
    return result.data;
  }
  async getGoals(params) {
    const opts = {
      query_roomId: params.roomId,
      query_userId: params.userId,
      only_in_progress: params.onlyInProgress,
      row_count: params.count
    };
    const { data: goals, error } = await this.supabase.rpc(
      "get_goals",
      opts
    );
    if (error) {
      throw new Error(error.message);
    }
    return goals;
  }
  async updateGoal(goal) {
    const { error } = await this.supabase.from("goals").update(goal).match({ id: goal.id });
    if (error) {
      throw new Error(`Error creating goal: ${error.message}`);
    }
  }
  async createGoal(goal) {
    const { error } = await this.supabase.from("goals").insert(goal);
    if (error) {
      throw new Error(`Error creating goal: ${error.message}`);
    }
  }
  async removeGoal(goalId) {
    const { error } = await this.supabase.from("goals").delete().eq("id", goalId);
    if (error) {
      throw new Error(`Error removing goal: ${error.message}`);
    }
  }
  async removeAllGoals(roomId) {
    const { error } = await this.supabase.from("goals").delete().eq("roomId", roomId);
    if (error) {
      throw new Error(`Error removing goals: ${error.message}`);
    }
  }
  async getRoomsForParticipant(userId) {
    const { data, error } = await this.supabase.from("participants").select("roomId").eq("userId", userId);
    if (error) {
      throw new Error(
        `Error getting rooms by participant: ${error.message}`
      );
    }
    return data.map((row) => row.roomId);
  }
  async getRoomsForParticipants(userIds) {
    const { data, error } = await this.supabase.from("participants").select("roomId").in("userId", userIds);
    if (error) {
      throw new Error(
        `Error getting rooms by participants: ${error.message}`
      );
    }
    return [...new Set(data.map((row) => row.roomId))];
  }
  async createRoom(roomId) {
    roomId = roomId ?? uuid();
    const { data, error } = await this.supabase.rpc("create_room", {
      roomId
    });
    if (error) {
      throw new Error(`Error creating room: ${error.message}`);
    }
    if (!data || data.length === 0) {
      throw new Error("No data returned from room creation");
    }
    return data[0].id;
  }
  async removeRoom(roomId) {
    const { error } = await this.supabase.from("rooms").delete().eq("id", roomId);
    if (error) {
      throw new Error(`Error removing room: ${error.message}`);
    }
  }
  async addParticipant(userId, roomId) {
    const { error } = await this.supabase.from("participants").insert({ userId, roomId });
    if (error) {
      console.error(`Error adding participant: ${error.message}`);
      return false;
    }
    return true;
  }
  async removeParticipant(userId, roomId) {
    const { error } = await this.supabase.from("participants").delete().eq("userId", userId).eq("roomId", roomId);
    if (error) {
      console.error(`Error removing participant: ${error.message}`);
      return false;
    }
    return true;
  }
  async createRelationship(params) {
    const allRoomData = await this.getRoomsForParticipants([
      params.userA,
      params.userB
    ]);
    let roomId;
    if (!allRoomData || allRoomData.length === 0) {
      const { data: newRoomData, error: roomsError } = await this.supabase.from("rooms").insert({}).single();
      if (roomsError) {
        throw new Error("Room creation error: " + roomsError.message);
      }
      roomId = newRoomData?.id;
    } else {
      roomId = allRoomData[0];
    }
    const { error: participantsError } = await this.supabase.from("participants").insert([
      { userId: params.userA, roomId },
      { userId: params.userB, roomId }
    ]);
    if (participantsError) {
      throw new Error(
        "Participants creation error: " + participantsError.message
      );
    }
    const { error: relationshipError } = await this.supabase.from("relationships").upsert({
      userA: params.userA,
      userB: params.userB,
      userId: params.userA,
      status: "FRIENDS"
    }).eq("userA", params.userA).eq("userB", params.userB);
    if (relationshipError) {
      throw new Error(
        "Relationship creation error: " + relationshipError.message
      );
    }
    return true;
  }
  async getRelationship(params) {
    const { data, error } = await this.supabase.rpc("get_relationship", {
      usera: params.userA,
      userb: params.userB
    });
    if (error) {
      throw new Error(error.message);
    }
    return data[0];
  }
  async getRelationships(params) {
    const { data, error } = await this.supabase.from("relationships").select("*").or(`userA.eq.${params.userId},userB.eq.${params.userId}`).eq("status", "FRIENDS");
    if (error) {
      throw new Error(error.message);
    }
    return data;
  }
};
export {
  SupabaseDatabaseAdapter
};
//# sourceMappingURL=index.js.map