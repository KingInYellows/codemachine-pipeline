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

interface GraphData {
  issueMap: Map<string, LinearCycleIssue>;
  inDegree: Map<string, number>;
  adjacency: Map<string, Set<string>>;
}

interface Component {
  nodeIds: string[];
  isCycle: boolean;
}

interface ComponentGraph {
  indexByNodeId: Map<string, number>;
  inDegree: Map<number, number>;
  adjacency: Map<number, Set<number>>;
}

interface ComponentLevelEntry {
  index: number;
  priority: number;
}

function sortByPriorityDescending(issues: LinearCycleIssue[]): LinearCycleIssue[] {
  return [...issues].sort((a, b) => b.priority - a.priority);
}

function createIssueMap(issues: LinearCycleIssue[]): Map<string, LinearCycleIssue> {
  const issueMap = new Map<string, LinearCycleIssue>();
  for (const issue of issues) {
    issueMap.set(issue.identifier, issue);
  }
  return issueMap;
}

function createGraph(issues: LinearCycleIssue[]): GraphData {
  const issueMap = createIssueMap(issues);
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const issue of issues) {
    inDegree.set(issue.identifier, 0);
    adjacency.set(issue.identifier, new Set());
  }

  for (const issue of issues) {
    for (const relation of issue.relations) {
      if (relation.type !== 'blocks') {
        continue;
      }

      const blockerId = relation.issue.identifier;
      const blockedId = relation.relatedIssue.identifier;
      if (!issueMap.has(blockerId) || !issueMap.has(blockedId)) {
        continue;
      }

      const edges = adjacency.get(blockerId)!;
      if (edges.has(blockedId)) {
        continue;
      }

      edges.add(blockedId);
      inDegree.set(blockedId, inDegree.get(blockedId)! + 1);
    }
  }

  return { issueMap, inDegree, adjacency };
}

function getZeroInDegreeIssues(
  issues: LinearCycleIssue[],
  inDegree: Map<string, number>
): LinearCycleIssue[] {
  return sortByPriorityDescending(issues.filter((issue) => inDegree.get(issue.identifier) === 0));
}

function processCurrentLevel(
  currentLevel: LinearCycleIssue[],
  ordered: LinearCycleIssue[],
  visited: Set<string>,
  issueMap: Map<string, LinearCycleIssue>,
  inDegree: Map<string, number>,
  adjacency: Map<string, Set<string>>
): LinearCycleIssue[] {
  const nextLevel: LinearCycleIssue[] = [];

  for (const issue of currentLevel) {
    ordered.push(issue);
    visited.add(issue.identifier);

    for (const neighborId of adjacency.get(issue.identifier)!) {
      const deg = inDegree.get(neighborId)! - 1;
      inDegree.set(neighborId, deg);
      if (deg !== 0 || visited.has(neighborId)) {
        continue;
      }

      nextLevel.push(issueMap.get(neighborId)!);
    }
  }

  return sortByPriorityDescending(nextLevel);
}

function performKahnTraversal(
  issues: LinearCycleIssue[],
  graph: GraphData
): { ordered: LinearCycleIssue[]; visited: Set<string> } {
  const ordered: LinearCycleIssue[] = [];
  const visited = new Set<string>();
  let currentLevel = getZeroInDegreeIssues(issues, graph.inDegree);

  while (currentLevel.length > 0) {
    currentLevel = processCurrentLevel(
      currentLevel,
      ordered,
      visited,
      graph.issueMap,
      graph.inDegree,
      graph.adjacency
    );
  }

  return { ordered, visited };
}

function getRemainingIds(issues: LinearCycleIssue[], visited: Set<string>): string[] {
  return issues.map((issue) => issue.identifier).filter((issueId) => !visited.has(issueId));
}

function buildRemainingAdjacency(
  remainingIds: string[],
  adjacency: Map<string, Set<string>>,
  visited: Set<string>
): Map<string, Set<string>> {
  const remainingAdjacency = new Map<string, Set<string>>();

  for (const issueId of remainingIds) {
    const remainingNeighbors = new Set<string>();
    for (const neighborId of adjacency.get(issueId) ?? new Set<string>()) {
      if (!visited.has(neighborId)) {
        remainingNeighbors.add(neighborId);
      }
    }
    remainingAdjacency.set(issueId, remainingNeighbors);
  }

  return remainingAdjacency;
}

function findStronglyConnectedComponents(
  nodeIds: string[],
  adjacency: Map<string, Set<string>>
): string[][] {
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let index = 0;

  function visit(nodeId: string): void {
    indices.set(nodeId, index);
    lowLinks.set(nodeId, index);
    index += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const neighborId of adjacency.get(nodeId) ?? new Set<string>()) {
      if (!indices.has(neighborId)) {
        visit(neighborId);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, lowLinks.get(neighborId)!));
        continue;
      }

      if (onStack.has(neighborId)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, indices.get(neighborId)!));
      }
    }

    if (lowLinks.get(nodeId) !== indices.get(nodeId)) {
      return;
    }

    const component: string[] = [];
    while (stack.length > 0) {
      const currentNodeId = stack.pop()!;
      onStack.delete(currentNodeId);
      component.push(currentNodeId);
      if (currentNodeId === nodeId) {
        break;
      }
    }
    components.push(component);
  }

  for (const nodeId of nodeIds) {
    if (!indices.has(nodeId)) {
      visit(nodeId);
    }
  }

  return components;
}

