import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseFeature,
  serializeFeature,
  parseRunArtifact,
  serializeRunArtifact,
  parsePlanArtifact,
  validateDAG,
  parseResearchTask,
  serializeResearchTask,
  parseSpecification,
  serializeSpecification,
  parseExecutionTask,
  serializeExecutionTask,
  parseContextDocument,
  serializeContextDocument,
  parseRateLimitEnvelope,
  serializeRateLimitEnvelope,
  parseApprovalRecord,
  serializeApprovalRecord,
  parseDeploymentRecord,
  serializeDeploymentRecord,
  parseIntegrationCredential,
  parseAgentProviderCapability,
  parseNotificationEvent,
  parseArtifactBundle,
  parseTraceLink,
} from '../../../src/core/models';
import type {
  Feature,
  RunArtifact,
  PlanArtifact,
  ResearchTask,
  Specification,
  ExecutionTask,
  ContextDocument,
  RateLimitEnvelope,
  ApprovalRecord,
  DeploymentRecord,
  IntegrationCredential,
  AgentProviderCapability,
  NotificationEvent,
  ArtifactBundle,
  TraceLink,
} from '../../../src/core/models';

type ModelFixtures = {
  feature_pending: Feature;
  feature_in_progress: Feature;
  run_artifact: RunArtifact;
  plan_artifact: PlanArtifact;
  research_task_completed: ResearchTask;
  specification_approved: Specification;
  execution_task_running: ExecutionTask;
  execution_task_failed: ExecutionTask;
  context_document: ContextDocument;
  rate_limit_envelope: RateLimitEnvelope;
  approval_record: ApprovalRecord;
  deployment_record: DeploymentRecord;
  integration_credential: IntegrationCredential;
  agent_provider_capability: AgentProviderCapability;
  notification_event: NotificationEvent;
  artifact_bundle: ArtifactBundle;
  trace_link: TraceLink;
};

type FixturesFile = {
  fixtures: ModelFixtures;
};

function isFixturesFile(value: unknown): value is FixturesFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const fixturesValue = (value as { fixtures?: unknown }).fixtures;
  return Boolean(fixturesValue && typeof fixturesValue === 'object');
}

// Load fixtures
const fixturesPath = path.join(__dirname, '../../fixtures/model_samples.json');
const fixturesContent = fs.readFileSync(fixturesPath, 'utf-8');
const parsedFixtures: unknown = JSON.parse(fixturesContent);

if (!isFixturesFile(parsedFixtures)) {
  throw new Error('Invalid model fixtures file structure');
}

const fixtures: ModelFixtures = parsedFixtures.fixtures;

describe('Feature Model Serialization', () => {
  it('should parse valid feature_pending fixture', () => {
    const result = parseFeature(fixtures.feature_pending);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.feature_id).toBe('01JDQX7Y8Z9A1B2C3D4E5F6G7H');
      expect(result.data.status).toBe('pending');
      expect(result.data.execution.completed_steps).toBe(0);
    }
  });

  it('should parse valid feature_in_progress fixture', () => {
    const result = parseFeature(fixtures.feature_in_progress);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('in_progress');
      expect(result.data.execution.completed_steps).toBe(3);
      expect(result.data.execution.total_steps).toBe(10);
      expect(result.data.execution.current_step).toBe('code_generation');
    }
  });

  it('should serialize and deserialize feature without data loss', () => {
    const originalData = fixtures.feature_in_progress;
    const parseResult = parseFeature(originalData);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const serialized = serializeFeature(parseResult.data);
      const reparsed = parseFeature(JSON.parse(serialized));
      expect(reparsed.success).toBe(true);

      if (reparsed.success) {
        expect(reparsed.data).toEqual(parseResult.data);
      }
    }
  });

  it('should reject invalid feature with missing required fields', () => {
    const invalid = { schema_version: '1.0.0' }; // Missing feature_id and other required fields
    const result = parseFeature(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.path.includes('feature_id'))).toBe(true);
    }
  });

  it('should reject feature with invalid schema_version format', () => {
    const invalid = { ...fixtures.feature_pending, schema_version: 'invalid' };
    const result = parseFeature(invalid);
    expect(result.success).toBe(false);
  });
});

describe('RunArtifact Model Serialization', () => {
  it('should parse valid run_artifact fixture', () => {
    const result = parseRunArtifact(fixtures.run_artifact);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.feature_id).toBe('01JDQX7Y8Z9A1B2C3D4E5F6G7H');
      expect(Object.keys(result.data.artifacts).length).toBe(3);
      expect(result.data.artifacts.prd.artifact_type).toBe('prd');
    }
  });

  it('should serialize and deserialize run_artifact without data loss', () => {
    const originalData = fixtures.run_artifact;
    const parseResult = parseRunArtifact(originalData);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const serialized = serializeRunArtifact(parseResult.data);
      const reparsed = parseRunArtifact(JSON.parse(serialized));
      expect(reparsed.success).toBe(true);

      if (reparsed.success) {
        expect(reparsed.data).toEqual(parseResult.data);
      }
    }
  });

  it('should reject artifact with invalid SHA-256 hash', () => {
    const invalid = {
      ...fixtures.run_artifact,
      artifacts: {
        prd: {
          ...fixtures.run_artifact.artifacts.prd,
          hash: 'invalid-hash',
        },
      },
    };
    const result = parseRunArtifact(invalid);
    expect(result.success).toBe(false);
  });
});

