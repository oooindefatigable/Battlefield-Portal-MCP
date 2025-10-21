
# Battlefield Portal MCP

[![Github-sponsors](https://img.shields.io/badge/sponsor-30363D?style=for-the-badge&logo=GitHub-Sponsors&logoColor=#EA4AAA)](https://github.com/sponsors/Coding-Solo)

[![](https://badge.mcpx.dev?type=server 'MCP Server')](https://modelcontextprotocol.io/introduction)
[![Made with Godot](https://img.shields.io/badge/Made%20with-Godot-478CBF?style=flat&logo=godot%20engine&logoColor=white)](https://godotengine.org)
[![](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white 'Node.js')](https://nodejs.org/en/download/)
[![](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white 'TypeScript')](https://www.typescriptlang.org/)

[![](https://img.shields.io/github/last-commit/Coding-Solo/godot-mcp 'Last Commit')](https://github.com/Coding-Solo/godot-mcp/commits/main)
[![](https://img.shields.io/github/stars/Coding-Solo/godot-mcp 'Stars')](https://github.com/Coding-Solo/godot-mcp/stargazers)
[![](https://img.shields.io/github/forks/Coding-Solo/godot-mcp 'Forks')](https://github.com/Coding-Solo/godot-mcp/network/members)
[![](https://img.shields.io/badge/License-MIT-red.svg 'MIT License')](https://opensource.org/licenses/MIT)

```text
                           (((((((             (((((((                          
                        (((((((((((           (((((((((((                      
                        (((((((((((((       (((((((((((((                       
                        (((((((((((((((((((((((((((((((((                       
                        (((((((((((((((((((((((((((((((((                       
         (((((      (((((((((((((((((((((((((((((((((((((((((      (((((        
       (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((      
     ((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((    
    ((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((    
      (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((     
        (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((       
         (((((((((((@@@@@@@(((((((((((((((((((((((((((@@@@@@@(((((((((((        
         (((((((((@@@@,,,,,@@@(((((((((((((((((((((@@@,,,,,@@@@(((((((((        
         ((((((((@@@,,,,,,,,,@@(((((((@@@@@(((((((@@,,,,,,,,,@@@((((((((        
         ((((((((@@@,,,,,,,,,@@(((((((@@@@@(((((((@@,,,,,,,,,@@@((((((((        
         (((((((((@@@,,,,,,,@@((((((((@@@@@((((((((@@,,,,,,,@@@(((((((((        
         ((((((((((((@@@@@@(((((((((((@@@@@(((((((((((@@@@@@((((((((((((        
         (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((        
         (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((        
         @@@@@@@@@@@@@((((((((((((@@@@@@@@@@@@@((((((((((((@@@@@@@@@@@@@        
         ((((((((( @@@(((((((((((@@(((((((((((@@(((((((((((@@@ (((((((((        
         (((((((((( @@((((((((((@@@(((((((((((@@@((((((((((@@ ((((((((((        
          (((((((((((@@@@@@@@@@@@@@(((((((((((@@@@@@@@@@@@@@(((((((((((         
           (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((          
              (((((((((((((((((((((((((((((((((((((((((((((((((((((             
                 (((((((((((((((((((((((((((((((((((((((((((((((                
                        (((((((((((((((((((((((((((((((((                       
                                                                                

                          /$$      /$$  /$$$$$$  /$$$$$$$ 
                         | $$$    /$$$ /$$__  $$| $$__  $$
                         | $$$$  /$$$$| $$  \__/| $$  \ $$
                         | $$ $$/$$ $$| $$      | $$$$$$$/
                         | $$  $$$| $$| $$      | $$____/ 
                         | $$\  $ | $$| $$    $$| $$      
                         | $$ \/  | $$|  $$$$$$/| $$      
                         |__/     |__/ \______/ |__/       
```

A Model Context Protocol (MCP) server for interacting with the Battlefield Portal SDK and the Godot game engine.

## Introduction

Battlefield Portal MCP extends the original Godot-focused tooling to understand the Battlefield Portal SDK. It enables AI assistants to launch the Godot editor, run projects, export Portal spatial data, regenerate Portal projects, capture debug output, and control project execution — all through a standardized interface.

This direct feedback loop helps AI assistants like Claude understand what works and what doesn't in real Godot and Battlefield Portal projects, leading to better code generation, data conversion, and debugging assistance.

## Features

### Godot Automation

- **Launch Godot Editor**: Open the Godot editor for a specific project
- **Run Godot Projects**: Execute projects in debug mode and stream output
- **Capture Debug Output**: Retrieve console output and error messages
- **Control Execution**: Start and stop Godot projects programmatically
- **Get Godot Version**: Retrieve the installed Godot version
- **List Godot Projects**: Find Godot projects in a specified directory
- **Project Analysis**: Get detailed information about project structure
- **Scene Management**:
  - Create new scenes with specified root node types
  - Add nodes to existing scenes with customizable properties
  - Load sprites and textures into Sprite2D nodes
  - Export 3D scenes as MeshLibrary resources for GridMap
  - Save scenes with options for creating variants
- **UID Management** (for Godot 4.4+):
  - Get UID for specific files
  - Update UID references by resaving resources

### Battlefield Portal Enhancements

- **SDK Introspection**: Use `get_portal_sdk_info` to review detected Portal SDK, project, and FbExportData paths
- **Level Discovery**: Enumerate available Portal spatial levels with `list_portal_levels`
- **Spatial Export**: Convert Godot scenes to `.spatial.json` files using `export_portal_level`
- **Project Generation**: Recreate or refresh the Portal Godot project from FbExportData via `create_portal_project`

## Requirements

- [Godot Engine](https://godotengine.org/download) installed on your system
- [Battlefield Portal SDK](https://github.com/battlefield-portal-community/PortalSDK) cloned locally for Portal tooling
- [Python 3.9+](https://www.python.org/downloads/) available on your PATH (required for Portal converters)
- Node.js and npm
- An AI assistant that supports MCP (Cline, Cursor, etc.)

## Installation and Configuration

### Step 1: Install and Build

First, clone the repository and build the MCP server:

```bash
git clone https://github.com/Coding-Solo/godot-mcp.git bfportal-mcp
cd bfportal-mcp
npm install
npm run build
```

### Step 2: Configure with Your AI Assistant

#### Option A: Configure with Cline

Add to your Cline MCP settings file (`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "bfportal": {
      "command": "node",
      "args": ["/absolute/path/to/bfportal-mcp/build/index.js"],
      "env": {
        "DEBUG": "true"                  // Optional: Enable detailed logging
      },
      "disabled": false,
      "autoApprove": [
        "launch_editor",
        "run_project",
        "get_debug_output",
        "stop_project",
        "get_godot_version",
        "list_projects",
        "get_project_info",
        "create_scene",
        "add_node",
        "load_sprite",
        "export_mesh_library",
        "save_scene",
        "get_uid",
        "update_project_uids",
        "get_portal_sdk_info",
        "list_portal_levels",
        "export_portal_level",
        "create_portal_project"
      ]
    }
  }
}
```

#### Option B: Configure with Cursor

**Using the Cursor UI:**

1. Go to **Cursor Settings** > **Features** > **MCP**
2. Click on the **+ Add New MCP Server** button
3. Fill out the form:
   - Name: `bfportal` (or any name you prefer)
   - Type: `command`
   - Command: `node /absolute/path/to/bfportal-mcp/build/index.js`
4. Click "Add"
5. You may need to press the refresh button in the top right corner of the MCP server card to populate the tool list

**Using Project-Specific Configuration:**

Create a file at `.cursor/mcp.json` in your project directory with the following content:

```json
{
  "mcpServers": {
    "bfportal": {
      "command": "node",
      "args": ["/absolute/path/to/bfportal-mcp/build/index.js"],
      "env": {
        "DEBUG": "true"                  // Enable detailed logging
      }
    }
  }
}
```

### Step 3: Optional Environment Variables

You can customize the server behavior with these environment variables:

- `GODOT_PATH`: Path to the Godot executable (overrides automatic detection)
- `PORTAL_SDK_PATH`: Absolute path to the Battlefield Portal SDK root directory
- `PORTAL_PROJECT_PATH`: Override the detected Portal Godot project directory
- `PORTAL_FB_EXPORT_PATH`: Override the detected `SDK/deps/FbExportData` directory
- `PYTHON_PATH`: Explicit Python interpreter to use for gdconverter scripts
- `DEBUG`: Set to "true" to enable detailed server-side debug logging

## Battlefield Portal Integration

When the Portal SDK is available the server will automatically detect:

- The SDK root directory and gdconverter utilities
- The bundled Portal Godot project (`GodotProject`)
- The exported spatial data (`SDK/deps/FbExportData`)

The following tools extend the baseline Godot automation:

- `get_portal_sdk_info`: Report detected Portal paths and Python command
- `list_portal_levels`: Enumerate available `.spatial.json` files with related Godot scenes and script directories
- `export_portal_level`: Convert a Godot scene into a Portal `.spatial.json` using the gdconverter export pipeline
- `create_portal_project`: Regenerate the Portal Godot project from FbExportData, optionally overwriting existing levels

If the SDK is stored outside the repository, set `PORTAL_SDK_PATH` (and friends) so the server can find it. Python 3.9 or newer must be available for the converter scripts.

## Example Prompts

Once configured, your AI assistant will automatically run the MCP server when needed. You can use prompts like:

```text
"Launch the Godot editor for my project at /path/to/project"

"Run my Godot project and show me any errors"

"Get information about my Godot project structure"

"Analyze my Godot project structure and suggest improvements"

"Help me debug this error in my Godot project: [paste error]"

"Write a GDScript for a character controller with double jump and wall sliding"

"Create a new scene with a Player node in my Godot project"

"Add a Sprite2D node to my player scene and load the character texture"

"Export my 3D models as a MeshLibrary for use with GridMap"

"Create a UI scene with buttons and labels for my game's main menu"

"List all Battlefield Portal levels and show their associated terrain scenes"

"Export the MP_Aftermath scene to a spatial JSON file inside ./exports"

"Regenerate the Portal Godot project from the FbExportData directory"

"Get the UID for a specific script file in my Godot 4.4 project"

"Update UID references in my Godot project after upgrading to 4.4"
```

## Implementation Details

### Architecture

The Battlefield Portal MCP server uses a bundled GDScript approach for complex operations:

1. **Direct Commands**: Simple operations like launching the editor or getting project info use Godot's built-in CLI commands directly.
2. **Bundled Operations Script**: Complex operations like creating scenes or adding nodes use a single, comprehensive GDScript file (`godot_operations.gd`) that handles all operations.

This architecture provides several benefits:

- **No Temporary Files**: Eliminates the need for temporary script files, keeping your system clean
- **Simplified Codebase**: Centralizes all Godot operations in one (somewhat) organized file
- **Better Maintainability**: Makes it easier to add new operations or modify existing ones
- **Improved Error Handling**: Provides consistent error reporting across all operations
- **Reduced Overhead**: Minimizes file I/O operations for better performance

The bundled script accepts operation type and parameters as JSON, allowing for flexible and dynamic operation execution without generating temporary files for each operation.

## Troubleshooting

- **Godot Not Found**: Set the GODOT_PATH environment variable to your Godot executable
- **Connection Issues**: Ensure the server is running and restart your AI assistant
- **Invalid Project Path**: Ensure the path points to a directory containing a project.godot file
- **Build Issues**: Make sure all dependencies are installed by running `npm install`
- **For Cursor Specifically**:
-   Ensure the MCP server shows up and is enabled in Cursor settings (Settings > MCP)
-   MCP tools can only be run using the Agent chat profile (Cursor Pro or Business subscription)
-   Use "Yolo Mode" to automatically run MCP tool requests

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/coding-solo-godot-mcp-badge.png)](https://mseep.ai/app/coding-solo-godot-mcp)
