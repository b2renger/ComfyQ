const fs = require('fs');
const path = require('path');

function loadConfig() {
    const configPath = path.resolve(__dirname, '../config.json');
    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found at ${configPath}`);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // Resolve ComfyUI root path
    const rootPath = path.resolve(config.comfy_ui.root_path);
    config.comfy_ui.root_path = rootPath;

    // Resolve python executable
    let pythonExec = config.comfy_ui.python_executable;
    if (pythonExec.startsWith('.') || pythonExec.startsWith('..')) {
        pythonExec = path.resolve(rootPath, pythonExec);
    } else {
        pythonExec = path.resolve(pythonExec);
    }
    config.comfy_ui.python_executable = pythonExec;

    // Resolve output directory
    const outputDir = path.resolve(rootPath, config.comfy_ui.output_dir);
    config.comfy_ui.output_dir = outputDir;

    // Resolve workflow template path
    config.workflow.template_file = path.resolve(__dirname, '..', config.workflow.template_file);

    return config;
}

module.exports = { loadConfig };
