import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ConsoleSpanExporter } from '@opentelemetry/tracing';
//import { CollectorTraceExporter } from '@opentelemetry/exporter-collector';

// const collectorOptions = {
//   url: '<opentelemetry-collector-url>', // url is optional and can be omitted - default is http://localhost:55681/v1/trace
//   concurrencyLimit: 10, // an optional limit on pending requests
// };

// const exporter = new CollectorTraceExporter(collectorOptions);

// change the ConsoleSpanExporter with the opentemetery exporter collector once Tempo DB url is provided
const exporter = new ConsoleSpanExporter();

const tracingSdk = new NodeSDK({
  traceExporter: exporter,
  instrumentations: [getNodeAutoInstrumentations()],
});

export default tracingSdk;
