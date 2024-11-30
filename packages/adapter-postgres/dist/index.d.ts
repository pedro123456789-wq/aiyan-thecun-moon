import { Pool } from 'pg';
import { DatabaseAdapter, IDatabaseCacheAdapter, UUID, Participant, Memory, Account, Actor, Goal, Relationship, GoalStatus } from '@ai16z/eliza';

declare class PostgresDatabaseAdapter extends DatabaseAdapter<Pool> implements IDatabaseCacheAdapter {
    private pool;
    constructor(connectionConfig: any);
    init(): Promise<void>;
    testConnection(): Promise<boolean>;
    getRoom(roomId: UUID): Promise<UUID | null>;
    getParticipantsForAccount(userId: UUID): Promise<Participant[]>;
    getParticipantUserState(roomId: UUID, userId: UUID): Promise<"FOLLOWED" | "MUTED" | null>;
    getMemoriesByRoomIds(params: {
        roomIds: UUID[];
        agentId?: UUID;
        tableName: string;
    }): Promise<Memory[]>;
    setParticipantUserState(roomId: UUID, userId: UUID, state: "FOLLOWED" | "MUTED" | null): Promise<void>;
    getParticipantsForRoom(roomId: UUID): Promise<UUID[]>;
    getAccountById(userId: UUID): Promise<Account | null>;
    createAccount(account: Account): Promise<boolean>;
    getActorById(params: {
        roomId: UUID;
    }): Promise<Actor[]>;
    getMemoryById(id: UUID): Promise<Memory | null>;
    createMemory(memory: Memory, tableName: string): Promise<void>;
    searchMemories(params: {
        tableName: string;
        roomId: UUID;
        embedding: number[];
        match_threshold: number;
        match_count: number;
        unique: boolean;
    }): Promise<Memory[]>;
    getMemories(params: {
        roomId: UUID;
        count?: number;
        unique?: boolean;
        tableName: string;
        agentId?: UUID;
        start?: number;
        end?: number;
    }): Promise<Memory[]>;
    getGoals(params: {
        roomId: UUID;
        userId?: UUID | null;
        onlyInProgress?: boolean;
        count?: number;
    }): Promise<Goal[]>;
    updateGoal(goal: Goal): Promise<void>;
    createGoal(goal: Goal): Promise<void>;
    removeGoal(goalId: UUID): Promise<void>;
    createRoom(roomId?: UUID): Promise<UUID>;
    removeRoom(roomId: UUID): Promise<void>;
    createRelationship(params: {
        userA: UUID;
        userB: UUID;
    }): Promise<boolean>;
    getRelationship(params: {
        userA: UUID;
        userB: UUID;
    }): Promise<Relationship | null>;
    getRelationships(params: {
        userId: UUID;
    }): Promise<Relationship[]>;
    getCachedEmbeddings(opts: {
        query_table_name: string;
        query_threshold: number;
        query_input: string;
        query_field_name: string;
        query_field_sub_name: string;
        query_match_count: number;
    }): Promise<{
        embedding: number[];
        levenshtein_score: number;
    }[]>;
    log(params: {
        body: {
            [key: string]: unknown;
        };
        userId: UUID;
        roomId: UUID;
        type: string;
    }): Promise<void>;
    searchMemoriesByEmbedding(embedding: number[], params: {
        match_threshold?: number;
        count?: number;
        agentId?: UUID;
        roomId?: UUID;
        unique?: boolean;
        tableName: string;
    }): Promise<Memory[]>;
    addParticipant(userId: UUID, roomId: UUID): Promise<boolean>;
    removeParticipant(userId: UUID, roomId: UUID): Promise<boolean>;
    updateGoalStatus(params: {
        goalId: UUID;
        status: GoalStatus;
    }): Promise<void>;
    removeMemory(memoryId: UUID, tableName: string): Promise<void>;
    removeAllMemories(roomId: UUID, tableName: string): Promise<void>;
    countMemories(roomId: UUID, unique?: boolean, tableName?: string): Promise<number>;
    removeAllGoals(roomId: UUID): Promise<void>;
    getRoomsForParticipant(userId: UUID): Promise<UUID[]>;
    getRoomsForParticipants(userIds: UUID[]): Promise<UUID[]>;
    getActorDetails(params: {
        roomId: string;
    }): Promise<Actor[]>;
    getCache(params: {
        key: string;
        agentId: UUID;
    }): Promise<string | undefined>;
    setCache(params: {
        key: string;
        agentId: UUID;
        value: string;
    }): Promise<boolean>;
    deleteCache(params: {
        key: string;
        agentId: UUID;
    }): Promise<boolean>;
}

export { PostgresDatabaseAdapter, PostgresDatabaseAdapter as default };