function isCycleComponent(nodeIds: string[], adjacency: Map<string, Set<string>>): boolean {
  return (
    nodeIds.length > 1 ||
    (nodeIds.length === 1 && adjacency.get(nodeIds[0])?.has(nodeIds[0]) === true)
  );
}

function createComponents(
  remainingIds: string[],
  remainingAdjacency: Map<string, Set<string>>
): Component[] {
  return findStronglyConnectedComponents(remainingIds, remainingAdjacency).map((nodeIds) => ({
    nodeIds,
    isCycle: isCycleComponent(nodeIds, remainingAdjacency),
  }));
}

function createComponentGraph(
  components: Component[],
  remainingAdjacency: Map<string, Set<string>>
): ComponentGraph {
  const indexByNodeId = new Map<string, number>();
  const inDegree = new Map<number, number>();
  const adjacency = new Map<number, Set<number>>();

  components.forEach((component, index) => {
    inDegree.set(index, 0);
    adjacency.set(index, new Set());
    for (const nodeId of component.nodeIds) {
      indexByNodeId.set(nodeId, index);
    }
  });

  components.forEach((component, index) => {
    for (const nodeId of component.nodeIds) {
      for (const neighborId of remainingAdjacency.get(nodeId) ?? new Set<string>()) {
        const neighborIndex = indexByNodeId.get(neighborId);
        if (neighborIndex === undefined || neighborIndex === index) {
          continue;
        }

        const neighbors = adjacency.get(index)!;
        if (neighbors.has(neighborIndex)) {
          continue;
        }

        neighbors.add(neighborIndex);
        inDegree.set(neighborIndex, inDegree.get(neighborIndex)! + 1);
      }
    }
  });

  return { indexByNodeId, inDegree, adjacency };
}

function getComponentPriority(
  component: Component,
  issueMap: Map<string, LinearCycleIssue>
): number {
  return Math.max(...component.nodeIds.map((nodeId) => issueMap.get(nodeId)!.priority));
}

function getReadyComponents(
  components: Component[],
  componentInDegree: Map<number, number>,
  issueMap: Map<string, LinearCycleIssue>
): ComponentLevelEntry[] {
  return components
    .map((component, index) => ({
      index,
      priority: getComponentPriority(component, issueMap),
    }))
    .filter(({ index }) => componentInDegree.get(index) === 0)
    .sort((a, b) => b.priority - a.priority);
}

function appendComponent(
  component: Component,
  issueMap: Map<string, LinearCycleIssue>,
  ordered: LinearCycleIssue[],
  cycleInvolvedIds: string[]
): void {
  const componentIssues = sortByPriorityDescending(
    component.nodeIds.map((nodeId) => issueMap.get(nodeId)!)
  );

  ordered.push(...componentIssues);
  if (component.isCycle) {
    cycleInvolvedIds.push(...componentIssues.map((issue) => issue.identifier));
  }
}

function unlockNeighborComponents(
  index: number,
  components: Component[],
  componentGraph: ComponentGraph,
  issueMap: Map<string, LinearCycleIssue>
): ComponentLevelEntry[] {
  const nextLevel: ComponentLevelEntry[] = [];

  for (const neighborIndex of componentGraph.adjacency.get(index) ?? new Set<number>()) {
    const deg = componentGraph.inDegree.get(neighborIndex)! - 1;
    componentGraph.inDegree.set(neighborIndex, deg);
    if (deg !== 0) {
      continue;
    }

    nextLevel.push({
      index: neighborIndex,
      priority: getComponentPriority(components[neighborIndex], issueMap),
    });
  }

  return nextLevel;
}

function orderRemainingComponents(
  components: Component[],
  componentGraph: ComponentGraph,
  issueMap: Map<string, LinearCycleIssue>
): { ordered: LinearCycleIssue[]; cycleInvolvedIds: string[] } {
  const ordered: LinearCycleIssue[] = [];
  const cycleInvolvedIds: string[] = [];
  let currentLevel = getReadyComponents(components, componentGraph.inDegree, issueMap);

  while (currentLevel.length > 0) {
    const nextLevel: ComponentLevelEntry[] = [];

    for (const { index } of currentLevel) {
      appendComponent(components[index], issueMap, ordered, cycleInvolvedIds);
      nextLevel.push(...unlockNeighborComponents(index, components, componentGraph, issueMap));
    }

    currentLevel = nextLevel.sort((a, b) => b.priority - a.priority);
  }

  return { ordered, cycleInvolvedIds };
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

  const graph = createGraph(issues);
  const { ordered, visited } = performKahnTraversal(issues, graph);
  const remainingIds = getRemainingIds(issues, visited);
  const remainingAdjacency = buildRemainingAdjacency(remainingIds, graph.adjacency, visited);
  const components = createComponents(remainingIds, remainingAdjacency);
  const componentGraph = createComponentGraph(components, remainingAdjacency);
  const remaining = orderRemainingComponents(components, componentGraph, graph.issueMap);

  return {
    ordered: [...ordered, ...remaining.ordered],
    hasCycle: remaining.cycleInvolvedIds.length > 0,
    cycleInvolvedIds: remaining.cycleInvolvedIds,
  };
}
