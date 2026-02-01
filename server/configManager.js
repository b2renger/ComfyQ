/**
 * Configuration Manager - Configuration File Handling
 * 
 * Manages reading, writing, and validating the application's config.json file.
 * Handles mode switching (admin/student), workflow configuration saving,
 * and path resolution for ComfyUI and workflow files.
 * 
 * Configuration Flow:
 * 1. Admin mode: No workflow configured, admin uploads and configures
 * 2. Configuration saved: saveAndSwitchToStudentMode() writes config.json
 * 3. Student mode: Workflow configured, system ready for scheduling
 * 4. Reset: resetToAdminMode() switches back for reconfiguration
 * 
 * @module server/configManager
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '../config.json');
const WORKFLOWS_DIR = path.resolve(__dirname, '../workflows');

/**
 * Reads the current configuration from config.json.
 * 
 * @returns {Object} The parsed configuration object
 * @throws {Error} If config.json doesn't exist or is invalid JSON
 */
function readConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        throw new Error(`Config file not found at ${CONFIG_PATH}`);
    }

    const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(configData);
}

/**
 * Writes configuration to disk as config.json.
 * 
 * @param {Object} config - Configuration object to save
 */
function writeConfig(config) {
    const configJson = JSON.stringify(config, null, 2);
    fs.writeFileSync(CONFIG_PATH, configJson, 'utf8');
    console.log('[ConfigManager] Configuration saved successfully');
}

/**
 * Gets the current server mode from config.json.
 * 
 * @returns {string} Either 'admin' or 'student', defaults to 'student' on error
 */
function getMode() {
    try {
        const config = readConfig();
        return config.mode || 'student'; // Default to student mode
    } catch (error) {
        console.error('[ConfigManager] Error reading mode:', error.message);
        return 'student';
    }
}

/**
 * Set server mode
 */
function setMode(mode) {
    if (mode !== 'admin' && mode !== 'student') {
        throw new Error('Mode must be either "admin" or "student"');
    }

    const config = readConfig();
    config.mode = mode;
    writeConfig(config);
    console.log(`[ConfigManager] Mode set to: ${mode}`);
}

/**
 * Save workflow file to workflows directory
 * @param {Object} workflowData - Workflow JSON object
 * @param {String} filename - Filename to save as
 * @returns {String} - Relative path to saved file
 */
function saveWorkflow(workflowData, filename) {
    // Ensure workflows directory exists
    if (!fs.existsSync(WORKFLOWS_DIR)) {
        fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
    }

    // Sanitize filename
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const workflowPath = path.join(WORKFLOWS_DIR, sanitizedFilename);

    // Write workflow file
    const workflowJson = JSON.stringify(workflowData, null, 2);
    fs.writeFileSync(workflowPath, workflowJson, 'utf8');

    console.log(`[ConfigManager] Workflow saved to: ${workflowPath}`);

    // Return relative path for config.json
    return `./workflows/${sanitizedFilename}`;
}


/**
 * Updates the workflow section of the configuration.
 * 
 * @param {Object} workflowConfig - New workflow configuration
 * @param {string} workflowConfig.template_file - Path to workflow JSON file
 * @param {Object} workflowConfig.parameter_map - Parameter mappings for the workflow
 * @param {string} [workflowConfig.warmup_prompt] - Prompt for benchmark generation
 * @throws {Error} If required fields are missing
 */
function updateWorkflowConfig(workflowConfig) {
    const config = readConfig();

    // Validate required fields
    if (!workflowConfig.template_file) {
        throw new Error('template_file is required');
    }

    if (!workflowConfig.parameter_map) {
        throw new Error('parameter_map is required');
    }

    // Update workflow section
    config.workflow = {
        template_file: workflowConfig.template_file,
        warmup_prompt: workflowConfig.warmup_prompt || 'Test prompt',
        parameter_map: workflowConfig.parameter_map
    };

    writeConfig(config);
    console.log('[ConfigManager] Workflow configuration updated');
}


/**
 * Gets the current workflow configuration from config.json.
 * 
 * @returns {Object|null} Workflow configuration or null if not set
 */
