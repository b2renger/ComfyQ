/**
 * Workflow Parser
 * Analyzes ComfyUI workflow JSON and extracts configurable parameters
 */

// Node types that commonly have user-configurable parameters
const EDITABLE_NODE_TYPES = {
    'CLIPTextEncode': {
        fields: ['text'],
        defaultType: 'textarea',
        labels: { text: 'Prompt' }
    },
    'LoadImage': {
        fields: ['image'],
        defaultType: 'image',
        labels: { image: 'Image' }
    },
    'KSampler': {
        fields: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
        defaultType: 'number',
        labels: {
            seed: 'Seed',
            steps: 'Steps',
            cfg: 'CFG Scale',
            sampler_name: 'Sampler',
            scheduler: 'Scheduler',
            denoise: 'Denoise'
        }
    },
    'KSamplerAdvanced': {
        fields: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
        defaultType: 'number',
        labels: {
            seed: 'Seed',
            steps: 'Steps',
            cfg: 'CFG Scale',
            sampler_name: 'Sampler',
            scheduler: 'Scheduler',
            denoise: 'Denoise'
        }
    },
    'EmptyLatentImage': {
        fields: ['width', 'height', 'batch_size'],
        defaultType: 'number',
        labels: {
            width: 'Width',
            height: 'Height',
            batch_size: 'Batch Size'
        }
    },
    'EmptyFlux2LatentImage': {
        fields: ['width', 'height', 'batch_size'],
        defaultType: 'number',
        labels: {
            width: 'Width',
            height: 'Height',
            batch_size: 'Batch Size'
        }
    },
    'CheckpointLoaderSimple': {
        fields: ['ckpt_name'],
        defaultType: 'text',
        labels: { ckpt_name: 'Checkpoint' }
    },
    'LoraLoader': {
        fields: ['lora_name', 'strength_model', 'strength_clip'],
        defaultType: 'text',
        labels: {
            lora_name: 'LoRA',
            strength_model: 'Model Strength',
            strength_clip: 'CLIP Strength'
        }
    },
    'VAELoader': {
        fields: ['vae_name'],
        defaultType: 'text',
        labels: { vae_name: 'VAE' }
    },
    'UNETLoader': {
        fields: ['unet_name'],
        defaultType: 'text',
        labels: { unet_name: 'UNET Model' }
    },
    'WanImageToVideo': {
        fields: ['width', 'height', 'length', 'batch_size'],
        defaultType: 'number',
        labels: {
            width: 'Width',
            height: 'Height',
            length: 'Video Length (frames)',
            batch_size: 'Batch Size'
        }
    }
};

const COMMON_OPTIONS = {
    sampler_name: [
        "euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral",
        "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde",
        "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde", "ddim", "uni_pc", "uni_pc_bh2"
    ],
    scheduler: [
        "normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"
    ]
};

/**
 * Infer parameter type from field name and value
 */
function inferParameterType(fieldName, value, nodeType) {
    // Check if we have a predefined node type config
    if (EDITABLE_NODE_TYPES[nodeType]) {
        const config = EDITABLE_NODE_TYPES[nodeType];
        if (config.fields.includes(fieldName)) {
            // Special cases
            if (fieldName.includes('image')) return 'image';
            if (fieldName === 'text' || fieldName.includes('prompt')) {
                return typeof value === 'string' && value.length > 50 ? 'textarea' : 'text';
            }
            if (fieldName.includes('sampler') || fieldName.includes('scheduler')) return 'select';
            if (fieldName.includes('name') && (fieldName.includes('ckpt') || fieldName.includes('lora') || fieldName.includes('vae'))) {
                return 'text'; // Could be file selector in future
            }
        }
    }

    // Generic inference
    if (fieldName.toLowerCase().includes('image')) return 'image';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'checkbox';
    if (typeof value === 'string') {
        if (value.length > 50) return 'textarea';
        return 'text';
    }

    return 'text';
}

/**
 * Generate a human-readable label from field name
 */
