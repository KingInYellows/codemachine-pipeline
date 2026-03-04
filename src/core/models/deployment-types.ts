/**
 * Deployment domain sub-barrel
 *
 * Exports for deployment lifecycle models: ApprovalRecord, DeploymentRecord, PRMetadata.
 * Prefer these granular imports over the main index.ts barrel for better tree-shaking.
 *
 * Usage:
 *   import { DeploymentRecord, ApprovalRecord } from '@/core/models/deployment-types';
 */

export {
  ApprovalRecord,
  ApprovalRecordSchema,
  ApprovalGateType,
  ApprovalGateTypeSchema,
  ApprovalVerdict,
  ApprovalVerdictSchema,
  parseApprovalRecord,
  serializeApprovalRecord,
  createApprovalRecord,
} from './ApprovalRecord';

export {
  DeploymentRecord,
  DeploymentRecordSchema,
  DeploymentStatus,
  DeploymentStatusSchema,
  StatusCheck,
  ReviewRecord,
  parseDeploymentRecord,
  serializeDeploymentRecord,
  createDeploymentRecord,
  allStatusChecksPassed,
  allReviewsApproved,
  isReadyToMerge,
} from './DeploymentRecord';

export {
  BranchProtectionReport,
  BranchProtectionReportSchema,
} from './BranchProtectionReport';

export type { PRMetadata } from './prMetadata';