describe('PlanArtifact Model Serialization', () => {
  it('should parse valid plan_artifact fixture', () => {
    const result = parsePlanArtifact(fixtures.plan_artifact);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tasks.length).toBe(3);
      expect(result.data.dag_metadata.total_tasks).toBe(3);
    }
  });

  it('should validate DAG structure without cycles', () => {
    const parseResult = parsePlanArtifact(fixtures.plan_artifact);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const validation = validateDAG(parseResult.data);
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    }
  });

  it('should detect DAG cycles', () => {
    const cyclicPlan = {
      ...fixtures.plan_artifact,
      tasks: [
        { task_id: 'A', title: 'Task A', task_type: 'test', dependencies: [{ task_id: 'B', type: 'required' }] },
        { task_id: 'B', title: 'Task B', task_type: 'test', dependencies: [{ task_id: 'A', type: 'required' }] },
      ],
    };
    const parseResult = parsePlanArtifact(cyclicPlan);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const validation = validateDAG(parseResult.data);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Cycle'))).toBe(true);
    }
  });

  it('should detect invalid dependency references', () => {
    const invalidPlan = {
      ...fixtures.plan_artifact,
      tasks: [
        {
          task_id: 'task-001',
          title: 'Task 1',
          task_type: 'test',
          dependencies: [{ task_id: 'non-existent', type: 'required' }],
        },
      ],
    };
    const parseResult = parsePlanArtifact(invalidPlan);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const validation = validateDAG(parseResult.data);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('non-existent'))).toBe(true);
    }
  });
});

describe('ResearchTask Model Serialization', () => {
  it('should parse valid research_task_completed fixture', () => {
    const result = parseResearchTask(fixtures.research_task_completed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('completed');
      expect(result.data.results?.confidence_score).toBe(0.9);
      expect(result.data.objectives.length).toBeGreaterThan(0);
    }
  });

  it('should serialize and deserialize research_task without data loss', () => {
    const originalData = fixtures.research_task_completed;
    const parseResult = parseResearchTask(originalData);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const serialized = serializeResearchTask(parseResult.data);
      const reparsed = parseResearchTask(JSON.parse(serialized));
      expect(reparsed.success).toBe(true);

      if (reparsed.success) {
        expect(reparsed.data).toEqual(parseResult.data);
      }
    }
  });

  it('should reject research task with empty objectives array', () => {
    const invalid = { ...fixtures.research_task_completed, objectives: [] };
    const result = parseResearchTask(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Specification Model Serialization', () => {
  it('should parse valid specification_approved fixture', () => {
    const result = parseSpecification(fixtures.specification_approved);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('approved');
      expect(result.data.reviewers.length).toBe(1);
      expect(result.data.reviewers[0].verdict).toBe('approved');
      expect(result.data.risks.length).toBeGreaterThan(0);
      expect(result.data.test_plan.length).toBeGreaterThan(0);
    }
  });

  it('should serialize and deserialize specification without data loss', () => {
    const originalData = fixtures.specification_approved;
    const parseResult = parseSpecification(originalData);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const serialized = serializeSpecification(parseResult.data);
      const reparsed = parseSpecification(JSON.parse(serialized));
      expect(reparsed.success).toBe(true);

      if (reparsed.success) {
        expect(reparsed.data).toEqual(parseResult.data);
      }
    }
  });
});

describe('ExecutionTask Model Serialization', () => {
  it('should parse valid execution_task_running fixture', () => {
    const result = parseExecutionTask(fixtures.execution_task_running);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('running');
      expect(result.data.task_type).toBe('code_generation');
      expect(result.data.cost?.total_usd).toBe(0.15);
      expect(result.data.rate_limit_budget?.provider).toBe('openai');
    }
  });

  it('should parse valid execution_task_failed fixture', () => {
    const result = parseExecutionTask(fixtures.execution_task_failed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('failed');
      expect(result.data.last_error).toBeDefined();
      expect(result.data.last_error?.recoverable).toBe(true);
      expect(result.data.retry_count).toBe(2);
    }
  });

  it('should serialize and deserialize execution_task without data loss', () => {
    const originalData = fixtures.execution_task_running;
    const parseResult = parseExecutionTask(originalData);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const serialized = serializeExecutionTask(parseResult.data);
      const reparsed = parseExecutionTask(JSON.parse(serialized));
      expect(reparsed.success).toBe(true);

      if (reparsed.success) {
        expect(reparsed.data).toEqual(parseResult.data);
      }
    }
  });
});

