/**
 * Workflow Registry - Multi-Workflow Management System
 * 
 * Manages the discovery, loading, and serving of multiple ComfyUI workflows.
 * Workflows are stored in the `workflows/` directory with optional `.meta.json`
 * metadata files that describe the workflow and its exposed parameters.
 * 
 * Directory Structure:
 * workflows/
 * ├── text2image_sdxl.json
 * ├── text2image_sdxl.meta.json        (optional metadata)
 * ├── image_flux2_klein_image_edit.json
 * ├── image_flux2_klein_image_edit.meta.json
 * └── ...
 * 
 * If no .meta.json exists, the system will auto-generate basic metadata
 * by parsing the workflow JSON using workflowParser.
 * 
 * @module server/workflowRegistry
 */

const fs = require('fs');
const path = require('path');
const { parseWorkflow, validateWorkflow, buildParameterMap, convertLitegraphToApi } = require('./workflowParser');

const WORKFLOWS_DIR = path.resolve(__dirname, '../workflows');

/**
 * Workflow metadata schema (from .meta.json files)
 * @typedef {Object} WorkflowMetadata
 * @property {string} name - Human-readable workflow name
 * @property {string} description - Description of what the workflow does
 * @property {string} category - Category for grouping (e.g., 't2i', 'image-edit', 'i2v')
 * @property {string|null} thumbnail - Thumbnail image filename (optional)
 * @property {string} author - Workflow author
 * @property {string} version - Version string
 * @property {string[]} tags - Searchable tags
 * @property {number} estimatedTime - Estimated generation time in seconds
 * @property {Object} requirements - Model/VRAM requirements
 * @property {Object} presets - Named parameter presets
 * @property {Array} exposedParameters - Parameters to expose to users
 */

/**
 * In-memory cache of loaded workflows
 * @type {Map<string, Object>}
 */
const workflowCache = new Map();

/**
 * Generates a workflow ID from filename
 * @param {string} filename - Workflow JSON filename
 * @returns {string} Sanitized workflow ID
 */
function generateWorkflowId(filename) {
    return path.basename(filename, '.json')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');
}

/**
 * Loads metadata for a workflow from its .meta.json file
 * @param {string} workflowPath - Path to the workflow JSON file
 * @returns {Object|null} Metadata object or null if not found
 */
function loadMetadata(workflowPath) {
    const metaPath = workflowPath.replace('.json', '.meta.json');

    if (fs.existsSync(metaPath)) {
        try {
            const metaContent = fs.readFileSync(metaPath, 'utf8');
            return JSON.parse(metaContent);
        } catch (error) {
            console.error(`[WorkflowRegistry] Error loading metadata: ${metaPath}`, error.message);
            return null;
        }
    }

    return null;
}

/**
 * Generates default metadata for workflows without .meta.json
 * @param {string} workflowPath - Path to the workflow JSON file
 * @param {Object} workflowJson - Parsed workflow JSON
 * @returns {Object} Generated metadata
 */
function generateDefaultMetadata(workflowPath, workflowJson) {
    const filename = path.basename(workflowPath, '.json');
    const parsed = parseWorkflow(workflowJson);

    // Infer category from filename
    let category = 'other';
    const lowerFilename = filename.toLowerCase();
    if (lowerFilename.includes('t2i') || lowerFilename.includes('text2image') || lowerFilename.includes('txt2img')) {
        category = 't2i';
    } else if (lowerFilename.includes('edit') || lowerFilename.includes('i2i') || lowerFilename.includes('img2img')) {
        category = 'image-edit';
    } else if (lowerFilename.includes('i2v') || lowerFilename.includes('video') || lowerFilename.includes('img2vid')) {
        category = 'i2v';
    } else if (lowerFilename.includes('audio') || lowerFilename.includes('sound') || lowerFilename.includes('music')) {
        category = 'audio';
    } else if (lowerFilename.includes('3d') || lowerFilename.includes('mesh')) {
        category = '3d';
    }

    // Generate human-readable name from filename
    const name = filename
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();

    return {
        name: name,
        description: `Auto-generated workflow: ${name}`,
        category: category,
        thumbnail: null,
        author: 'Unknown',
        version: '1.0',
        tags: [category],
        estimatedTime: 60,
        requirements: {
            models: [],
            minVRAM: 8
        },
        presets: {},
        exposedParameters: parsed.parameters
            .filter(p => p.enabled || ['text', 'textarea', 'image', 'video'].includes(p.type))
            .map(p => ({
                nodeId: p.nodeId,
                field: p.field,
                label: p.label,
                type: p.type,
                required: p.type === 'image' || p.type === 'video' || p.field === 'text',
                order: p.order
            }))
    };
}

/**
 * Loads a specific workflow file and its metadata
 * @param {string} workflowPath - Absolute path to workflow file
 * @param {string} [explicitId] - Optional explicit ID (e.g., folder name)
 * @returns {Object|null} Workflow object or null if invalid
 */
