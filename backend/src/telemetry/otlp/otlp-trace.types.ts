export type OtlpJsonInt64 = string | number;

export interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: OtlpJsonInt64;
  doubleValue?: number | string;
  arrayValue?: {
    values?: OtlpAnyValue[];
  };
  kvlistValue?: {
    values?: OtlpKeyValue[];
  };
  bytesValue?: string;
}

export interface OtlpKeyValue {
  key: string;
  value?: OtlpAnyValue;
}

export interface OtlpResource {
  attributes?: OtlpKeyValue[];
}

export interface OtlpSpanStatus {
  message?: string;
  code?: number;
}

export interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: OtlpJsonInt64;
  endTimeUnixNano?: OtlpJsonInt64;
  attributes?: OtlpKeyValue[];
  status?: OtlpSpanStatus;
}

export interface OtlpScopeSpans {
  spans?: OtlpSpan[];
}

export interface OtlpResourceSpans {
  resource?: OtlpResource;
  scopeSpans?: OtlpScopeSpans[];
}

export interface OtlpExportTraceServiceRequest {
  resourceSpans?: OtlpResourceSpans[];
}
