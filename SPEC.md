Here is the updated, comprehensive specification. It includes the Dashboard, the Advanced Configuration system, and the Image Serving logic.

You can feed this entire block to an LLM to generate the code.

Project Specification: ComfyScheduler (Node.js + Dashboard & Config)
1. Project Overview

Goal: A Node.js middleware and React web interface for ComfyUI.
Core Philosophy: A "Time-Slot" booking system (not a FIFO queue). Users reserve a specific time for generation based on real-world duration estimates.
New Components:

Dashboard: A high-level view of all operations, connected users, and past/future jobs.

Config Loader: A robust system to handle local or portable ComfyUI installations and map file paths.

Asset Server: The Node.js server will expose the ComfyUI output directory to display generated images in the UI.

2. Technical Stack

Backend: Node.js (Express + Socket.io + Chokidar/FS).

Frontend: React (Vite) + TailwindCSS + React-Router (for / vs /dashboard).

Visualization: vis-timeline (for the scheduler) and TanStack Table (for the dashboard).

3. Configuration System (config.json)

The application must load a config.json at startup. This file dictates how the server controls the subprocess and where it finds files.

JSON Structure Specification:

code
JSON
download
content_copy
expand_less
{
  "server": {
    "port": 3000,
    "host": "localhost"
  },
  "comfy_ui": {
    "installation_type": "portable", 
    "root_path": "C:/AI/ComfyUI_windows_portable/ComfyUI",
    "python_executable": "../python_embeded/python.exe", 
    "output_dir": "output", 
    "api_host": "127.0.0.1",
    "api_port": 8188
  },
  "workflow": {
    "template_file": "./workflows/flux_klein_api.json",
    "warmup_prompt": "A simple color gradient",
    "parameter_map": {
      "prompt": { "node_id": "6", "field": "text" },
      "seed": { "node_id": "25", "field": "noise_seed" }
    }
  }
}

Note for LLM: Logic must handle python_executable as relative to root_path if it starts with .. or ., otherwise treat as absolute.

4. Backend Architecture
4.1. File Server & Image Proxy

Static Serving: The Express server must mount the ComfyUI output directory.

const outputVal = path.resolve(config.comfy_ui.root_path, config.comfy_ui.output_dir);

app.use('/images', express.static(outputVal));

Purpose: This allows the Frontend to load <img src="http://localhost:3000/images/ComfyUI_0001.png" /> directly.

4.2. The Startup Lifecycle (Enhanced)

The BootManager class must perform these steps sequentially:

Config Validation: Ensure paths exist.

Process Launch: Spawn ComfyUI using the defined python_executable and root_path.

Wait for Port: Poll 127.0.0.1:8188 until live.

Socket Connect: Connect internal WS to ComfyUI.

Warmup & Benchmark:

Run one generation to load models.

Run second generation to calculate GLOBAL_JOB_DURATION (e.g., 14.5 seconds).

Ready: Open Express port.

4.3. Job Scheduler (Collision Logic)

Data Structure: Array of Job objects.

Collision Rule: A user cannot book time 
𝑇
T
 if 
(
𝑇
≤
ExistingJob
𝑒
𝑛
𝑑
)
(T≤ExistingJob
end
	​

)
 AND 
(
𝑇
+
Duration
≥
ExistingJob
𝑠
𝑡
𝑎
𝑟
𝑡
)
(T+Duration≥ExistingJob
start
	​

)
.

Execution Loop: Every 1s, check if Date.now() >= Job.scheduledTime. If yes, and Worker is idle, execute.

4.4. State Management (Socket.io)

Global State Object (Broadcast on change):

code
JavaScript
download
content_copy
expand_less
{
  system_status: "ready", // or booting, benchmarking
  benchmark_ms: 14500,
  connected_users: [
    { socketId: "abc", userId: "User-1", ip: "::1" } 
  ],
  jobs: [
    {
      id: "uuid",
      user_id: "User-1",
      status: "scheduled", // or processing, completed
      time_slot: 1700000000000,
      prompt: "A cat in space",
      result_filename: "ComfyUI_005.png" // populated after completion
    }
  ]
}
5. Frontend Specification
5.1. Routing

Use react-router-dom:

/ 
→
→
 The Scheduler (Client View)

/dashboard 
→
→
 The Dashboard (Admin View)

5.2. Page: The Scheduler (/)

Header: Shows "Connected as [User-ID]". Server Status light.

Visual Timeline: Horizontal scrollable timeline showing booked slots.

Interactivity: Double-click empty space to Book. Click own block to Edit/Move.

Action Panel:

If a job is selected: Show Prompt input, Seed input, and "Update Job" button.

If status === 'completed': Show the Generated Image (fetched from /images/filename).

5.3. Page: The Dashboard (/dashboard)

This is a grid-based management view.

Stats Cards (Top Row):

"Total Jobs Today"

"Average Generation Time" (from Benchmark)

"Active Users"

User Table:

List of currently connected Socket IDs and their assigned User IDs.

Job List (Data Grid):

Columns: Time, User, Status, Prompt (Truncated), Image Preview.

Sortable by Time.

Rows turn green if completed, yellow if processing.

Image Preview: Small thumbnail that opens a lightbox on click.

6. Implementation Prompt for the LLM

Copy and paste the following instruction:

"I need you to generate a complete project structure for a ComfyUI Web Manager using Node.js, Express, Socket.io, and React.

Project Structure:

root/config.json (The configuration file as specified above).

root/server/ (Backend code).

root/client/ (React Vite code).

Backend Requirements (server/):

Config Loader: Create a module to read config.json. Logic to resolve the output_dir path relative to the root_path.

Static Serving: Configure Express to serve the resolved output_dir at the route /images.

BootManager: Use child_process to spawn the specific Python executable defined in config. Implement the 'Warmup' and 'Benchmark' logic before starting the web server.

Socket Manager: Maintain a list of connected_users. Broadcast the full list of jobs and users whenever a change occurs.

Scheduler: Implement the time-slot collision detection logic using the duration calculated during the Benchmark.

Frontend Requirements (client/):

Routing: Setup react-router-dom with routes / and /dashboard.

Home (/): Implement a Timeline view (use react-vis-timeline or similar) where users can click to book a slot.

Dashboard (/dashboard): Implement a table view showing all jobs. Include a column for 'Image' that renders an <img> tag pointing to http://localhost:3000/images/<filename> if the job is complete.

State: Use a React Context to hold the WebSocket state (jobs, users, system status) so both pages update in real-time.

Specific Logic:

When a job completes, the backend receives the filename from ComfyUI. Update the Job object in memory with result_filename.

The frontend should detect this change and display the image immediately."