function loadWorkflow(workflowPath, explicitId = null) {
    try {
        // Basic validation
        if (!fs.existsSync(workflowPath)) return null;

        const filename = path.basename(workflowPath);
        const workflowId = explicitId || generateWorkflowId(filename);

        // Identify metadata files
        // Priority: 
        // 1. Explicit ID based (folder name): folder/id.meta.json
        // 2. Filename based: folder/file.meta.json
        const dir = path.dirname(workflowPath);
        let metaPath = path.join(dir, `${workflowId}.meta.json`);
        let hasCustomMetadata = false;

        if (!fs.existsSync(metaPath)) {
            metaPath = workflowPath.replace('.json', '.meta.json');
        }

        // Try to load metadata
        let metadata = {};
        if (fs.existsSync(metaPath)) {
            try {
                const metaContent = fs.readFileSync(metaPath, 'utf8');
                metadata = JSON.parse(metaContent);
                hasCustomMetadata = true;
            } catch (error) {
                console.error(`[WorkflowRegistry] Error loading metadata from ${metaPath}:`, error.message);
                // Continue without custom metadata
            }
        }

        // Load workflow JSON
        const workflowContent = fs.readFileSync(workflowPath, 'utf8');
        let workflowJson = JSON.parse(workflowContent);

        // Validate workflow
        const validation = validateWorkflow(workflowJson);
        if (!validation.valid) {
            console.error(`[WorkflowRegistry] Invalid workflow: ${workflowPath}`, validation.error);
            return null;
        }

        // Convert Litegraph format to API format if needed
        let apiWorkflow = workflowJson;
        if (validation.format === 'litegraph') {
            console.log(`[WorkflowRegistry] Converting Litegraph format: ${path.basename(workflowPath)}`);
            apiWorkflow = convertLitegraphToApi(workflowJson);
        }

        // If no custom metadata was loaded, generate default
        if (!hasCustomMetadata || Object.keys(metadata).length === 0) {
            metadata = generateDefaultMetadata(workflowPath, apiWorkflow);
        }

        return {
            id: workflowId,
            path: workflowPath,
            relativePath: `./workflows/${path.relative(WORKFLOWS_DIR, workflowPath).replace(/\\/g, '/')}`,
            workflow: workflowJson,  // Store original format
            apiWorkflow: apiWorkflow, // Store API format for execution
            format: validation.format,
            metadata: metadata,
            hasCustomMetadata: hasCustomMetadata
        };

    } catch (error) {
        console.error(`[WorkflowRegistry] Error loading workflow: ${workflowPath}`, error.message);
        return null;
    }
}

/**
 * Discovers and loads all workflows from the workflows directory
 * Treats each subdirectory as a "Workflow Bundle", picking the best file inside.
 * Also supports root-level JSON files for backward compatibility.
 * @returns {Array<Object>} Array of loaded workflow objects
 */
function discoverWorkflows() {
    console.log('[WorkflowRegistry] Discovering workflows...');

    // Ensure workflows directory exists
    if (!fs.existsSync(WORKFLOWS_DIR)) {
        console.warn('[WorkflowRegistry] Workflows directory not found, creating...');
        fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
        return [];
    }

    // Helper to check if file is a workflow json
    const isWorkflowFile = (filename) => {
        const lower = filename.toLowerCase();
        return lower.endsWith('.json') &&
            !lower.endsWith('.meta.json') &&
            !lower.includes('.config.');
    };

    const workflows = [];
    const entries = fs.readdirSync(WORKFLOWS_DIR, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.isDirectory()) {
            // FOLDER MODE: The directory IS the workflow
            const dirPath = path.join(WORKFLOWS_DIR, entry.name);
            const subFiles = fs.readdirSync(dirPath).filter(isWorkflowFile);

            if (subFiles.length === 0) continue;

            // Pick the best file.
            // Priority:
            // 1. Exact match with "_api" suffix (e.g., mywf_api.json)
            // 2. Exact match with "_json" suffix (e.g., mywf_json.json)
            // 3. Exact match with folder name (e.g., mywf.json)
            // 4. Shortest filename (heuristic for "base" version)? Or alphabetical.

            let selectedFile = subFiles[0]; // Default to first

            // Try explicit naming conventions
            const apiMatch = subFiles.find(f => f.toLowerCase().includes('_api.json'));
            const jsonMatch = subFiles.find(f => f.toLowerCase().includes('_json.json'));

            if (apiMatch) {
                selectedFile = apiMatch;
            } else if (jsonMatch) {
                selectedFile = jsonMatch;
            } else {
                const exactMatch = subFiles.find(f => path.basename(f, '.json') === entry.name);
                if (exactMatch) selectedFile = exactMatch;
            }

            const workflowPath = path.join(dirPath, selectedFile);
            const workflow = loadWorkflow(workflowPath, entry.name); // Use folder name as ID

            if (workflow) {
                workflows.push(workflow);
                workflowCache.set(workflow.id, workflow);
                console.log(`[WorkflowRegistry] Loaded bundle: ${workflow.metadata.name} (${workflow.id}) from ${selectedFile}`);
            }

        } else if (entry.isFile() && isWorkflowFile(entry.name)) {
            // ROOT FILE MODE (Legacy)
            const workflowPath = path.join(WORKFLOWS_DIR, entry.name);
            const workflow = loadWorkflow(workflowPath); // ID derived from filename

            if (workflow) {
                workflows.push(workflow);
                workflowCache.set(workflow.id, workflow);
                console.log(`[WorkflowRegistry] Loaded file: ${workflow.metadata.name} (${workflow.id})`);
            }
        }
    }

    console.log(`[WorkflowRegistry] Successfully loaded ${workflows.length} workflows`);
    return workflows;
}

