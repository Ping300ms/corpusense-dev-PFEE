import {
  REALTIME_SUBSCRIBE_STATES,
  RealtimePostgresDeletePayload,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  SupabaseClient, User,
} from '@supabase/supabase-js';
import {
  SupabaseListenerProperties
} from '@/data/repositories/supabase/SupabaseListenerProperties.ts';
import Backup from '@/data/models/Backup.ts';
import { BackupShares } from '@/data/models/BackupShares.ts';

/**
 * Enum representing the possible states of the listener.
 */
export enum ListenerState {
  DISCONNECTED = 'disconnected',
  SUBSCRIBING = 'subscribing',
  SUBSCRIBED = 'subscribed',
}

/**
 * Handles real-time Supabase subscriptions with built-in
 * automatic reconnection logic (exponential backoff).
 */
export class SupabaseRealtimeListener {
  private readonly backoffMultiplier: number;
  private readonly baseRetryDelay: number;
  private channel: null | ReturnType<typeof this.supabaseClient.channel> = null;
  private readonly channelBaseName: string;
  private readonly databaseSchemaName: string;
  private isRetrying = false;
  private readonly maxRetries: number;
  private readonly maxRetryDelay: number;
  private readonly onInsert?: (payload: RealtimePostgresInsertPayload<Backup>) => void | Promise<void>;
  private readonly onUpdate?: (payload: RealtimePostgresUpdatePayload<Backup>) => void | Promise<void>;
  private readonly onDelete?: (payload: RealtimePostgresDeletePayload<Backup>) => void | Promise<void>;
  private readonly onSubscribed?: () => void | Promise<void>;
  private readonly onShared?: (payload: RealtimePostgresInsertPayload<BackupShares>) => void | Promise<void>;
  private retryCount: number;
  private retryTimeout: ReturnType<typeof setTimeout> | undefined;
  private readonly supabaseClient: Pick<SupabaseClient, 'channel' | 'removeChannel' | 'auth'>;
  private readonly tableName: string;
  private listenerState: ListenerState = ListenerState.DISCONNECTED;

  /**
   * Initializes a new instance of the real-time listener.
   * @param properties Configuration properties for the listener.
   */
  constructor({
                backoffMultiplier = 2,
                baseRetryDelay = 2_000,
                channelBaseName,
                databaseSchemaName = 'public',
                maxRetries = 10,
                maxRetryDelay = 32_000,
                onInsert,
                onUpdate,
                onDelete,
                onSubscribed,
                onShared,
                retryCount = 0,
                supabaseClient,
                tableName,
              }: SupabaseListenerProperties) {
    this.maxRetries = maxRetries
    this.baseRetryDelay = baseRetryDelay
    this.maxRetryDelay = maxRetryDelay
    this.backoffMultiplier = backoffMultiplier
    this.retryCount = retryCount
    this.tableName = tableName
    this.onInsert = onInsert
    this.onUpdate = onUpdate;
    this.onDelete = onDelete;
    this.onSubscribed = onSubscribed;
    this.onShared = onShared;
    this.channelBaseName = channelBaseName
    this.supabaseClient = supabaseClient
    this.databaseSchemaName = databaseSchemaName
  }

  /**
   * Removes the existing channel, cleans up internal state, and resets retry attempts.
   * @returns A promise that resolves once the channel is successfully removed.
   */
  public removeExistingChannel = async () => {
    if (!this.channel) return

    try {
      await this.supabaseClient.removeChannel(this.channel)
      console.info(`Realtime channel (${this.channel.topic}) cleaned up`);
    } catch (error) {
      console.error(`Error cleaning up old channel:`, error)
    } finally {
      this.channel = null
      this.listenerState = ListenerState.DISCONNECTED;
      this.resetRetries();
    }
  }

  /**
   * Resets internal variables related to reconnection attempts.
   */
  private resetRetries = () => {
    this.isRetrying = false
    this.retryCount = 0

    clearTimeout(this.retryTimeout)
    this.retryTimeout = undefined
  }

