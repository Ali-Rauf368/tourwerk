import type { Config } from './config';
import type { Db } from './db/prisma';
import type { ErpExporter } from './erp/exporter';
import type { Optimizer } from './optimizer';
import type { EtaService } from './services/eta';
import type { Notify } from './services/notify';
import type { TourService } from './services/tours';
import type { FleetSimulator } from './sim/fleet';
import type { TelemetryStore } from './telemetry/store';

export interface Deps {
  config: Config;
  db: Db;
  optimizer: Optimizer;
  telemetry: TelemetryStore;
  erp: ErpExporter;
  notify: Notify;
  tours: TourService;
  sim: FleetSimulator;
  eta: EtaService;
}

export type Guard = Record<'driver' | 'dispatcher' | 'admin', import('express').RequestHandler>;
