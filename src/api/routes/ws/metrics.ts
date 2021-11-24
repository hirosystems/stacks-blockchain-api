import * as prom from 'prom-client';
import * as WebSocket from 'ws';
import { Topic } from '@stacks/stacks-blockchain-api-types';
import { Socket } from 'socket.io';

export type WebSocketMetricsPrefix = 'socket_io' | 'websocket';

export type WebSocketSubscriber = WebSocket | Socket;

interface WebSocketMetrics {
  // Current number of active subscriptions (labeled by topic).
  subscriptions: prom.Gauge<string>;
  // Time spent subscribed to a particular topic.
  subscriptionTimers: prom.Histogram<string>;
  // Total connections.
  connectTotal: prom.Counter<string>;
  // Total connections by remote address.
  connectRemoteAddressTotal: prom.Counter<string>;
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
  // Record of all dates when a particular socket started observing an event. Useful for measuring
  // total subscription time.
  private subscriptions = new Map<WebSocketSubscriber, Map<string, Date>>();

  constructor(metricsNamePrefix: WebSocketMetricsPrefix) {
    this.metrics = {
      subscriptions: new prom.Gauge({
        name: `${metricsNamePrefix}_subscriptions`,
        help: 'Current subscriptions',
        labelNames: ['topic'],
      }),
      subscriptionTimers: new prom.Histogram({
        name: `${metricsNamePrefix}_subscription_timers`,
        help: 'Subscription timers',
        labelNames: ['topic'],
      }),
      connectTotal: new prom.Counter({
        name: `${metricsNamePrefix}_connect_total`,
        help: 'Total count of connection requests',
      }),
      connectRemoteAddressTotal: new prom.Counter({
        name: `${metricsNamePrefix}_connect_remote_address_total`,
        help: 'Total count of connection requests by remote address',
        labelNames: ['remoteAddress'],
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

  public connect(remoteAddress: string) {
    this.metrics.connectTotal.inc();
    this.metrics.connectRemoteAddressTotal.inc({
      remoteAddress: remoteAddress.split(',')[0].trim(),
    });
  }

  public disconnect(subscriber: WebSocketSubscriber) {
    this.doDisconnect(subscriber);
  }

  public subscribe(subscriber: WebSocketSubscriber, topic: Topic | Topic[] | string) {
    if (Array.isArray(topic)) {
      topic.forEach(t => this.doSubscribe(subscriber, t));
    } else {
      this.doSubscribe(subscriber, topic);
    }
  }

  public unsubscribe(subscriber: WebSocketSubscriber, topic: Topic | string) {
    this.doUnsubscribe(subscriber, topic);
  }

  public sendEvent(event: string) {
    this.metrics.eventsSent.inc({ event: event });
  }

  private doSubscribe(subscriber: WebSocketSubscriber, topic: Topic | Topic[] | string) {
    const topicStr = topic.toString();
    // Increase subscription count.
    this.metrics.subscriptions.inc({ topic: topicStr });
    // Record the subscription date.
    let map = this.subscriptions.get(subscriber);
    if (!map) {
      map = new Map();
      this.subscriptions.set(subscriber, map);
    }
    map.set(topicStr, new Date());
  }

  private doUnsubscribe(subscriber: WebSocketSubscriber, topic: Topic | string) {
    const topicStr = topic.toString();
    // Decrease subscription count.
    this.metrics.subscriptions.dec({ topic: topicStr });
    // Report total subscription duration.
    const map = this.subscriptions.get(subscriber);
    if (map) {
      const startDate = map.get(topicStr);
      if (startDate) {
        const elapsedSeconds = (new Date().getTime() - startDate.getTime()) / 1000;
        this.metrics.subscriptionTimers.observe({ topic: topicStr }, elapsedSeconds);
        map.delete(topicStr);
        if (map.size === 0) {
          this.subscriptions.delete(subscriber);
        }
      }
    }
  }

  private doDisconnect(subscriber: WebSocketSubscriber) {
    this.metrics.disconnectTotal.inc();
    // Also unsubscribe from every topic.
    const map = this.subscriptions.get(subscriber);
    if (map) {
      const topics = Array.from(map.keys());
      topics.forEach(topic => {
        this.doUnsubscribe(subscriber, topic);
      });
    }
  }
}
