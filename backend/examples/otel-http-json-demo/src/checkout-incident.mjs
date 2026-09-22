// Display copy only. Unique metric names and run-token attributes still isolate runs.
export const checkoutIncident = Object.freeze({
  title: "Checkout failures detected",
  logMessage: "Checkout failed because inventory is unavailable.",
  metricDescription: "Number of checkout failures recorded by the demo application.",
});

export function checkoutDemoRule(metricName, applicationId) {
  return {
    name: checkoutIncident.title,
    applicationId,
    type: "metric_threshold",
    enabled: true,
    config: {
      metricName,
      service: "demo-checkout",
      operator: ">=",
      threshold: 1,
      windowMinutes: 5,
      recoveryWindowMinutes: 5,
      stalenessMinutes: 5,
    },
  };
}
