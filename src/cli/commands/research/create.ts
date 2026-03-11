import { Flags } from '@oclif/core';
import { getRunDirectoryPath } from '../../../persistence/runLifecycle';
import {
  resolveRunDirectorySettings,
  selectFeatureId,
  requireFeatureId,
} from '../../utils/runDirectory';
import {
  createCoordinatorForRun,
  type CreateResearchTaskOptions,
} from '../../../workflows/researchCoordinator';
import type { FreshnessRequirement, ResearchSource } from '../../../core/models/ResearchTask';
import { CliError, CliErrorCode, setJsonOutputMode } from '../../utils/cliErrors';
import { TelemetryCommand } from '../../telemetryCommand';

type CreateFlags = {
  feature?: string;
  title: string;
  objective: string[];
  source?: string[];
  'max-age'?: number;
  'force-fresh': boolean;
  json: boolean;
};

const SOURCE_TYPES: ReadonlyArray<ResearchSource['type']> = [
  'codebase',
  'web',
  'documentation',
  'api',
  'linear',
  'github',
  'other',
];

export default class ResearchCreate extends TelemetryCommand {
  protected get commandName(): string {
    return 'research:create';
  }

  static description = 'Create a ResearchTask manually via the CLI';

  static examples = [
    '<%= config.bin %> research create --title "Clarify rate limits" --objective "What are the GitHub API quotas?"',
    '<%= config.bin %> research create -f feat-123 --title "Investigate auth flow" --objective "What scopes are required?" --source codebase:src/auth.ts --source documentation:docs/auth.md',
  ];

  static flags = {
    feature: Flags.string({
      char: 'f',
      description: 'Feature ID to attach the research task to (defaults to latest run)',
    }),
    title: Flags.string({
      char: 't',
      description: 'Research task title',
      required: true,
    }),
    objective: Flags.string({
      char: 'o',
      multiple: true,
      required: true,
      description: 'Research objective/question (repeat for multiples)',
    }),
    source: Flags.string({
      char: 's',
      multiple: true,
      description: 'Source to consult formatted as type:identifier or type:identifier|description',
    }),
    'max-age': Flags.integer({
      description: 'Freshness window in hours for cached results (default 24)',
      min: 1,
    }),
    'force-fresh': Flags.boolean({
      description: 'Force new research even if cache exists',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Emit machine-readable JSON output',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ResearchCreate);
    const typedFlags = flags as CreateFlags;

    if (typedFlags.json) {
      setJsonOutputMode();
    }

    if (!typedFlags.objective || typedFlags.objective.length === 0) {
      this.error('At least one --objective flag is required', { exit: 2 });
    }

    const settings = await resolveRunDirectorySettings();
    const featureId = await selectFeatureId(settings.baseDir, typedFlags.feature);
    try {
      requireFeatureId(featureId, typedFlags.feature);
    } catch (error) {
      if (error instanceof CliError) {
        const exitCode = error.code === CliErrorCode.RUN_DIR_NOT_FOUND ? 10 : error.exitCode;
        this.error(error.message, { exit: exitCode });
      }
      throw error;
    }

    const runDir = getRunDirectoryPath(settings.baseDir, featureId);

    await this.runWithTelemetry(
      {
        runDirPath: runDir,
        featureId,
        jsonMode: typedFlags.json,
      },
      async (ctx) => {
        const coordinator = createCoordinatorForRun(runDir, featureId, ctx.logger!, ctx.metrics!);

        const sources = (typedFlags.source ?? []).map((value) => this.parseSourceFlag(value));
        const freshness = this.buildFreshnessRequirement(
          typedFlags['max-age'],
          typedFlags['force-fresh']
        );

        const queueOptions: CreateResearchTaskOptions = {
          title: typedFlags.title,
          objectives: typedFlags.objective,
          sources,
          metadata: {
            created_via: 'cli',
          },
        };

        if (freshness) {
          queueOptions.freshnessRequirements = freshness;
        }

        const queueResult = await coordinator.queueTask(queueOptions);

        const payload = {
          created: queueResult.created,
          cached: queueResult.cached,
          task: queueResult.task,
        };

        if (typedFlags.json) {
          this.log(JSON.stringify(payload, null, 2));
        } else if (queueResult.cached) {
          this.log(`Cached research task reused: ${queueResult.task.task_id}`);
        } else {
          this.log(`Research task created: ${queueResult.task.task_id}`);
        }

        this.log(
          `Objectives: ${queueResult.task.objectives.length} | Sources: ${queueResult.task.sources?.length ?? 0} | Cache: ${queueResult.task.cache_key ?? 'n/a'}`
        );
      }
    );
  }

  private parseSourceFlag(value: string): ResearchSource {
    const [typePart, ...rest] = value.split(':');
    if (!typePart || rest.length === 0) {
      this.error(`Invalid --source value "${value}". Expected format type:identifier`, { exit: 2 });
    }

    const normalizedType = typePart.trim() as ResearchSource['type'];
    if (!SOURCE_TYPES.includes(normalizedType)) {
      this.error(`Invalid source type "${typePart}". Allowed values: ${SOURCE_TYPES.join(', ')}`, {
        exit: 2,
      });
    }

    const identifierRaw = rest.join(':').trim();
    if (!identifierRaw) {
      this.error(`Invalid --source value "${value}". Identifier cannot be empty.`, { exit: 2 });
    }

    const [identifier, description] = identifierRaw.split('|').map((part) => part.trim());
    const source: ResearchSource = {
      type: normalizedType,
      identifier,
    };

    if (description) {
      source.description = description;
    }

    return source;
  }

  private buildFreshnessRequirement(
    maxAge?: number,
    forceFresh?: boolean
  ): FreshnessRequirement | undefined {
    if (maxAge === undefined && !forceFresh) {
      return undefined;
    }

    return {
      max_age_hours: maxAge ?? 24,
      force_fresh: Boolean(forceFresh),
    };
  }
}