describe('ContextDocument Model Serialization', () => {
  it('should parse valid context_document fixture', () => {
    const result = parseContextDocument(fixtures.context_document);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total_token_count).toBe(2100);
      expect(Object.keys(result.data.files).length).toBe(2);
      expect(result.data.provenance.commit_sha).toBeDefined();
    }
  });

  it('should serialize and deserialize context_document without data loss', () => {
    const originalData = fixtures.context_document;
    const parseResult = parseContextDocument(originalData);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const serialized = serializeContextDocument(parseResult.data);
      const reparsed = parseContextDocument(JSON.parse(serialized));
      expect(reparsed.success).toBe(true);

      if (reparsed.success) {
        expect(reparsed.data).toEqual(parseResult.data);
      }
    }
  });
});

describe('RateLimitEnvelope Model Serialization', () => {
  it('should parse valid rate_limit_envelope fixture', () => {
    const result = parseRateLimitEnvelope(fixtures.rate_limit_envelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe('openai');
      expect(result.data.remaining_requests).toBe(450);
      expect(result.data.total_requests).toBe(500);
    }
  });

  it('should serialize and deserialize rate_limit_envelope without data loss', () => {
    const originalData = fixtures.rate_limit_envelope;
    const parseResult = parseRateLimitEnvelope(originalData);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const serialized = serializeRateLimitEnvelope(parseResult.data);
      const reparsed = parseRateLimitEnvelope(JSON.parse(serialized));
      expect(reparsed.success).toBe(true);

      if (reparsed.success) {
        expect(reparsed.data).toEqual(parseResult.data);
      }
    }
  });
});

describe('ApprovalRecord Model Serialization', () => {
  it('should parse valid approval_record fixture', () => {
    const result = parseApprovalRecord(fixtures.approval_record);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gate_type).toBe('spec');
      expect(result.data.verdict).toBe('approved');
      expect(result.data.signer).toBe('alice@example.com');
    }
  });

  it('should serialize and deserialize approval_record without data loss', () => {
    const originalData = fixtures.approval_record;
    const parseResult = parseApprovalRecord(originalData);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const serialized = serializeApprovalRecord(parseResult.data);
      const reparsed = parseApprovalRecord(JSON.parse(serialized));
      expect(reparsed.success).toBe(true);

      if (reparsed.success) {
        expect(reparsed.data).toEqual(parseResult.data);
      }
    }
  });
});

describe('DeploymentRecord Model Serialization', () => {
  it('should parse valid deployment_record fixture', () => {
    const result = parseDeploymentRecord(fixtures.deployment_record);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('in_progress');
      expect(result.data.pr_number).toBe(456);
      expect(result.data.status_checks.length).toBe(2);
      expect(result.data.required_reviews.length).toBe(2);
    }
  });

  it('should serialize and deserialize deployment_record without data loss', () => {
    const originalData = fixtures.deployment_record;
    const parseResult = parseDeploymentRecord(originalData);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const serialized = serializeDeploymentRecord(parseResult.data);
      const reparsed = parseDeploymentRecord(JSON.parse(serialized));
      expect(reparsed.success).toBe(true);

      if (reparsed.success) {
        expect(reparsed.data).toEqual(parseResult.data);
      }
    }
  });
});

describe('Supporting Models Serialization', () => {
  it('should parse valid integration_credential fixture', () => {
    const result = parseIntegrationCredential(fixtures.integration_credential);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe('github');
      expect(result.data.auth_method).toBe('token');
    }
  });

  it('should parse valid agent_provider_capability fixture', () => {
    const result = parseAgentProviderCapability(fixtures.agent_provider_capability);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model_name).toBe('gpt-4o');
      expect(result.data.supports_tools).toBe(true);
    }
  });

  it('should parse valid notification_event fixture', () => {
    const result = parseNotificationEvent(fixtures.notification_event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe('slack');
      expect(result.data.delivery_status).toBe('delivered');
    }
  });

  it('should parse valid artifact_bundle fixture', () => {
    const result = parseArtifactBundle(fixtures.artifact_bundle);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.included_files.length).toBe(2);
      expect(result.data.cli_version).toBe('1.0.0');
    }
  });

  it('should parse valid trace_link fixture', () => {
    const result = parseTraceLink(fixtures.trace_link);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relationship).toBe('implements');
      expect(result.data.source_type).toBe('prd_goal');
      expect(result.data.target_type).toBe('spec_requirement');
    }
  });
});

describe('Immutability Tests', () => {
  it('should prevent mutation of Feature objects (TypeScript compile-time check)', () => {
    const parseResult = parseFeature(fixtures.feature_pending);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const feature = parseResult.data;
      // The following would fail TypeScript compilation due to Readonly type:
      // feature.status = 'completed'; // Error: Cannot assign to 'status' because it is a read-only property
      expect(feature.status).toBe('pending');
    }
  });

  it('should prevent mutation of ExecutionTask objects (TypeScript compile-time check)', () => {
    const parseResult = parseExecutionTask(fixtures.execution_task_running);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const task = parseResult.data;
      // The following would fail TypeScript compilation due to Readonly type:
      // task.status = 'completed'; // Error: Cannot assign to 'status' because it is a read-only property
      expect(task.status).toBe('running');
    }
  });
});
