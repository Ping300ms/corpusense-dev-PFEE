/* eslint-disable */
import {
  REALTIME_SUBSCRIBE_STATES,
  RealtimePostgresDeletePayload,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  SupabaseClient,
} from '@supabase/supabase-js';
import {
  SupabaseListenerProperties
} from '@/data/repositories/supabase/SupabaseListenerProperties.ts';

enum ListenerState {
  DISCONNECTED = 'disconnected',
  SUBSCRIBING = 'subscribing',
  SUBSCRIBED = 'subscribed',
}

export class SupabaseRealtimeListener<TableType extends { [key: string]: any }> {
  private readonly backoffMultiplier: number;
  private readonly baseRetryDelay: number;
  private channel: null | ReturnType<typeof this.supabaseClient.channel> = null;
  private readonly channelBaseName: string;
  private readonly databaseSchemaName: string;
  private isRetrying = false;
  private readonly maxRetries: number;
  private readonly maxRetryDelay: number;
  private readonly onInsert?: (payload: RealtimePostgresInsertPayload<TableType>) => void | Promise<void>;
  private readonly onUpdate?: (payload: RealtimePostgresUpdatePayload<TableType>) => void | Promise<void>;
  private readonly onDelete?: (payload: RealtimePostgresDeletePayload<TableType>) => void | Promise<void>;
  private readonly onSubscribed?: () => void | Promise<void>;
  private retryCount: number;
  private retryTimeout: ReturnType<typeof setTimeout> | undefined;
  private readonly supabaseClient: Pick<SupabaseClient, 'channel' | 'removeChannel' | 'auth'>;
  private readonly tableName: string;
  private listenerState: ListenerState = ListenerState.DISCONNECTED;

  constructor({
                backoffMultiplier = 1.5,
                baseRetryDelay = 30_000,
                channelBaseName,
                databaseSchemaName = 'public',
                maxRetries = 10,
                maxRetryDelay = 300_000,
                onInsert,
                onUpdate,
                onDelete,
                onSubscribed,
                retryCount = 0,
                supabaseClient,
                tableName,
              }: SupabaseListenerProperties<TableType>) {
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
    this.channelBaseName = channelBaseName
    this.supabaseClient = supabaseClient
    this.databaseSchemaName = databaseSchemaName
  }

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
    }
  }

  private resetRetries = () => {
    this.isRetrying = false
    this.retryCount = 0

    clearTimeout(this.retryTimeout)
    this.retryTimeout = undefined
  }

  private retryToSubscribe = async () => {
    this.isRetrying = true
    this.retryCount += 1

    if (this.retryCount > this.maxRetries) {
      console.error(`Max retries (${this.maxRetries}) exceeded`)

      return
    }

    const delay = Math.min(this.baseRetryDelay * Math.pow(this.backoffMultiplier, this.retryCount - 1), this.maxRetryDelay)

    console.warn(`Retry attempt ${this.retryCount} in ${Math.round(delay / 1000)}s`)

    clearTimeout(this.retryTimeout)
    this.retryTimeout = setTimeout(() => {
      this.isRetrying = false
      this.subscribe()
    }, delay)
  }

  subscribe = async () => {
    if (this.listenerState === ListenerState.SUBSCRIBING ||
      this.listenerState === ListenerState.SUBSCRIBED) return; // prevent multiple subscribe
    this.listenerState = ListenerState.SUBSCRIBING;

    await this.removeExistingChannel()
    console.info('Creating new realtime subscription...')

    const user = (await this.supabaseClient.auth.getUser()).data.user;
    if (user === null) {
      console.log('User is not authenticated');
      this.resetRetries();
      return; // simply cancel, will retry to subscribe when Auth State change in SyncManager
    }

    // Add Date.now() to exclude collision between retries
    const channelName = `${this.channelBaseName}-${Date.now()}`

    console.info(`Channel name is: ${channelName}`)

    this.channel = this.supabaseClient.channel(channelName)

    this.channel
      .on<TableType>('postgres_changes',
        { event: 'INSERT', schema: this.databaseSchemaName, table: this.tableName, filter: `user_id=eq.${user.id}` },
        (payload: RealtimePostgresInsertPayload<TableType>) => {
        console.info('Insert received:', payload)
        void this.onInsert?.(payload);
      })
      .on<TableType>(
        'postgres_changes',
        { event: 'UPDATE', schema: this.databaseSchemaName, table: this.tableName, filter: `user_id=eq.${user.id}` },
        (payload: RealtimePostgresUpdatePayload<TableType>) => {
          console.info('Update received:', payload)
          void this.onUpdate?.(payload);
        },
      )
      .on<TableType>(
        'postgres_changes',
        { event: 'DELETE', schema: this.databaseSchemaName, table: this.tableName, filter: `user_id=eq.${user.id}` },
        (payload: RealtimePostgresDeletePayload<TableType>) => {
          console.info('Delete received:', payload)
          void this.onDelete?.(payload);
        },
      )
      .subscribe(async (status, error) => {
        return this.subscribeStateHandler(status, error);
      })
  }

  private async subscribeStateHandler(status: REALTIME_SUBSCRIBE_STATES, error?: Error) {
    console.info(`Channel status: ${status}`)

    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
      console.info('Realtime subscription established')
      this.listenerState = ListenerState.SUBSCRIBED;
      this.resetRetries();
      this.onSubscribed?.();
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
      await this.retryToSubscribe()
    }
  }
}
