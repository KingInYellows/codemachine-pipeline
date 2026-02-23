/**
 * Deployment Trigger Context - backward-compatibility re-export
 *
 * This module re-exports everything from src/workflows/deployment/context.ts
 * to maintain backward compatibility with existing importers.
 *
 * New code should import directly from './deployment/context' or './deployment'.
 */

export { loadDeploymentContext, persistDeploymentOutcome } from './deployment/context';
