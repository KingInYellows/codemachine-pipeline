import { Args, Command, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as os from 'node:os';
import { createCliLogger, LogLevel, type StructuredLogger } from '../../telemetry/logger';
import { createRunMetricsCollector, type MetricsCollector } from '../../telemetry/metrics';
import { createRunTraceManager } from '../../telemetry/traces';
import { getRunDirectoryPath, readManifest } from '../../persistence/runDirectoryManager';
import {
  grantApproval,
  denyApproval,
  computeArtifactHash,
  getApprovalHistory,
  getPendingApprovals,
  type GrantApprovalOptions,
  type DenyApprovalOptions,
} from '../../workflows/approvalRegistry';
import { ApprovalGateType } from '../../core/models/ApprovalRecord';
import { updateTraceMapOnSpecChange } from '../../workflows/traceabilityMapper';
import {
  resolveRunDirectorySettings,
  selectFeatureId,
  requireFeatureId,
  requireConfig,
} from '../utils/runDirectory';
import {
  CliError,
  CliErrorCode,
  formatErrorMessage,
  rethrowIfOclifError,
  setJsonOutputMode,
} from '../utils/cliErrors';
import { flushTelemetrySuccess, flushTelemetryError } from '../utils/telemetryLifecycle';
import { getGitUser } from '../startHelpers';

/**
 * Approve Command
 *
 * Grant or deny approval for feature pipeline gates (PRD, Spec, Code, PR, Deploy).
 *
 * Implements:
 * - ADR-5 (Approval Workflow): Human-in-the-loop governance
 * - Artifact hash validation
 * - Signer identity capture
 * - Interactive and automation-friendly modes
 *
 * Exit codes:
 * - 0: Success (approval granted/denied)
 * - 1: General error
 * - 10: Validation error (invalid gate type, feature not found)
 * - 30: Human action required (artifact modified, missing artifact)
 */

type ApproveFlags = {
  feature?: string;
  gate: string;
  approve?: boolean;
  deny?: boolean;
  signer: string;
  'signer-name'?: string;
  comment?: string;
  json: boolean;
  'skip-hash-check': boolean;
};

interface ApprovalResultPayload {
  feature_id: string;
  gate_type: string;
  verdict: 'approved' | 'rejected';
  signer: string;
  signer_name?: string;
  artifact_path?: string;
  artifact_hash?: string;
  approved_at: string;
  rationale?: string;
  next_steps: string[];
}

export default class Approve extends Command {
  static description = 'Approve or deny a feature pipeline gate';

  static examples = [
    '<%= config.bin %> <%= command.id %> prd --approve --signer "user@example.com"',
    '<%= config.bin %> <%= command.id %> spec --deny --signer "reviewer@example.com" --comment "Missing acceptance criteria"',
    '<%= config.bin %> <%= command.id %> prd --approve --signer "user@example.com" --feature FEAT-abc123',
    '<%= config.bin %> <%= command.id %> prd --approve --signer "user@example.com" --json',
  ];

  static args = {
    gate: Args.string({
      required: true,
      description: 'Approval gate type (prd, spec, plan, code, pr, deploy)',
      options: ['prd', 'spec', 'plan', 'code', 'pr', 'deploy'],
    }),
  };

  static flags = {
    feature: Flags.string({
      char: 'f',
      description: 'Feature ID (defaults to current/latest)',
    }),
    approve: Flags.boolean({
      char: 'a',
      description: 'Grant approval',
      exclusive: ['deny'],
    }),
    deny: Flags.boolean({
      char: 'd',
      description: 'Deny approval',
      exclusive: ['approve'],
    }),
    signer: Flags.string({
      char: 's',
      description: 'Signer identity (email or username)',
      required: true,
    }),
    'signer-name': Flags.string({
      description: 'Signer display name',
    }),
    comment: Flags.string({
      char: 'c',
      description: 'Approval or denial rationale',
    }),
    json: Flags.boolean({
      description: 'Output results in JSON format',
      default: false,
    }),
    'skip-hash-check': Flags.boolean({
      description: 'Skip artifact hash validation (use with caution)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Approve);
    const typedFlags = flags as ApproveFlags;
    const gateArg = args.gate;

    if (!typedFlags.approve && !typedFlags.deny) {
      this.error('Must specify either --approve or --deny', { exit: 10 });
    }

    if (typedFlags.json) {
      setJsonOutputMode();
    }

    const startTime = Date.now();
    const settings = await resolveRunDirectorySettings();
    const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);
    try {
      requireConfig(settings);
      requireFeatureId(featureId, typedFlags.feature);
    } catch (error) {
      if (error instanceof CliError) {
        const exitCode = error.code === CliErrorCode.RUN_DIR_NOT_FOUND ? 10 : error.exitCode;
        this.error(error.message, { exit: exitCode });
      }
      throw error;
    }

    const runDir = getRunDirectoryPath(settings.baseDir, featureId);

    const logger = createCliLogger('approve', featureId, runDir, {
      minLevel: typedFlags.json ? LogLevel.WARN : LogLevel.INFO,
      mirrorToStderr: !typedFlags.json,
    });
    const metrics = createRunMetricsCollector(runDir, featureId);
    const traceManager = createRunTraceManager(runDir, featureId, logger);
    const commandSpan = traceManager.startSpan('cli.approve');
    commandSpan.setAttribute('feature_id', featureId);
    commandSpan.setAttribute('gate_type', gateArg);
    commandSpan.setAttribute('verdict', typedFlags.approve ? 'approved' : 'rejected');

    try {
      // Validate gate type
      const gateType = this.validateGateType(gateArg);

      // Check if approval is pending
      const pendingApprovals = await getPendingApprovals(runDir);
      if (!pendingApprovals.includes(gateType)) {
        const history = await getApprovalHistory(runDir);
        const alreadyApproved = history.some(
          (a) => a.gate_type === gateType && a.verdict === 'approved'
        );

        if (alreadyApproved) {
          this.error(`Gate ${gateType} has already been approved. No pending approval required.`, {
            exit: 10,
          });
        } else {
          this.error(
            `No pending approval for gate ${gateType}. Current pending approvals: ${pendingApprovals.join(', ') || 'none'}`,
            { exit: 10 }
          );
        }
      }

      // Resolve artifact path and compute hash
      const manifest = await readManifest(runDir);
      const artifactInfo = this.resolveArtifactPath(runDir, manifest, gateType);

      let artifactHash: string;
      if (typedFlags['skip-hash-check']) {
        artifactHash = 'skipped';
        logger.warn('Artifact hash validation skipped', { gate_type: gateType });
      } else {
        artifactHash = await computeArtifactHash(artifactInfo.absolutePath);
        logger.info('Artifact hash computed', {
          gate_type: gateType,
          artifact_path: artifactInfo.relativePath,
          hash: artifactHash,
        });
      }

      let payload: ApprovalResultPayload;

      if (typedFlags.approve) {
        // Grant approval
        const grantOptions: GrantApprovalOptions = {
          signer: typedFlags.signer,
          artifactPath: artifactInfo.relativePath,
          metadata: {
            git_user: getGitUser(),
            hostname: os.hostname(),
          },
        };
        if (typedFlags.comment) {
          grantOptions.rationale = typedFlags.comment;
        }
        if (typedFlags['signer-name']) {
          grantOptions.signerName = typedFlags['signer-name'];
        }

        const approvalRecord = await grantApproval(runDir, gateType, artifactHash, grantOptions);

        payload = {
          feature_id: featureId,
          gate_type: gateType,
          verdict: 'approved',
          signer: approvalRecord.signer,
          artifact_path: artifactInfo.relativePath,
          approved_at: approvalRecord.approved_at,
          next_steps: this.buildNextSteps(gateType, 'approved'),
        };
        if (approvalRecord.signer_name) {
          payload.signer_name = approvalRecord.signer_name;
        }
        if (approvalRecord.artifact_hash) {
          payload.artifact_hash = approvalRecord.artifact_hash;
        }
        if (approvalRecord.rationale) {
          payload.rationale = approvalRecord.rationale;
        }

        logger.info('Approval granted', {
          gate_type: gateType,
          signer: approvalRecord.signer,
          approval_id: approvalRecord.approval_id,
        });

        await this.generateTraceAfterSpecApproval({
          gateType,
          featureId,
          runDir,
          logger,
          metrics,
        });
      } else {
        // Deny approval
        const denyOptions: DenyApprovalOptions = {
          signer: typedFlags.signer,
          artifactPath: artifactInfo.relativePath,
          reason: typedFlags.comment || 'No reason provided',
          metadata: {
            git_user: getGitUser(),
            hostname: os.hostname(),
          },
        };
        if (typedFlags['signer-name']) {
          denyOptions.signerName = typedFlags['signer-name'];
        }

        const approvalRecord = await denyApproval(runDir, gateType, denyOptions);

        payload = {
          feature_id: featureId,
          gate_type: gateType,
          verdict: 'rejected',
          signer: approvalRecord.signer,
          artifact_path: artifactInfo.relativePath,
          approved_at: approvalRecord.approved_at,
          next_steps: this.buildNextSteps(gateType, 'rejected'),
        };
        if (approvalRecord.signer_name) {
          payload.signer_name = approvalRecord.signer_name;
        }
        if (approvalRecord.rationale) {
          payload.rationale = approvalRecord.rationale;
        }

        logger.warn('Approval denied', {
          gate_type: gateType,
          signer: approvalRecord.signer,
          reason: denyOptions.reason,
        });
      }

      this.emitApprovalSummary(payload, typedFlags.json);

      await flushTelemetrySuccess({
        commandName: 'approve',
        startTime,
        logger,
        metrics,
        traceManager,
        commandSpan,
        runDirPath: runDir,
      });
    } catch (error) {
      await flushTelemetryError(
        {
          commandName: 'approve',
          startTime,
          logger,
          metrics,
          traceManager,
          commandSpan,
          runDirPath: runDir,
        },
        error
      );

      // Check for hash mismatch error (exit 30)
      if (error instanceof Error && error.message.includes('hash mismatch')) {
        this.error(
          `Artifact modified after approval request:\n${error.message}\n\n` +
            `The artifact has been changed since the approval was requested. ` +
            `Please review the updated artifact and request approval again.`,
          { exit: 30 }
        );
      }

      if (error instanceof CliError) {
        const exitCode = error.code === CliErrorCode.RUN_DIR_NOT_FOUND ? 10 : error.exitCode;
        this.error(error.message, { exit: exitCode });
      }

      rethrowIfOclifError(error);

      this.error(`Approve command failed: ${formatErrorMessage(error)}`, { exit: 1 });
    }
  }

  private validateGateType(gate: string): ApprovalGateType {
    const validGates: ApprovalGateType[] = ['prd', 'spec', 'plan', 'code', 'pr', 'deploy'];
    if (!validGates.includes(gate as ApprovalGateType)) {
      throw new Error(`Invalid gate type: ${gate}. Valid gates: ${validGates.join(', ')}`);
    }
    return gate as ApprovalGateType;
  }

  private resolveArtifactPath(
    runDir: string,
    manifest: Awaited<ReturnType<typeof readManifest>>,
    gateType: ApprovalGateType
  ): { relativePath: string; absolutePath: string } {
    let relativePath: string | undefined;

    switch (gateType) {
      case 'prd':
        relativePath = manifest.artifacts.prd;
        break;
      case 'spec':
        relativePath = manifest.artifacts.spec;
        break;
      case 'plan':
        relativePath = manifest.artifacts.plan;
        break;
      case 'code':
      case 'pr':
      case 'deploy':
        // These gates may not have specific artifact files yet
        // For now, use a placeholder or manifest itself
        relativePath = 'manifest.json';
        break;
    }

    if (!relativePath) {
      throw new Error(
        `No artifact found for gate type ${gateType}. ` +
          `The artifact may not have been created yet.`
      );
    }

    const absolutePath = path.join(runDir, relativePath);
    return { relativePath, absolutePath };
  }

  private buildNextSteps(gateType: ApprovalGateType, verdict: 'approved' | 'rejected'): string[] {
    if (verdict === 'approved') {
      switch (gateType) {
        case 'prd':
          return [
            'PRD approved. Continue to specification authoring with: codepipe spec',
            'Or resume the pipeline with: codepipe resume',
          ];
        case 'spec':
          return [
            'Spec approved. Continue to planning with: codepipe plan',
            'Or resume the pipeline with: codepipe resume',
          ];
        case 'plan':
          return [
            'Plan approved. Continue to implementation with: codepipe code',
            'Or resume the pipeline with: codepipe resume',
          ];
        case 'code':
          return ['Code approved. Create pull request with: codepipe pr'];
        case 'pr':
          return ['PR approved. Deploy changes with: codepipe deploy'];
        case 'deploy':
          return [
            'Deployment approved. Feature pipeline completed!',
            'Export artifacts with: codepipe export',
          ];
        default:
          return ['Approval completed. Check status with: codepipe status'];
      }
    } else {
      return [
        `${gateType.toUpperCase()} rejected. Address feedback and request approval again.`,
        `Update the artifact and re-run the relevant command (e.g., codepipe ${gateType})`,
        'Then request approval using this command again.',
      ];
    }
  }

  private emitApprovalSummary(payload: ApprovalResultPayload, jsonMode: boolean): void {
    if (jsonMode) {
      this.log(JSON.stringify(payload, null, 2));
      return;
    }

    this.log('');
    if (payload.verdict === 'approved') {
      this.log(`✅ Approval granted for ${payload.gate_type.toUpperCase()} gate`);
    } else {
      this.log(`❌ Approval denied for ${payload.gate_type.toUpperCase()} gate`);
    }

    this.log(`Feature: ${payload.feature_id}`);
    this.log(`Signer: ${payload.signer}${payload.signer_name ? ` (${payload.signer_name})` : ''}`);
    this.log(`Artifact: ${payload.artifact_path ?? 'N/A'}`);

    if (payload.artifact_hash) {
      this.log(`Hash: ${payload.artifact_hash}`);
    }

    if (payload.rationale) {
      this.log(`Rationale: ${payload.rationale}`);
    }

    this.log(`Timestamp: ${payload.approved_at}`);

    this.log('');
    this.log('Next steps:');
    payload.next_steps.forEach((step) => this.log(`  • ${step}`));
    this.log('');
  }

  private async generateTraceAfterSpecApproval(options: {
    gateType: ApprovalGateType;
    featureId: string;
    runDir: string;
    logger: StructuredLogger;
    metrics: MetricsCollector;
  }): Promise<void> {
    if (options.gateType !== 'spec') {
      return;
    }

    try {
      const result = await updateTraceMapOnSpecChange(
        { runDir: options.runDir, featureId: options.featureId },
        options.logger,
        options.metrics
      );

      options.logger.info('Trace map generated after spec approval', {
        trace_path: result.tracePath,
        total_links: result.statistics.totalLinks,
        prd_to_spec_links: result.statistics.prdToSpecLinks,
        spec_to_task_links: result.statistics.specToTaskLinks,
        duplicates_prevented: result.statistics.duplicatesPrevented,
      });
    } catch (error) {
      options.logger.warn('Failed to generate trace map after spec approval', {
        error: formatErrorMessage(error),
      });
    }
  }
}
