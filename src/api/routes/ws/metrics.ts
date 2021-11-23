import * as prom from 'prom-client';
import { Topic } from '@stacks/stacks-blockchain-api-types';

export type WebSocketMetricsPrefix = 'socket_io' | 'websocket';

interface WebSocketMetrics {
  subscriptions: prom.Gauge<string>;
  connectTotal: prom.Counter<string>;
  disconnectTotal: prom.Counter<string>;
  eventsSent: prom.Counter<string>;
}

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