/**
 * Gets a workflow by ID from cache
 * @param {string} workflowId - Workflow ID
 * @returns {Object|null} Workflow object or null if not found
 */
function getWorkflow(workflowId) {
    return workflowCache.get(workflowId) || null;
}

/**
 * Gets all loaded workflows
 * @returns {Array<Object>} Array of all workflow objects
 */
function getAllWorkflows() {
    return Array.from(workflowCache.values());
}

/**
 * Gets workflow summaries for the client (without full workflow JSON)
 * @returns {Array<Object>} Array of workflow summaries
 */
function getWorkflowSummaries() {
    return getAllWorkflows().map(w => ({
        id: w.id,
        name: w.metadata.name,
        description: w.metadata.description,
        category: w.metadata.category,
        thumbnail: w.metadata.thumbnail,
        tags: w.metadata.tags,
        estimatedTime: w.metadata.estimatedTime,
        hasCustomMetadata: w.hasCustomMetadata,
        presets: Object.keys(w.metadata.presets || {}),
        parameterCount: (w.metadata.exposedParameters || []).length
    }));
}

/**
 * Gets workflows grouped by category
 * @returns {Object} Object with categories as keys and workflow arrays as values
 */
function getWorkflowsByCategory() {
    const categories = {};

    for (const workflow of getAllWorkflows()) {
        const category = workflow.metadata.category || 'other';
        if (!categories[category]) {
            categories[category] = [];
        }
        categories[category].push({
            id: workflow.id,
            name: workflow.metadata.name,
            description: workflow.metadata.description,
            thumbnail: workflow.metadata.thumbnail
        });
    }

    return categories;
}

/**
 * Gets the parameter map for a specific workflow
 * Combines metadata exposedParameters with parsed workflow data
 * @param {string} workflowId - Workflow ID
 * @returns {Object|null} Parameter map for config, or null if not found
 */
function getWorkflowParameterMap(workflowId) {
    const workflow = getWorkflow(workflowId);
    if (!workflow) return null;

    const exposedParams = workflow.metadata.exposedParameters || [];

    // Build parameter map from exposed parameters
    const parameterMap = {};

    for (const param of exposedParams) {
        const key = `${param.field}_${param.nodeId}`;
        parameterMap[key] = {
            node_id: param.nodeId,
            field: param.field,
            type: param.type || 'text',
            label: param.label || param.field,
            default: param.default,
            enabled: true,
            order: param.order || 0,
            required: param.required || false,
            min: param.min,
            max: param.max,
            placeholder: param.placeholder,
            options: param.options
        };
    }

    return parameterMap;
}

/**
 * Applies a preset to get parameter values
 * @param {string} workflowId - Workflow ID
 * @param {string} presetName - Name of the preset
 * @returns {Object|null} Preset values or null if not found
 */
function applyPreset(workflowId, presetName) {
    const workflow = getWorkflow(workflowId);
    if (!workflow) return null;

    const presets = workflow.metadata.presets || {};
    const preset = presets[presetName];

    if (!preset) return null;

    return preset.values || preset;
}

/**
 * Refreshes the workflow cache by re-discovering all workflows
 * @returns {Array<Object>} Updated array of workflows
 */
function refreshWorkflows() {
    workflowCache.clear();
    return discoverWorkflows();
}

/**
 * Gets category display names
 * @returns {Object} Category ID to display name mapping
 */
function getCategoryNames() {
    return {
        't2i': 'Text to Image',
        'image-edit': 'Image Editing',
        'i2v': 'Image to Video',
        'audio': 'Audio Generation',
        '3d': '3D Generation',
        'other': 'Other'
    };
}

module.exports = {
    discoverWorkflows,
    getWorkflow,
    getAllWorkflows,
    getWorkflowSummaries,
    getWorkflowsByCategory,
    getWorkflowParameterMap,
    applyPreset,
    refreshWorkflows,
    getCategoryNames,
    generateWorkflowId
};
