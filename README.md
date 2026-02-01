# ComfyQ

**ComfyQ** is a web-based middleware for scheduling and managing ComfyUI workflow jobs. It provides a multi-user interface where students or users can schedule AI generation tasks on a shared ComfyUI server with automatic queue management and collision detection.

## Features

### Core Functionality
- **Dual-Mode Operation**: Admin mode for configuration, Student mode for job scheduling
- **ComfyUI Integration**: Automatically launches and manages ComfyUI as a service
- **Workflow Configuration**: Upload any ComfyUI workflow and expose selected parameters to users
- **Multi-User Job Scheduling**: Timeline-based interface for scheduling jobs with collision detection
- **Real-Time Updates**: WebSocket-powered live progress tracking and result notifications
- **Job Management**: Schedule, reorder, cancel, and download generated outputs

### User Features
- Timeline scheduler with drag-and-drop job reordering
- Personal job panel showing your scheduled and completed jobs
- Real-time progress bars during generation
- Image and video support (compatible with various ComfyUI nodes)
- Webcam integration for loading images (mobile-friendly)
- Dashboard with job filtering by user
- Download results directly from the interface

### Admin Features
- Workflow upload and parameter selection
- Admin password protection for managing other users' jobs
- System metrics (average generation time, connected users)
- Job queue management (cancel, reorder any job)
- Mode switching (reset back to admin for reconfiguration)

## Installation

### Prerequisites
- **Node.js** (v16 or higher)
- **npm** or **yarn**
- **ComfyUI** installed and functional on your system
- **Python** (for running ComfyUI)

### Setup Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/ComfyQ.git
   cd ComfyQ
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```
   This will automatically install dependencies for both client and server.

3. **Prepare ComfyUI**:
   - Ensure ComfyUI is installed on your system
   - Note the path to your ComfyUI installation directory
   - Note the path to your Python executable (especially for portable installations)

## Usage

### First-Time Setup (Admin Mode)

1. **Start the development server**:
   ```bash
   npm run dev
   ```

2. **Access the admin interface**:
   - Open your browser and navigate to `http://localhost:3000`
   - You'll be automatically redirected to `/admin` on first startup

3. **Configure your workflow**:
   
   **Step 1: Upload Workflow**
   - Click **"Upload Workflow"** and select a ComfyUI workflow JSON file
   - The system will automatically detect all configurable parameters

   **Step 2: Select Parameters**
   - Review the detected parameters
   - Enable the checkboxes for parameters you want to expose to users
   - Common parameters: prompt, seed, steps, width, height, etc.
   - (Optional) Set an admin password for managing users' jobs

   **Step 3: Configure ComfyUI Paths**
   - **ComfyUI Root Path**: Full path to your ComfyUI installation
     - Example (Windows): `C:/ComfyUI_portable/ComfyUI`
     - Example (Linux/Mac): `/home/user/ComfyUI`
   
   - **Python Executable**: Path to Python for running ComfyUI
     - Portable: `../python_embeded/python.exe` (relative to ComfyUI root)
     - System: `python` or `/usr/bin/python3`
   
   - **Server Settings**: Usually the defaults are fine
     - Server Port: `3000`
     - ComfyUI API Port: `8188`

4. **Save and Launch**:
   - Click **"Save Configuration and Launch for Students"**
   - The server will restart in Student mode
   - ComfyUI will automatically launch and run a benchmark job

### Student Mode (Normal Operation)

Once configured, the system operates in Student mode:

1. **Start the server**:
   ```bash
   npm run dev
   ```

2. **Access the interface**:
   - Navigate to `http://localhost:3000`
   - You'll see the Timeline Scheduler interface

3. **Set your username**:
   - On first visit, enter your name in the username modal
   - This identifies your jobs in the system

4. **Schedule a job**:
   - Click on an empty time slot in the timeline
   - Fill in the exposed parameters (prompt, seed, etc.)
   - Upload images/videos if required by the workflow
   - Click **"Schedule Job"** to add it to the queue

