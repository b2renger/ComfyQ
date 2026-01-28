/**
 * Admin API Routes
 * Endpoints for workflow configuration and server management
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseWorkflow, validateWorkflow, buildParameterMap } = require('../workflowParser');
const configManager = require('../configManager');

const router = express.Router();

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

        // Validate workflow structure
        const validation = validateWorkflow(workflowJson);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        // Parse workflow and extract parameters
        const parsed = parseWorkflow(workflowJson);

        console.log(`[Admin] Workflow uploaded: ${req.file.originalname}`);
        console.log(`[Admin] Found ${parsed.editableCount} editable parameters in ${parsed.nodeCount} nodes`);

        res.json({
            success: true,
            filename: req.file.originalname,
            nodeCount: parsed.nodeCount,
            editableCount: parsed.editableCount,
            parameters: parsed.parameters,
            workflow: workflowJson // Send back for storage in frontend
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

module.exports = router;
