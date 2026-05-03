/**
 * Admin API Routes
 * Endpoints for workflow configuration and server management
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseWorkflow, validateWorkflow, buildParameterMap, convertLitegraphToApi } = require('../workflowParser');
const configManager = require('../configManager');
const workflowRegistry = require('../workflowRegistry');

const router = express.Router();

// Initialize workflow registry on module load
workflowRegistry.discoverWorkflows();

// Configure multer for workflow file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
            cb(null, true);
        } else {
            cb(new Error('Only JSON files are allowed'));
        }
    }
});

/**
 * POST /admin/upload-workflow
 * Upload and parse a ComfyUI workflow file
 */
router.post('/upload-workflow', upload.single('workflow'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Parse JSON
        const workflowJson = JSON.parse(req.file.buffer.toString('utf8'));

        // Validate and convert workflow format if needed
        const validation = validateWorkflow(workflowJson);

        if (!validation.valid) {
            return res.status(400).json({
                error: 'Invalid workflow format',
                details: validation.error
            });
        }

        // Convert to API format if it's in Litegraph format
        let apiWorkflow = workflowJson;
        if (validation.format === 'litegraph') {
            console.log(`[Admin] Converting Litegraph format workflow: ${req.file.originalname}`);
            apiWorkflow = convertLitegraphToApi(workflowJson);
        }

        // Parse workflow and extract parameters (using API format)
        const parsed = parseWorkflow(apiWorkflow);

        console.log(`[Admin] Workflow uploaded: ${req.file.originalname}`);
        console.log(`[Admin] Found ${parsed.editableCount} editable parameters in ${parsed.nodeCount} nodes`);

        res.json({
            success: true,
            filename: req.file.originalname,
            nodeCount: parsed.nodeCount,
            editableCount: parsed.editableCount,
            parameters: parsed.parameters,
            workflow: workflowJson // Send back original format for storage
        });

    } catch (error) {
        console.error('[Admin] Error parsing workflow:', error);
        res.status(400).json({
            error: 'Invalid workflow file',
            details: error.message
        });
    }
});

/**
 * POST /admin/save-config
 * Save workflow configuration and prepare to switch modes
 */
router.post('/save-config', express.json({ limit: '10mb' }), (req, res) => {
    try {
        const { workflow, filename, selectedParameters, warmupPrompt } = req.body;

        if (!workflow || !filename || !selectedParameters) {
            return res.status(400).json({
                error: 'Missing required fields: workflow, filename, selectedParameters'
            });
        }

        // Filter only enabled parameters
        const enabledParams = selectedParameters.filter(p => p.enabled);

        if (enabledParams.length === 0) {
            return res.status(400).json({
                error: 'At least one parameter must be enabled'
            });
        }

        // Build parameter map
        const parameterMap = buildParameterMap(enabledParams);

        // Save workflow and update config
        configManager.saveAndSwitchToStudentMode(
            workflow,
            filename,
            parameterMap,
            warmupPrompt || 'Test prompt'
        );

        console.log(`[Admin] Configuration saved with ${enabledParams.length} parameters`);

        res.json({
            success: true,
            message: 'Configuration saved successfully',
            parametersEnabled: enabledParams.length,
            mode: 'student'
        });

    } catch (error) {
        console.error('[Admin] Error saving config:', error);
        res.status(500).json({
            error: 'Failed to save configuration',
            details: error.message
        });
    }
});

/**
 * POST /admin/restart-server
 * Trigger server restart (process exit, assuming pm2 or nodemon is managing)
 */
router.post('/restart-server', (req, res) => {
    console.log('[Admin] Server restart requested');

    res.json({
        success: true,
        message: 'Server restarting...'
    });

    // Exit process after short delay to allow response to send
    setTimeout(() => {
        console.log('[Admin] Exiting process for restart');
        process.exit(0);
    }, 500);
});

/**
 * GET /admin/current-config
 * Get current workflow configuration
 */
router.get('/current-config', (req, res) => {
    try {
        const mode = configManager.getMode();
        const workflowConfig = configManager.getWorkflowConfig();

        res.json({
            mode,
            workflow: workflowConfig
        });
    } catch (error) {
        console.error('[Admin] Error getting config:', error);
        res.status(500).json({
            error: 'Failed to read configuration',
            details: error.message
        });
    }
});

