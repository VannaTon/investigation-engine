import { MetricDiscoveryRepository } from "../repository/metric-discovery.repository.js";
import { MetricDiscoveryService } from "../services/metric-discovery.service.js";

export const metricDiscoveryService = new MetricDiscoveryService(new MetricDiscoveryRepository());
