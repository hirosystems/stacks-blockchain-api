import * as prom from 'prom-client';
import { Topic } from '@stacks/stacks-blockchain-api-types';

export type WebSocketMetricsPrefix = 'socket_io' | 'websocket';

interface WebSocketMetrics {
  // Current number of active subscriptions (labeled by topic).
  subscriptions: prom.Gauge<string>;
  // Total connections.
  connectTotal: prom.Counter<string>;
  // Total disconnections.
  disconnectTotal: prom.Counter<string>;
  // Total events sent (labeled by event type).
  eventsSent: prom.Counter<string>;
}

/**
 * Wrapper for `prom-client` that allows us to gather metrics for Socket.io and WebSocket usage.
 */
export class WebSocketPrometheus {
  private metrics: WebSocketMetrics;

  constructor(metricsNamePrefix: WebSocketMetricsPrefix) {
    this.metrics = {
      subscriptions: new prom.Gauge({
        name: `${metricsNamePrefix}_subscriptions`,
        help: 'Current subscriptions',
        labelNames: ['topic'],
      }),
      connectTotal: new prom.Counter({
        name: `${metricsNamePrefix}_connect_total`,
        help: 'Total count of connection requests',
      }),
      disconnectTotal: new prom.Counter({
        name: `${metricsNamePrefix}_disconnect_total`,
        help: 'Total count of disconnections',
      }),
      eventsSent: new prom.Counter({
        name: `${metricsNamePrefix}_events_sent`,
        help: 'Total count of sent events',
        labelNames: ['event'],
      }),
    };
  }

  public connect() {
    this.metrics.connectTotal.inc();
  }

  public disconnect() {
    this.metrics.disconnectTotal.inc();
  }

  public subscribe(topic: Topic | Topic[] | string) {
    if (Array.isArray(topic)) {
      topic.forEach(t => this.metrics.subscriptions.inc({ topic: t.toString() }));
    } else {
      this.metrics.subscriptions.inc({ topic: topic.toString() });
    }
  }

  public unsubscribe(topic: Topic | string) {
    this.metrics.subscriptions.dec({ topic: topic.toString() });
  }

  public sendEvent(event: string) {
    this.metrics.eventsSent.inc({ event: event });
  }
}
