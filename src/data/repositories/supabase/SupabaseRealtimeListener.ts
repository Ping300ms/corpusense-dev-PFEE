/* eslint-disable */
import {
  REALTIME_SUBSCRIBE_STATES,
  RealtimeChannel,
  RealtimePostgresDeletePayload,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  SupabaseClient,
} from '@supabase/supabase-js';

export interface OnRemoteChangeCallbacks<T> {
  onAdd?: (entity: T) => void | Promise<void>;
  onUpdate?: (entity: T) => void | Promise<void>;
  onDelete?: (entity: Partial<T>) => void | Promise<void>;
}

export class SupabaseRealtimeListener<T extends Record<string, any>> {
  private supabase: SupabaseClient;
  private callbacks: OnRemoteChangeCallbacks<T>;
  private channel: RealtimeChannel | null = null;

  constructor(supabase: SupabaseClient, callbacks: OnRemoteChangeCallbacks<T>) {
    this.supabase = supabase;
    this.callbacks = callbacks;

    void this.connect();
  }

  public async connect() {
    if (this.channel) return;

    const user = (await this.supabase.auth.getUser()).data.user;
    if (user === null) return;

    // Maybe split into multiple channels ?
    this.channel = this.supabase.channel('backup-changes');
    this.channel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'backup', filter: `user_id=eq.${user.id}` },
        (payload: RealtimePostgresInsertPayload<T>) => {
          void this.callbacks.onAdd?.(payload.new);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'backup', filter: `user_id=eq.${user.id}` },
        (payload: RealtimePostgresUpdatePayload<T>) => {
          void this.callbacks.onUpdate?.(payload.new);
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'backup', filter: `user_id=eq.${user.id}` },
        (payload: RealtimePostgresDeletePayload<T>) => {
          void this.callbacks.onDelete?.(payload.old);
        },
      )
      .subscribe((status, err) =>
        this.subscribeStateHandler(status, err)
      );
  }

  private subscribeStateHandler(status: REALTIME_SUBSCRIBE_STATES, err?: Error) {
    switch (status) {
      case REALTIME_SUBSCRIBE_STATES.SUBSCRIBED:
        console.log('[Realtime] SUBSCRIBED', err);
        break;
      case REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR:
        console.log('[Realtime] CHANNEL_ERROR', err);
        break;
      case REALTIME_SUBSCRIBE_STATES.TIMED_OUT:
        console.log('[Realtime] TIMED_OUT', err);
        void this.disconnect();
        break;
      case REALTIME_SUBSCRIBE_STATES.CLOSED:
        console.log('[Realtime] CLOSED', err);
        void this.disconnect();
        break;
    }
  }

  public async disconnect() {
    if (this.channel) {
      await this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  public async destroy() {
    if (this.channel) await this.disconnect();
  }
}