function getWorkflowConfig() {
    const config = readConfig();
    return config.workflow || null;
}

/**
 * Saves a workflow and switches the server to student mode.
 * 
 * This is the main function called by the admin interface when configuration
 * is complete. It performs all steps needed to transition to student mode:
 * 1. Saves the workflow JSON file
 * 2. Updates workflow configuration
 * 3. Switches mode to 'student'
 * 
 * @param {Object} workflowData - Complete ComfyUI workflow JSON
 * @param {string} filename - Filename for the workflow
 * @param {Object} parameterMap - User-selected parameter mappings
 * @param {string} warmupPrompt - Prompt for the benchmark generation
 */
function saveAndSwitchToStudentMode(workflowData, filename, parameterMap, warmupPrompt) {
    // Save workflow file to workflows directory
    const workflowPath = saveWorkflow(workflowData, filename);

    // Update workflow configuration in config.json
    updateWorkflowConfig({
        template_file: workflowPath,
        warmup_prompt: warmupPrompt,
        parameter_map: parameterMap
    });

    // Switch mode to student
    setMode('student');

    console.log('[ConfigManager] Configuration complete. Ready for student mode.');
}

/**
 * Switches the server back to admin mode for reconfiguration.
 */
function resetToAdminMode() {
    setMode('admin');
    console.log('[ConfigManager] Reset to admin mode');
}

/**
 * Initialize mode if not set
 */
function initializeMode() {
    const config = readConfig();

    if (!config.mode) {
        // Default to admin mode if no workflow is configured
        if (!config.workflow || !config.workflow.template_file) {
            config.mode = 'admin';
        } else {
            config.mode = 'student';
        }
        writeConfig(config);
        console.log(`[ConfigManager] Initialized mode to: ${config.mode}`);
    }

    return config.mode;
}

/**
 * Resolve relative paths in configuration
 * @param {Object} config - Raw configuration object
 * @returns {Object} - Configuration with absolute paths
 */
function resolveConfigPaths(config) {
    const resolvedConfig = JSON.parse(JSON.stringify(config)); // Deep copy

    // Resolve ComfyUI root path
    if (resolvedConfig.comfy_ui && resolvedConfig.comfy_ui.root_path) {
        // If root_path is relative, resolve it relative to config.json location (parent of server dir)
        // config.json is in ../ relative to __dirname (server/)
        const projectRoot = path.resolve(__dirname, '..');
        resolvedConfig.comfy_ui.root_path = path.resolve(projectRoot, resolvedConfig.comfy_ui.root_path);

        const rootPath = resolvedConfig.comfy_ui.root_path;

        // Resolve python executable
        if (resolvedConfig.comfy_ui.python_executable) {
            let pythonExec = resolvedConfig.comfy_ui.python_executable;
            if (pythonExec.startsWith('.') || pythonExec.startsWith('..')) {
                // If relative, assume relative to ComfyUI root
                pythonExec = path.resolve(rootPath, pythonExec);
            } else {
                // If absolute or just command name
                if (pythonExec.includes('/') || pythonExec.includes('\\')) {
                    pythonExec = path.resolve(pythonExec);
                }
            }
            resolvedConfig.comfy_ui.python_executable = pythonExec;
        }

        // Resolve output directory
        if (resolvedConfig.comfy_ui.output_dir) {
            // output_dir is relative to ComfyUI root usually
            resolvedConfig.comfy_ui.output_dir = path.resolve(rootPath, resolvedConfig.comfy_ui.output_dir);
        }
    }

    // Resolve workflow template path
    if (resolvedConfig.workflow && resolvedConfig.workflow.template_file) {
        const projectRoot = path.resolve(__dirname, '..');
        resolvedConfig.workflow.template_file = path.resolve(projectRoot, resolvedConfig.workflow.template_file);
    }

    return resolvedConfig;
}

module.exports = {
    readConfig,
    writeConfig,
    getMode,
    setMode,
    saveWorkflow,
    updateWorkflowConfig,
    getWorkflowConfig,
    saveAndSwitchToStudentMode,
    resetToAdminMode,
    initializeMode,
    resolveConfigPaths
};