5. **Manage your jobs**:
   - **Reorder**: Drag your scheduled jobs to new time slots
   - **Cancel**: Click the ❌ button on your jobs
   - **View Progress**: Watch real-time progress bars during generation
   - **Download**: Click the download button when jobs complete

6. **View all jobs**:
   - Switch to the **"All Jobs"** tab to see the dashboard
   - Filter jobs by user
   - View system statistics

### Admin Actions in Student Mode

If you have the admin password, you can manage any user's jobs:

1. Try to cancel or move another user's job
2. Enter the admin password when prompted
3. The action will be authorized

You can also reset back to Admin mode:
- Navigate to `/admin` manually
- Click **"Reset to Admin Mode"** to reconfigure

## Configuration

All configuration is done via the admin interface on server startup. The system generates a `config.json` file automatically based on your choices.

### Configuration Schema

The generated `config.json` includes:

```json
{
  "mode": "student",
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "comfy_ui": {
    "installation_type": "portable",
    "root_path": "/path/to/ComfyUI",
    "python_executable": "../python_embeded/python.exe",
    "output_dir": "/path/to/ComfyUI/output",
    "api_host": "127.0.0.1",
    "api_port": 8188
  },
  "workflow": {
    "template_file": "./workflows/your_workflow.json",
    "warmup_prompt": "Test generation",
    "parameter_map": {
      "prompt_param_id": {
        "node_id": "6",
        "field": "text",
        "type": "textarea",
        "label": "Prompt",
        "default": "a beautiful landscape",
        "enabled": true,
        "order": 0
      }
    }
  }
}
```

### Resetting Configuration

To reconfigure the system:
1. Delete `config.json` from the project root
2. Restart the server
3. You'll be back in Admin mode

Or use the "Reset to Admin Mode" button in the admin interface.

## Architecture

### Server Structure
- `server/index.js` - Main Express server, handles routing and mode switching
- `server/bootManager.js` - Manages ComfyUI process lifecycle
- `server/scheduler.js` - Job queue management and execution
- `server/configManager.js` - Configuration file handling
- `server/socketManager.js` - WebSocket communication for real-time updates
- `server/workflowParser.js` - Analyzes ComfyUI workflows to extract parameters
- `server/routes/admin.js` - Admin API endpoints

### Client Structure
- `client/src/App.jsx` - Main React app with routing
- `client/src/pages/AdminConfig.jsx` - Admin configuration interface
- `client/src/pages/Scheduler.jsx` - Timeline scheduler (vis-timeline)
- `client/src/pages/Dashboard.jsx` - Job dashboard and management
- `client/src/components/` - Reusable UI components

## Troubleshooting

### ComfyUI Doesn't Start
- Check that the ComfyUI root path is correct
- Verify Python executable path
- Check server logs for error messages
- Ensure ComfyUI works independently before integrating

### Jobs Aren't Executing
- Check that ComfyUI is running (look for port 8188 activity)
- Verify the workflow template file exists
- Check parameter mappings are correct
- Look for validation errors in browser console

### WebSocket Connection Issues
- Ensure both server (port 3000) and ComfyUI (port 8188) are running
- Check firewall settings
- Try refreshing the browser page

### "Time Slot Collision" Errors
- Jobs cannot overlap in time
- Try scheduling in a different time slot
- Reorder or cancel existing jobs to free up slots

## Development

### Running in Development Mode
```bash
npm run dev
```
Starts both client and server with hot-reload.

### Running Separately
```bash
# Server only
npm run server

# Client only
npm run client
```

### Production Build
```bash
# Build client
cd client && npm run build

# Run server in production
npm start
```

## Acknowledgments

- Built with [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- Timeline powered by [vis-timeline](https://visjs.github.io/vis-timeline/docs/timeline/)
- UI components from [Lucide React](https://lucide.dev/)