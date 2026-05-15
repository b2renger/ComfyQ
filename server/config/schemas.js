const { z } = require('zod');

const ParamType = z.enum([
    'text', 'textarea', 'number', 'select', 'checkbox',
    'image', 'video', 'audio'
]);

const ExposedParameter = z.object({
    key: z.string().min(1),
    nodeId: z.string().min(1),
    field: z.string().min(1),
    type: ParamType,
    label: z.string().min(1),
    default: z.any().optional(),
    options: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    // For image/video params: longest-edge pixel cap the client applies
    // before upload. Resizing client-side saves LAN bandwidth and matches
    // the workflow's expected working resolution (most diffusion / i2v
    // workflows degrade past 1280–2048 anyway). Undefined → client uses
    // its built-in defaults (1024 for image, 1280 for video).
    maxInputEdge: z.number().int().positive().optional(),
    required: z.boolean().default(false),
    order: z.number().int().default(0)
});

const WorkflowMeta = z.object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(''),
    category: z.enum([
        't2i', 'image-edit', 'i2v', 'i2i',
        'audio', '3d', 'preprocessor', 'other'
    ]).default('other'),
    tags: z.array(z.string()).default([]),
    thumbnail: z.string().nullable().default(null),
    author: z.string().default('Unknown'),
    version: z.string().default('1.0.0'),
    workflowFile: z.string().min(1),
    apiFormat: z.literal(true),
    requirements: z.object({
        minVRAM: z.number().nonnegative().default(0),
        models: z.array(z.object({
            type: z.enum(['unet', 'vae', 'clip', 'lora', 'checkpoint', 'other']),
            file: z.string()
        })).default([])
    }).default({ minVRAM: 0, models: [] }),
    estimatedDurationSec: z.number().positive().default(60),
    maxRuntimeSec: z.number().positive().default(600),
    exposedParameters: z.array(ExposedParameter).default([]),
    warmupParams: z.record(z.any()).default({}),
    presets: z.record(z.object({
        label: z.string().optional(),
        description: z.string().optional(),
        values: z.record(z.any()).default({})
    })).default({})
});

const WorkflowConfigMeta = z.object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    parameterOverrides: z.record(z.object({
        label: z.string().optional(),
        default: z.any().optional(),
        enabled: z.boolean().optional(),
        order: z.number().int().optional()
    })).default({}),
    warmupPromptOverride: z.string().optional(),
    hidden: z.boolean().default(false)
});

const AppConfig = z.object({
    schemaVersion: z.literal(2),
    mode: z.enum(['admin', 'student']),
    server: z.object({
        port: z.number().int().positive().default(3000),
        host: z.string().default('0.0.0.0')
    }),
    comfy_ui: z.object({
        installation_type: z.enum(['portable', 'system']).default('system'),
        root_path: z.string().default(''),
        python_executable: z.string().default(''),
        output_dir: z.string().default('output'),
        api_host: z.string().default('127.0.0.1'),
        api_port: z.number().int().positive().default(8188),
        autoStart: z.boolean().default(true),
        vramBudgetGb: z.number().positive().default(24)
    }),
    auth: z.object({
        adminPasswordHash: z.string().default('')
    }).default({ adminPasswordHash: '' }),
    queue: z.object({
        dbPath: z.string().default('./server/data/comfyq.sqlite'),
        inputRetentionMinutes: z.number().int().nonnegative().default(30),
        outputRetentionDays: z.number().int().nonnegative().default(30)
    }).default({}),
    workflows: z.object({
        dir: z.string().default('./workflows'),
        activeWorkflowId: z.string().nullable().default(null)
    }).default({ dir: './workflows', activeWorkflowId: null })
});

module.exports = {
    AppConfig,
    WorkflowMeta,
    WorkflowConfigMeta,
    ExposedParameter,
    ParamType
};