/**
 * POST /admin/reset-to-admin
 * Reset server back to admin mode for reconfiguration
 */
router.post('/reset-to-admin', (req, res) => {
    try {
        configManager.resetToAdminMode();

        res.json({
            success: true,
            message: 'Server reset to admin mode. Restart required.',
            mode: 'admin'
        });

        // Trigger restart
        setTimeout(() => {
            console.log('[Admin] Exiting process for restart to admin mode');
            process.exit(0);
        }, 500);

    } catch (error) {
        console.error('[Admin] Error resetting to admin mode:', error);
        res.status(500).json({
            error: 'Failed to reset mode',
            details: error.message
        });
    }
});

/**
 * GET /admin/mode
 * Get current server mode
 */
router.get('/mode', (req, res) => {
    try {
        const mode = configManager.getMode();
        res.json({ mode });
    } catch (error) {
        console.error('[Admin] Error getting mode:', error);
        res.status(500).json({
            error: 'Failed to get mode',
            details: error.message
        });
    }
});

/**
 * GET /admin/workflow-file
 * Get the content of the currently configured workflow file
 */
router.get('/workflow-file', (req, res) => {
    try {
        let config = configManager.readConfig();
        // Resolve paths to find the file
        config = configManager.resolveConfigPaths(config);

        const workflowPath = config.workflow?.template_file;

        if (!workflowPath || !fs.existsSync(workflowPath)) {
            return res.status(404).json({ error: 'No workflow file configured or file not found' });
        }

        const workflowData = fs.readFileSync(workflowPath, 'utf8');
        const workflowJson = JSON.parse(workflowData);

        res.json(workflowJson);
    } catch (error) {
        console.error('[Admin] Error reading workflow file:', error);
        res.status(500).json({
            error: 'Failed to read workflow file',
            details: error.message
        });
    }
});

// ========================================
// WORKFLOW REGISTRY API ENDPOINTS (v2)
// ========================================

/**
 * GET /admin/workflows
 * List all available workflows with their summaries
 */
router.get('/workflows', (req, res) => {
    try {
        const workflows = workflowRegistry.getWorkflowSummaries();
        const categories = workflowRegistry.getCategoryNames();

        res.json({
            workflows,
            categories,
            total: workflows.length
        });
    } catch (error) {
        console.error('[Admin] Error listing workflows:', error);
        res.status(500).json({
            error: 'Failed to list workflows',
            details: error.message
        });
    }
});

/**
 * GET /admin/workflows/categories
 * Get workflows grouped by category
 */
router.get('/workflows/categories', (req, res) => {
    try {
        const byCategory = workflowRegistry.getWorkflowsByCategory();
        const categoryNames = workflowRegistry.getCategoryNames();

        res.json({
            categories: byCategory,
            categoryNames
        });
    } catch (error) {
        console.error('[Admin] Error getting workflow categories:', error);
        res.status(500).json({
            error: 'Failed to get workflow categories',
            details: error.message
        });
    }
});

/**
 * GET /admin/workflows/:id
 * Get full details for a specific workflow
 */
router.get('/workflows/:id', (req, res) => {
    try {
        const workflow = workflowRegistry.getWorkflow(req.params.id);

        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json({
            id: workflow.id,
            path: workflow.relativePath,
            metadata: workflow.metadata,
            parameterMap: workflowRegistry.getWorkflowParameterMap(workflow.id),
            hasCustomMetadata: workflow.hasCustomMetadata
        });
    } catch (error) {
        console.error('[Admin] Error getting workflow:', error);
        res.status(500).json({
            error: 'Failed to get workflow',
            details: error.message
        });
    }
});

/**
 * GET /admin/workflows/:id/parameters
 * Get the parameter map for a workflow (for dynamic form generation)
 */
router.get('/workflows/:id/parameters', (req, res) => {
    try {
        const parameterMap = workflowRegistry.getWorkflowParameterMap(req.params.id);

        if (!parameterMap) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json({ parameters: parameterMap });
    } catch (error) {
        console.error('[Admin] Error getting workflow parameters:', error);
        res.status(500).json({
            error: 'Failed to get workflow parameters',
            details: error.message
        });
    }
});

