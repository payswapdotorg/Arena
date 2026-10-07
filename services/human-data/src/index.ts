/**
 * @arena/human-data-service barrel (Work Order C012; services/human-data):
 * the service, the ports, the reference fabric — one import surface,
 * exactly like the sibling services.
 */

export { HumanDataService } from './service.js';
export type {
  AssembleCommissionResult,
  HumanDataServiceConfig,
  ProductionProjection,
  ProductionProjectionRow,
} from './service.js';
export {
  HUMAN_DATA_EVENT_TYPES,
} from './ports.js';
export type {
  AcceptedDeliverableSource,
  Clock,
  CommissionStore,
  DeliverableSourcePort,
  EscalationPort,
  HumanDataEvent,
  HumanDataEventSink,
  HumanDataEventType,
} from './ports.js';
export {
  FixedClock,
  InMemoryCommissionStore,
  RecordingEventSink,
  ReferenceEscalationPort,
  ScriptedDeliverableSource,
  createHumanDataReferenceFabric,
} from './fabric.js';
export type { HumanDataReferenceFabric } from './fabric.js';
