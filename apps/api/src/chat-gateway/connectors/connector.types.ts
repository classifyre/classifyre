/**
 * A live connection to one chat platform bot. Implementations own their
 * receive loop (long-polling or socket) and reply routing; the gateway
 * service owns their lifecycle.
 */
export interface ChatConnector {
  start(): Promise<void>;
  stop(): Promise<void>;
}