  /**
   * Manages the exponential backoff logic for reconnection.
   * Calculates the delay based on the current retry count and schedules a new subscription attempt.
   */
  private retryToSubscribe = () => {
    this.isRetrying = true
    this.retryCount += 1

    if (this.retryCount > this.maxRetries) {
      // console.error(`Max retries (${this.maxRetries}) exceeded`)
      return
    }

    const delay = Math.min(this.baseRetryDelay * Math.pow(this.backoffMultiplier, this.retryCount - 1), this.maxRetryDelay)

    // console.info(`Retry attempt ${this.retryCount} in ${Math.round(delay / 1000)}s`)

    clearTimeout(this.retryTimeout);
    this.retryTimeout = setTimeout(() => {
      this.isRetrying = false
      void this.subscribe()
    }, delay)
  }

  /**
   * Initializes the Supabase channel subscription.
   * Verifies user authentication, configures event listeners (INSERT, UPDATE, DELETE, SHARE),
   * and starts the subscription process.
   * @returns A promise that resolves after initialization.
   */
  subscribe = async () => {
    if (this.listenerState === ListenerState.SUBSCRIBING ||
      this.listenerState === ListenerState.SUBSCRIBED) return; // prevent multiple subscribe
    this.listenerState = ListenerState.SUBSCRIBING;

    await this.removeExistingChannel()
    console.info('Creating new realtime subscription...')

    let i = 0;
    let user: User | null = null;
    while (user == null && i < 5) {
      user = (await this.supabaseClient.auth.getUser()).data.user;
      i++;
    }

    if (user === null) {
      console.warn("User not set");
      return;
    }

    // Add Date.now() to exclude collision between retries
    const channelName = `${this.channelBaseName}-${Date.now()}`

    console.info(`Channel name is: ${channelName}`)

    this.channel = this.supabaseClient.channel(channelName)

    this.channel
      .on<Backup>('postgres_changes',
        { event: 'INSERT', schema: this.databaseSchemaName, table: this.tableName },
        (payload: RealtimePostgresInsertPayload<Backup>) => {
        void this.onInsert?.(payload);
      })
      .on<Backup>(
        'postgres_changes',
        { event: 'UPDATE', schema: this.databaseSchemaName, table: this.tableName },
        (payload: RealtimePostgresUpdatePayload<Backup>) => {
          void this.onUpdate?.(payload);
        },
      )
      .on<Backup>(
        'postgres_changes',
        { event: 'DELETE', schema: this.databaseSchemaName, table: this.tableName },
        (payload: RealtimePostgresDeletePayload<Backup>) => {
          void this.onDelete?.(payload);
        },
      )
      .on<BackupShares>(
        'postgres_changes',
        { event: 'INSERT', schema: this.databaseSchemaName, table: this.tableName+'_shares' },
        (payload: RealtimePostgresInsertPayload<BackupShares>) => {
          void this.onShared?.(payload);
        },
      )
      .subscribe((status, error) => {
        return this.subscribeStateHandler(status, error);
      })
  }

  /**
   * Handles changes in the Supabase subscription status.
   * Triggers the retry procedure if the connection is lost or encounters an error.
   * @param status The new subscription status provided by Supabase.
   * @param error The error object returned by the Realtime client, if any.
   */
  private subscribeStateHandler(status: REALTIME_SUBSCRIBE_STATES, error?: Error) {
    console.info(`Channel status: ${status}`)

    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
      console.info('Realtime subscription established')
      this.listenerState = ListenerState.SUBSCRIBED;
      this.resetRetries();
      void this.onSubscribed?.();
      return
    }

    if (this.isRetrying) {
      console.warn(`Skipping retry due to: isRetrying = ${this.isRetrying}`)

      return
    }

    if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
      console.error("Can't subscribe on channel:", error)
    }

    if (
      status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
      status === REALTIME_SUBSCRIBE_STATES.CLOSED ||
      status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
    ) {
      this.listenerState = ListenerState.DISCONNECTED;
      this.retryToSubscribe()
    }
  }

  /**
   * Returns the current state of the listener.
   * @returns Current state: DISCONNECTED, SUBSCRIBING, or SUBSCRIBED.
   */
  public getState(): ListenerState {
    return this.listenerState;
  }
}