function generateLabel(fieldName, nodeType) {
    // Check predefined labels
    if (EDITABLE_NODE_TYPES[nodeType]?.labels?.[fieldName]) {
        return EDITABLE_NODE_TYPES[nodeType].labels[fieldName];
    }

    // Convert snake_case or camelCase to Title Case
    return fieldName
        .replace(/_/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
        .trim();
}

/**
 * Check if a node/field should be editable
 */
function isEditableField(nodeType, fieldName, value) {
    // Skip non-primitive values (arrays, objects that are connections)
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        return false;
    }

    // Check if node type is in our editable list
    if (EDITABLE_NODE_TYPES[nodeType]) {
        return EDITABLE_NODE_TYPES[nodeType].fields.includes(fieldName);
    }

    // For unknown node types, be conservative
    // Only include simple text/number fields with common names
    const commonEditableFields = ['text', 'prompt', 'seed', 'steps', 'cfg', 'width', 'height', 'denoise'];
    return commonEditableFields.includes(fieldName);
}

/**
 * Parse workflow and extract configurable parameters
 * @param {Object} workflowJson - ComfyUI workflow JSON
 * @returns {Object} Parsed parameters with metadata
 */
function parseWorkflow(workflowJson) {
    const parameters = [];
    let order = 0;

    // Iterate through all nodes
    for (const [nodeId, nodeData] of Object.entries(workflowJson)) {
        const nodeType = nodeData.class_type;
        const inputs = nodeData.inputs || {};
        const nodeTitle = nodeData._meta?.title || nodeType;

        // Check each input field
        for (const [fieldName, value] of Object.entries(inputs)) {
            if (isEditableField(nodeType, fieldName, value)) {
                const type = inferParameterType(fieldName, value, nodeType);
                const label = generateLabel(fieldName, nodeType);

                // Create a unique parameter key
                const paramKey = `${nodeType.toLowerCase()}_${fieldName}_${nodeId}`.replace(/[^a-z0-9_]/g, '_');

                parameters.push({
                    key: paramKey,
                    nodeId: nodeId,
                    field: fieldName,
                    type: type,
                    label: `${label} (${nodeTitle})`,
                    defaultValue: value,
                    enabled: false, // By default, parameters are not exposed
                    order: order++,
                    nodeType: nodeType,
                    nodeTitle: nodeTitle,
                    // Additional metadata
                    metadata: {
                        originalValue: value,
                        canBeImage: type === 'image',
                        canBeTextarea: fieldName === 'text' || fieldName.includes('prompt')
                    },
                    options: COMMON_OPTIONS[fieldName] || undefined
                });
            }
        }
    }

    return {
        parameters,
        nodeCount: Object.keys(workflowJson).length,
        editableCount: parameters.length
    };
}

/**
 * Validate workflow JSON structure
 */
function validateWorkflow(workflowJson) {
    if (typeof workflowJson !== 'object' || workflowJson === null) {
        return { valid: false, error: 'Workflow must be a valid JSON object' };
    }

    if (Object.keys(workflowJson).length === 0) {
        return { valid: false, error: 'Workflow is empty' };
    }

    // Check if it looks like a ComfyUI workflow
    const hasValidNodes = Object.values(workflowJson).some(node =>
        node && typeof node === 'object' && 'class_type' in node
    );

    if (!hasValidNodes) {
        return { valid: false, error: 'Does not appear to be a valid ComfyUI workflow' };
    }

    return { valid: true };
}

/**
 * Build parameter_map for config.json from selected parameters
 */
function buildParameterMap(selectedParameters) {
    const parameterMap = {};

    selectedParameters.forEach(param => {
        parameterMap[param.key] = {
            node_id: param.nodeId,
            field: param.field,
            type: param.type,
            label: param.label,
            default: param.defaultValue,
            enabled: param.enabled,
            order: param.order,
            options: param.options // Pass options if available
        };
    });

    return parameterMap;
}

module.exports = {
    parseWorkflow,
    validateWorkflow,
    buildParameterMap,
    EDITABLE_NODE_TYPES
};
