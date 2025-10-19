/* eslint-disable */
import {
  RealtimePostgresDeletePayload,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  SupabaseClient,
} from '@supabase/supabase-js';

export interface SupabaseListenerProperties<TableType extends { [key: string]: any }> {
  /**
   * The multiplier of the exponential backoff between reconnection attempts
   * Default is `1.5`
   *
   * @example The result: 30s → 45s → 67.5s ...
   **/
  backoffMultiplier?: number
  /**
   * Basic delay (in milliseconds) before the first retry
   * Default is `30_000`ms
   */
  baseRetryDelay?: number
  /**
   * The base name of the channel
   */
  channelBaseName: string
  /**
   * The database schema to listen to
   * Default is `public`
   */
  databaseSchemaName?: string
  /**
   * The maximum number of reconnection attempts after which the service gives up
   * Default is `10`
   */
  maxRetries?: number
  /**
   * Upper limit of delay between attempts (in milliseconds). Used as a cap for backoff
   * Default is `300_000`ms.
   */
  maxRetryDelay?: number
  /**
   * INSERT event handler. Called for each payload
   */
  onInsert?: (payload: RealtimePostgresInsertPayload<TableType>) => void | Promise<void>;
  /**
   * UPDATE event handler. Called for each payload
   */
  onUpdate?: (payload: RealtimePostgresUpdatePayload<TableType>) => void | Promise<void>;
  /**
   * DELETE event handler. Called for each payload
   */
  onDelete?: (payload: RealtimePostgresDeletePayload<TableType>) => void | Promise<void>;
  /**
   * The number of reconnection attempts made since the last successful subscription
   */
  retryCount?: number
  /**
   * Supabase Client
   */
  supabaseClient: Pick<SupabaseClient, 'channel' | 'removeChannel' | 'auth'>
  /**
   * The database table to listen to
   */
  tableName: string
}