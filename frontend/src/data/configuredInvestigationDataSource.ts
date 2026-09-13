import { runtimeConfig } from "../config/runtimeConfig";
import { HttpAlertLifecycleDataSource } from "./alertLifecycleDataSource";
import { HttpAlertListDataSource } from "./alertListDataSource";
import { HttpInvestigationDataSource } from "./httpInvestigationDataSource";
import { HttpInvestigationNarrativeDataSource } from "./investigationNarrativeDataSource";
import {
  fixtureInvestigationDataSource,
  type InvestigationDataSource,
} from "./investigationDataSource";

export const usesFixtureData = runtimeConfig.dataSourceMode === "fixture";
export const configuredAlertListDataSource = new HttpAlertListDataSource(runtimeConfig.apiBaseUrl);
export const configuredAlertLifecycleDataSource = new HttpAlertLifecycleDataSource(runtimeConfig.apiBaseUrl);
export const liveInvestigationDataSource = new HttpInvestigationDataSource(runtimeConfig.apiBaseUrl);

export const configuredInvestigationDataSource: InvestigationDataSource =
  usesFixtureData
    ? fixtureInvestigationDataSource
    : new HttpInvestigationDataSource(runtimeConfig.apiBaseUrl);
export const configuredInvestigationNarrativeDataSource =
  new HttpInvestigationNarrativeDataSource(runtimeConfig.apiBaseUrl);
