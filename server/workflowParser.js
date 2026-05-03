/**
 * Workflow Parser
 * Analyzes ComfyUI workflow JSON and extracts configurable parameters
 */

// Node types that commonly have user-configurable parameters
/**
 * Supported node types and their configurable fields.
 */
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
    'FluxGuidance': {
        fields: ['guidance'],
        defaultType: 'number',
        labels: { guidance: 'Guidance Scale' }
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
    },
    'VHS_LoadVideo': {
        fields: ['video'],
        defaultType: 'video',
        labels: { video: 'Video File' }
    },
    'LoadVideo': {
        fields: ['video'],
        defaultType: 'video',
        labels: { video: 'Video File' }
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
            if (fieldName.toLowerCase().includes('video')) return 'video';
            if (fieldName.toLowerCase().includes('image')) return 'image';
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
    const lowerField = fieldName.toLowerCase();
    if (lowerField.includes('video')) return 'video';
    if (lowerField.includes('image')) return 'image';
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
 * Supports both Litegraph format (exported from ComfyUI UI with nodes array)
 * and API format (flat object with node IDs as keys)
 */
function validateWorkflow(workflowJson) {
    if (typeof workflowJson !== 'object' || workflowJson === null) {
        return { valid: false, error: 'Workflow must be a valid JSON object' };
    }

    if (Object.keys(workflowJson).length === 0) {
        return { valid: false, error: 'Workflow is empty' };
    }

    // Check for Litegraph format (exported from ComfyUI UI)
    // This format has a 'nodes' array and 'links' array
    if (Array.isArray(workflowJson.nodes)) {
        const hasValidNodes = workflowJson.nodes.some(node =>
            node && typeof node === 'object' && 'type' in node
        );
        if (hasValidNodes) {
            return { valid: true, format: 'litegraph' };
        }
    }

    // Check for API format (flat object with node IDs as keys)
    // Each node has 'class_type' and 'inputs'
    const hasValidNodes = Object.values(workflowJson).some(node =>
        node && typeof node === 'object' && 'class_type' in node
    );

    if (hasValidNodes) {
        return { valid: true, format: 'api' };
    }

    return { valid: false, error: 'Does not appear to be a valid ComfyUI workflow' };
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

/**
 * Convert Litegraph format to API format
 * Litegraph format: { nodes: [...], links: [...], definitions: { subgraphs: [...] } } - exported from ComfyUI UI
 * API format: { "nodeId": { class_type, inputs, _meta } } - used by ComfyUI API
 * 
 * @param {Object} litegraphWorkflow - Workflow in Litegraph format
 * @returns {Object} Workflow in API format
 */
function convertLitegraphToApi(litegraphWorkflow) {
    if (!litegraphWorkflow.nodes || !Array.isArray(litegraphWorkflow.nodes)) {
        // Already in API format or invalid
        return litegraphWorkflow;
    }

    const apiWorkflow = {};

    // Build a map of subgraph ID -> subgraph definition
    const subgraphMap = {};
    if (litegraphWorkflow.definitions && litegraphWorkflow.definitions.subgraphs) {
        for (const subgraph of litegraphWorkflow.definitions.subgraphs) {
            subgraphMap[subgraph.id] = subgraph;
        }
    }

    /**
     * Process a set of nodes and links into API format
     * @param {Array} nodes - Array of nodes
     * @param {Array} links - Array of links
     * @param {string} prefix - Optional prefix for node IDs to avoid collisions
     * @param {Object} parentLinkMap - Link map from parent context for resolving external connections
     */
    function processNodes(nodes, links, prefix = '', parentLinkMap = null) {
        // Create a map of link_id -> { source_node_id, source_slot }
        const linkMap = {};
        const linksArray = Array.isArray(links) ? links : [];
        for (const link of linksArray) {
            if (link && Array.isArray(link)) {
                // Link format: [link_id, source_node_id, source_slot, target_node_id, target_slot, type]
                const [linkId, sourceNodeId, sourceSlot] = link;
                linkMap[linkId] = { nodeId: sourceNodeId, slot: sourceSlot };
            }
        }

        for (const node of nodes) {
            const nodeId = prefix + String(node.id);
            const nodeType = node.type;

            // Check if this node is actually a subgraph reference
            if (subgraphMap[nodeType]) {
                // This is a subgraph node - we need to expand it inline
                const subgraph = subgraphMap[nodeType];
                const subgraphPrefix = `${nodeId}:`;

                // Process the subgraph's internal nodes
                processNodes(subgraph.nodes || [], subgraph.links || [], subgraphPrefix, linkMap);

                // Map the subgraph's inputs to the parent workflow's connections
                // The subgraph inputs connect to the parent's links
                if (node.inputs && subgraph.inputs) {
                    for (let i = 0; i < node.inputs.length; i++) {
                        const parentInput = node.inputs[i];
                        const subgraphInput = subgraph.inputs[i];

                        if (parentInput && parentInput.link !== null && parentInput.link !== undefined && subgraphInput) {
                            // Find which internal nodes use this subgraph input
                            const inputLinkIds = subgraphInput.linkIds || [];

                            for (const internalLinkId of inputLinkIds) {
                                // Find the link in the subgraph that connects from this input
                                const subgraphLinks = subgraph.links || [];
                                for (const link of subgraphLinks) {
                                    if (link && Array.isArray(link) && link[0] === internalLinkId) {
                                        // link format: [link_id, source_node_id, source_slot, target_node_id, target_slot, type]
                                        const [, , , targetNodeId, targetSlot] = link;
                                        const targetApiNodeId = subgraphPrefix + String(targetNodeId);

                                        // Get the connection from the parent workflow
                                        const parentLinkInfo = linkMap[parentInput.link] || (parentLinkMap && parentLinkMap[parentInput.link]);
                                        if (parentLinkInfo && apiWorkflow[targetApiNodeId]) {
                                            // Find the input name for this slot
                                            const targetNode = (subgraph.nodes || []).find(n => n.id === targetNodeId);
                                            if (targetNode && targetNode.inputs && targetNode.inputs[targetSlot]) {
                                                const inputName = targetNode.inputs[targetSlot].name;
                                                // Connect the parent's output to this internal node's input
                                                apiWorkflow[targetApiNodeId].inputs[inputName] = [
                                                    prefix + String(parentLinkInfo.nodeId),
                                                    parentLinkInfo.slot
                                                ];
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Map the subgraph's outputs to be accessible from parent
                // The parent workflow may reference the subgraph node's outputs
                // We need to find which internal node produces the output
                if (node.outputs && subgraph.outputs) {
                    for (let i = 0; i < node.outputs.length; i++) {
                        const parentOutput = node.outputs[i];
                        const subgraphOutput = subgraph.outputs[i];

                        if (parentOutput && parentOutput.links && subgraphOutput) {
                            // Find which internal node produces this output
                            const outputLinkIds = subgraphOutput.linkIds || [];

                            for (const internalLinkId of outputLinkIds) {
                                // Find the link in the subgraph that connects to this output
                                const subgraphLinks = subgraph.links || [];
                                for (const link of subgraphLinks) {
                                    if (link && Array.isArray(link) && link[0] === internalLinkId) {
                                        // link format: [link_id, source_node_id, source_slot, target_node_id, target_slot, type]
                                        const [, sourceNodeId, sourceSlot] = link;

                                        // Store a mapping so parent nodes can reference this
                                        // We'll use the subgraph node ID with the output slot
                                        linkMap[nodeId + ':' + i] = {
                                            nodeId: subgraphPrefix + String(sourceNodeId),
                                            slot: sourceSlot
                                        };
                                    }
                                }
                            }
                        }
                    }
                }

                continue; // Skip adding the subgraph node itself
            }

            // Build inputs from widgets_values and input connections
            const inputs = {};

            // Get widget values (these are the non-connection inputs)
            const widgetValues = node.widgets_values || [];

            // We need to know the widget names for each node type
            // This is a simplified mapping based on common node types
            const widgetNames = getWidgetNamesForNodeType(nodeType);

            widgetNames.forEach((name, index) => {
                if (index < widgetValues.length) {
                    inputs[name] = widgetValues[index];
                }
            });

            // Process input connections
            if (node.inputs) {
                for (const input of node.inputs) {
                    if (input.link !== null && input.link !== undefined) {
                        const linkInfo = linkMap[input.link] || (parentLinkMap && parentLinkMap[input.link]);
                        if (linkInfo) {
                            // Connection format: [sourceNodeId, sourceSlot]
                            inputs[input.name] = [prefix + String(linkInfo.nodeId), linkInfo.slot];
                        }
                    }
                }
            }

            apiWorkflow[nodeId] = {
                class_type: nodeType,
                inputs: inputs,
                _meta: {
                    title: node.title || nodeType
                }
            };
        }

        return linkMap;
    }

    // Process main workflow nodes
    processNodes(litegraphWorkflow.nodes, litegraphWorkflow.links);

    return apiWorkflow;
}

/**
 * Get widget names for common node types
 * This is used to map widget_values array indices to input field names
 */
function getWidgetNamesForNodeType(nodeType) {
    const widgetMappings = {
        'CLIPTextEncode': ['text'],
        'KSampler': ['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
        'KSamplerAdvanced': ['add_noise', 'noise_seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],
        'EmptyLatentImage': ['width', 'height', 'batch_size'],
        'CheckpointLoaderSimple': ['ckpt_name'],
        'LoadImage': ['image', 'upload'],
        'SaveImage': ['filename_prefix'],
        'VAEDecode': [],
        'VAEEncode': [],
        'LoraLoader': ['lora_name', 'strength_model', 'strength_clip'],
        'UNETLoader': ['unet_name', 'weight_dtype'],
        'CLIPLoader': ['clip_name', 'type'],
        'DualCLIPLoader': ['clip_name1', 'clip_name2', 'type'],
        'VAELoader': ['vae_name'],
        'WanImageToVideo': ['width', 'height', 'length', 'batch_size'],
        'VHS_LoadVideo': ['video', 'force_rate', 'force_size', 'custom_width', 'custom_height', 'frame_load_cap', 'skip_first_frames', 'select_every_nth'],
        'LoadVideo': ['video'],
        'FluxGuidance': ['guidance'],
        'EmptyFlux2LatentImage': ['width', 'height', 'batch_size', 'color'],
        'Fusers': ['text_g', 'text_l', 't5xxl', 'clip'] // Guessing for some Flux nodes, but harmless if unused
    };

    return widgetMappings[nodeType] || [];
}

module.exports = {
    parseWorkflow,
    validateWorkflow,
    buildParameterMap,
    convertLitegraphToApi,
    EDITABLE_NODE_TYPES
};
