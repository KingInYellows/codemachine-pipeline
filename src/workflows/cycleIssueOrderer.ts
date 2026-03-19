/**
 * Cycle Issue Orderer
 *
 * Orders cycle issues using topological sort (Kahn's algorithm) on
 * "blocks" relations, with priority as the tiebreaker within each
 * topological level. Handles dependency cycles gracefully.
 */

import type { LinearCycleIssue } from '../adapters/linear/LinearAdapterTypes.js';

export interface OrderingResult {
  ordered: LinearCycleIssue[];
  hasCycle: boolean;
  cycleInvolvedIds: string[];
}

/**
 * Order cycle issues by dependency (topological) then priority.
 *
 * Uses Kahn's algorithm. Within each topological level, issues are
 * sorted by priority descending (4=Urgent first, 0=None last).
 *
 * If a dependency cycle is detected, cycle-involved issues are
 * appended at the end, sorted by priority.
 */
export function orderCycleIssues(issues: LinearCycleIssue[]): OrderingResult {
  if (issues.length === 0) {
    return { ordered: [], hasCycle: false, cycleInvolvedIds: [] };
  }

  const issueMap = new Map<string, LinearCycleIssue>();
  for (const issue of issues) {
    issueMap.set(issue.identifier, issue);
  }

  // Build adjacency list and in-degree map from "blocks" relations.
  // If A blocks B, A must come before B: edge A → B.
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const issue of issues) {
    if (!inDegree.has(issue.identifier)) {
      inDegree.set(issue.identifier, 0);
    }
    if (!adjacency.has(issue.identifier)) {
      adjacency.set(issue.identifier, new Set());
    }
  }

  for (const issue of issues) {
    for (const relation of issue.relations) {
      if (relation.type !== 'blocks') continue;

      const blockerId = relation.issue.identifier;
      const blockedId = relation.relatedIssue.identifier;

      // Only add edges for issues within this cycle
      if (!issueMap.has(blockerId) || !issueMap.has(blockedId)) continue;

      const edges = adjacency.get(blockerId) ?? new Set();
      if (!edges.has(blockedId)) {
        edges.add(blockedId);
        adjacency.set(blockerId, edges);
        inDegree.set(blockedId, (inDegree.get(blockedId) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm: process level by level for stable priority ordering
  const ordered: LinearCycleIssue[] = [];
  const visited = new Set<string>();

  // Seed queue with zero-indegree issues, sorted by priority descending
  let currentLevel = issues
    .filter((i) => (inDegree.get(i.identifier) ?? 0) === 0)
    .sort((a, b) => b.priority - a.priority);

  while (currentLevel.length > 0) {
    const nextLevel: LinearCycleIssue[] = [];

    for (const issue of currentLevel) {
      ordered.push(issue);
      visited.add(issue.identifier);

      const neighbors = adjacency.get(issue.identifier) ?? new Set();
      for (const neighborId of neighbors) {
        const deg = (inDegree.get(neighborId) ?? 1) - 1;
        inDegree.set(neighborId, deg);
        if (deg === 0 && !visited.has(neighborId)) {
          const neighbor = issueMap.get(neighborId);
          if (neighbor) {
            nextLevel.push(neighbor);
          }
        }
      }
    }

    // Sort next level by priority descending for stable ordering
    currentLevel = nextLevel.sort((a, b) => b.priority - a.priority);
  }

  // Any unvisited issues are part of a dependency cycle
  const cycleInvolved = issues
    .filter((i) => !visited.has(i.identifier))
    .sort((a, b) => b.priority - a.priority);

  const cycleInvolvedIds = cycleInvolved.map((i) => i.identifier);

  return {
    ordered: [...ordered, ...cycleInvolved],
    hasCycle: cycleInvolved.length > 0,
    cycleInvolvedIds,
  };
}
