import assert from "node:assert/strict";

import {
  InvestigationNarrativeOutputParseError,
  parseInvestigationNarrativeOutput,
} from "../services/investigation-narrative-output-parser.service.js";

// --------------------------------------------------
// Case 1: valid output passes.
// --------------------------------------------------

{
  const result = parseInvestigationNarrativeOutput({
    summary: {
      text: "Postgres and auth-service both have supported failure evidence.",

      findingIds: ["finding:postgres"],

      signalIds: ["signal:trace-chain"],
    },

    candidates: [
      {
        candidateId: "candidate:postgres",

        text: "Postgres has trace failure evidence.",

        findingIds: ["finding:postgres"],

        signalIds: ["signal:trace-chain"],
      },
    ],
  });

  assert.equal(
    result.summary.text,
    "Postgres and auth-service both have supported failure evidence.",
  );

  assert.equal(result.candidates.length, 1);

  assert.equal(result.candidates[0]?.candidateId, "candidate:postgres");
}

// --------------------------------------------------
// Helper for rejection cases.
// --------------------------------------------------

function assertParseError(value: unknown, expectedPath: string): void {
  assert.throws(
    () => parseInvestigationNarrativeOutput(value),

    (error: unknown) => {
      assert.ok(error instanceof InvestigationNarrativeOutputParseError);

      assert.equal(error.path, expectedPath);

      return true;
    },
  );
}

// --------------------------------------------------
// Case 2: root must be object.
// --------------------------------------------------

assertParseError("not-an-object", "$");

// --------------------------------------------------
// Case 3: summary must exist and be object.
// --------------------------------------------------

assertParseError(
  {
    candidates: [],
  },
  "$.summary",
);

// --------------------------------------------------
// Case 4: summary text must be non-empty.
// --------------------------------------------------

assertParseError(
  {
    summary: {
      text: "   ",
      findingIds: [],
      signalIds: [],
    },

    candidates: [],
  },
  "$.summary.text",
);

// --------------------------------------------------
// Case 5: candidates must be an array.
// --------------------------------------------------

assertParseError(
  {
    summary: {
      text: "Valid summary",
      findingIds: [],
      signalIds: [],
    },

    candidates: null,
  },
  "$.candidates",
);

// --------------------------------------------------
// Case 6: candidateId must be non-empty.
// --------------------------------------------------

assertParseError(
  {
    summary: {
      text: "Valid summary",
      findingIds: [],
      signalIds: [],
    },

    candidates: [
      {
        candidateId: "",
        text: "Candidate explanation",
        findingIds: [],
        signalIds: [],
      },
    ],
  },
  "$.candidates[0].candidateId",
);

// --------------------------------------------------
// Case 7: findingIds must contain only strings.
// --------------------------------------------------

assertParseError(
  {
    summary: {
      text: "Valid summary",
      findingIds: [],
      signalIds: [],
    },

    candidates: [
      {
        candidateId: "candidate:postgres",

        text: "Candidate explanation",

        findingIds: ["finding:1", 123],

        signalIds: [],
      },
    ],
  },
  "$.candidates[0].findingIds[1]",
);

// --------------------------------------------------
// Case 8: signalIds must contain only strings.
// --------------------------------------------------

assertParseError(
  {
    summary: {
      text: "Valid summary",
      findingIds: [],
      signalIds: [],
    },

    candidates: [
      {
        candidateId: "candidate:postgres",

        text: "Candidate explanation",

        findingIds: [],

        signalIds: [true],
      },
    ],
  },
  "$.candidates[0].signalIds[0]",
);

// --------------------------------------------------
// Case 9:
// Empty references are structurally valid.
// Grounding validation handles that separately.
// --------------------------------------------------

{
  const result = parseInvestigationNarrativeOutput({
    summary: {
      text: "Structurally valid",
      findingIds: [],
      signalIds: [],
    },

    candidates: [],
  });

  assert.deepEqual(result.summary.findingIds, []);

  assert.deepEqual(result.summary.signalIds, []);
}

console.log("Investigation narrative output parser tests passed.");