/**
 * GET /admin/workflows/:id/all-parameters
 * Parse the workflow and return ALL available parameters (not just exposed ones)
 * Used for parameter configuration in admin interface
 */
router.get('/workflows/:id/all-parameters', (req, res) => {
    try {
        const workflow = workflowRegistry.getWorkflow(req.params.id);

        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        // Use apiWorkflow (converted format) for parsing
        const workflowToParse = workflow.apiWorkflow || workflow.workflow;

        // Parse the workflow to get all parameters
        const { parseWorkflow } = require('../workflowParser');
        const parsed = parseWorkflow(workflowToParse);

        res.json({
            parameters: parsed.parameters,
            filename: workflow.relativePath
        });
    } catch (error) {
        console.error('[Admin] Error parsing workflow parameters:', error);
        res.status(500).json({
            error: 'Failed to parse workflow parameters',
            details: error.message
        });
    }
});

/**
 * GET /admin/workflows/:id/presets/:presetName
 * Apply a preset and get the parameter values
 */
router.get('/workflows/:id/presets/:presetName', (req, res) => {
    try {
        const presetValues = workflowRegistry.applyPreset(req.params.id, req.params.presetName);

        if (!presetValues) {
            return res.status(404).json({ error: 'Preset not found' });
        }

        res.json({ values: presetValues });
    } catch (error) {
        console.error('[Admin] Error applying preset:', error);
        res.status(500).json({
            error: 'Failed to apply preset',
            details: error.message
        });
    }
});

/**
 * POST /admin/workflows/refresh
 * Refresh the workflow registry (re-discover workflows)
 */
router.post('/workflows/refresh', (req, res) => {
    try {
        const workflows = workflowRegistry.refreshWorkflows();

        res.json({
            success: true,
            message: `Refreshed workflow registry, found ${workflows.length} workflows`,
            workflows: workflowRegistry.getWorkflowSummaries()
        });
    } catch (error) {
        console.error('[Admin] Error refreshing workflows:', error);
        res.status(500).json({
            error: 'Failed to refresh workflows',
            details: error.message
        });
    }
});

/**
 * POST /admin/workflows/save
 * Save a new workflow with metadata to the workflows directory
 */
router.post('/workflows/save', express.json({ limit: '10mb' }), (req, res) => {
    try {
        const {
            workflow,
            filename,
            name,
            description,
            category,
            exposedParameters,
            presets
        } = req.body;

        if (!workflow || !filename || !name) {
            return res.status(400).json({
                error: 'Missing required fields: workflow, filename, name'
            });
        }

        // Sanitize filename
        const sanitizedFilename = filename
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .replace(/\.json$/i, '') + '.json';

        const workflowPath = path.join(__dirname, '../../workflows', sanitizedFilename);
        const metaPath = workflowPath.replace('.json', '.meta.json');

        // Save workflow JSON
        fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2), 'utf8');
        console.log(`[Admin] Saved workflow: ${sanitizedFilename}`);

        // Generate and save metadata
        const metadata = {
            name: name,
            description: description || `Workflow: ${name}`,
            category: category || 'other',
            thumbnail: null,
            author: 'Admin',
            version: '1.0',
            tags: [category || 'other'],
            estimatedTime: 60,
            requirements: {
                models: [],
                minVRAM: 8
            },
            presets: presets || {},
            exposedParameters: exposedParameters || []
        };

        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
        console.log(`[Admin] Saved metadata: ${sanitizedFilename.replace('.json', '.meta.json')}`);

        // Refresh registry
        workflowRegistry.refreshWorkflows();

        res.json({
            success: true,
            message: `Workflow "${name}" saved successfully`,
            workflowId: workflowRegistry.generateWorkflowId(sanitizedFilename),
            files: {
                workflow: sanitizedFilename,
                metadata: sanitizedFilename.replace('.json', '.meta.json')
            }
        });

    } catch (error) {
        console.error('[Admin] Error saving workflow:', error);
        res.status(500).json({
            error: 'Failed to save workflow',
            details: error.message
        });
    }
});

module.exports = router;
